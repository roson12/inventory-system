import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import {
  getScopedWarehouseIds,
  isWarehouseAllowed,
  requireAuth,
  requirePermission,
} from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { businessNumber } from '../../lib/numbers';
import { recordAudit } from '../../lib/audit';
import { applyMovement, ensureSettings } from '../../services/inventory';
import { notify, notifyLowStock } from '../../services/orders';

export const goodsReceiptsRouter = Router();
goodsReceiptsRouter.use(requireAuth);

const createSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitCost: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1),
});

goodsReceiptsRouter.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_READ),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const receipts = await prisma.goodsReceipt.findMany({
      where: { ...(scoped === null ? {} : { warehouseId: { in: scoped } }) },
      include: {
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    res.json({ data: receipts });
  }),
);

goodsReceiptsRouter.post(
  '/',
  requirePermission(PERMISSIONS.GOODS_RECEIPTS_CREATE),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;

    const receipt = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; status: string; warehouseId: string; poNumber: string }[]
      >`SELECT "id", "status", "warehouseId", "poNumber" FROM "PurchaseOrder" WHERE "id" = ${body.purchaseOrderId}::uuid FOR UPDATE`;
      if (!locked[0]) throw notFound('Purchase order not found');
      const poHeader = locked[0];

      const scoped = await getScopedWarehouseIds(req.user!);
      if (!isWarehouseAllowed(scoped, poHeader.warehouseId)) {
        throw forbidden('You do not have access to this warehouse');
      }
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(poHeader.status)) {
        throw conflict(`Cannot receive against a ${poHeader.status} purchase order`);
      }

      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: poHeader.id },
        include: { items: true },
      });
      const itemMap = new Map(po.items.map((item) => [item.id, item]));
      const settings = await ensureSettings(tx);

      const receiptItems: Prisma.GoodsReceiptItemCreateWithoutGoodsReceiptInput[] = [];
      const lineUpdates: { itemId: string; quantity: Prisma.Decimal }[] = [];
      let totalReceived = new Prisma.Decimal(0);

      for (const line of body.items) {
        const poItem = itemMap.get(line.purchaseOrderItemId);
        if (!poItem) throw badRequest('Receipt item does not belong to this purchase order');
        const quantity = new Prisma.Decimal(line.quantity);
        const outstanding = new Prisma.Decimal(poItem.quantity).minus(poItem.receivedQty);
        if (quantity.greaterThan(outstanding)) {
          throw conflict(
            `Cannot receive ${quantity.toFixed(3)} of ${poItem.productId}; outstanding is ${outstanding.toFixed(3)}`,
          );
        }
        const unitCost = line.unitCost !== undefined ? new Prisma.Decimal(line.unitCost) : new Prisma.Decimal(poItem.unitCost);
        receiptItems.push({
          purchaseOrderItem: { connect: { id: poItem.id } },
          product: { connect: { id: poItem.productId } },
          quantity,
          unitCost,
        });
        lineUpdates.push({ itemId: poItem.id, quantity });
        totalReceived = totalReceived.plus(quantity);
      }

      const created = await tx.goodsReceipt.create({
        data: {
          receiptNumber: businessNumber('GRN'),
          purchaseOrderId: po.id,
          warehouseId: po.warehouseId,
          notes: body.notes,
          receivedById: req.user!.id,
          status: 'CONFIRMED',
          items: { create: receiptItems },
        },
        include: { items: true },
      });

      for (const line of lineUpdates) {
        await tx.purchaseOrderItem.update({
          where: { id: line.itemId },
          data: { receivedQty: { increment: line.quantity } },
        });
      }

      // Re-read to determine whether every line is complete.
      const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: po.id } });
      const fullyReceived = refreshed.every((item) =>
        new Prisma.Decimal(item.receivedQty).greaterThanOrEqualTo(item.quantity),
      );

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      for (const item of created.items) {
        await applyMovement(
          tx,
          {
            productId: item.productId,
            warehouseId: po.warehouseId,
            type: 'RECEIPT',
            quantity: item.quantity,
            unitCost: item.unitCost,
            referenceType: 'GoodsReceipt',
            referenceId: created.id,
            reason: `Received against ${po.poNumber}`,
            actorId: req.user!.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
        );
      }

      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'goods_receipts.confirmed',
          entityType: 'GoodsReceipt',
          entityId: created.id,
          after: {
            purchaseOrderId: po.id,
            receiptNumber: created.receiptNumber,
            items: created.items.length,
          },
        },
        tx,
      );

      return { created, poId: po.id, poNumber: po.poNumber, createdById: po.createdById };
    });

    await notify(
      receipt.createdById,
      'PURCHASE_ORDER',
      'Goods received',
      `Receipt ${receipt.created.receiptNumber} was recorded against ${receipt.poNumber}.`,
      `/purchase-orders/${receipt.poId}`,
    );
    for (const item of receipt.created.items) {
      await notifyLowStock(item.productId, receipt.created.warehouseId);
    }

    res.status(201).json({ data: receipt.created });
  }),
);

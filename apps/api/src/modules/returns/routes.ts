import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import {
  getScopedWarehouseIds,
  hasPermission,
  isWarehouseAllowed,
  requireAuth,
  requirePermission,
} from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { businessNumber, roundMoney } from '../../lib/numbers';
import { recordAudit } from '../../lib/audit';
import { applyMovement, ensureSettings } from '../../services/inventory';
import { notify } from '../../services/orders';

export const returnsRouter = Router();
returnsRouter.use(requireAuth);

const createSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3).max(1000),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        restock: z.boolean().optional(),
      }),
    )
    .min(1),
});

returnsRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const order = await prisma.customerOrder.findUnique({
      where: { id: body.orderId },
      include: { items: true },
    });
    if (!order) throw notFound('Customer order not found');
    if (req.user!.role === 'CUSTOMER' && order.customerId !== req.user!.id) {
      throw forbidden('You can only request returns for your own orders');
    }
    if (order.status !== 'DELIVERED') {
      throw conflict('Only delivered orders can be returned');
    }

    const previous = await prisma.returnItem.findMany({
      where: { return: { orderId: order.id, status: { in: ['REQUESTED', 'APPROVED', 'RECEIVED'] } } },
    });
    const itemMap = new Map(order.items.map((item) => [item.id, item]));
    let refund = new Prisma.Decimal(0);
    const items = body.items.map((line) => {
      const orderItem = itemMap.get(line.orderItemId);
      if (!orderItem) throw badRequest('Return item does not belong to this order');
      const already = previous
        .filter((p) => p.orderItemId === orderItem.id)
        .reduce((sum, p) => sum.plus(p.quantity), new Prisma.Decimal(0));
      const quantity = new Prisma.Decimal(line.quantity);
      if (quantity.plus(already).greaterThan(orderItem.quantity)) {
        throw conflict('Return quantity exceeds the delivered quantity');
      }
      refund = refund.plus(quantity.times(orderItem.unitPrice));
      return {
        orderItemId: orderItem.id,
        productId: orderItem.productId,
        quantity,
        unitPrice: orderItem.unitPrice,
        restock: line.restock ?? true,
      };
    });

    const created = await prisma.return.create({
      data: {
        returnNumber: businessNumber('RMA'),
        orderId: order.id,
        customerId: order.customerId,
        reason: body.reason,
        refundAmount: roundMoney(refund.toNumber()),
        items: { create: items },
      },
      include: { items: true },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'returns.requested',
      entityType: 'Return',
      entityId: created.id,
      after: { orderId: order.id, refundAmount: created.refundAmount.toFixed(2) },
      req,
    });
    res.status(201).json({ data: created });
  }),
);

returnsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const where: Prisma.ReturnWhereInput =
      req.user!.role === 'CUSTOMER'
        ? { customerId: req.user!.id }
        : hasPermission(req.user!, PERMISSIONS.RETURNS_MANAGE)
          ? scoped === null
            ? {}
            : { order: { warehouseId: { in: scoped } } }
          : { customerId: req.user!.id };

    const rows = await prisma.return.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true, status: true, warehouseId: true } },
        customer: { select: { id: true, name: true, email: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ data: rows });
  }),
);

async function loadReturn(actorId: string, id: string) {
  const row = await prisma.return.findUnique({
    where: { id },
    include: { order: { include: { items: true } }, items: true },
  });
  if (!row) throw notFound('Return not found');
  return row;
}

returnsRouter.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.RETURNS_MANAGE),
  asyncHandler(async (req, res) => {
    const row = await loadReturn(req.user!.id, req.params.id);
    if (row.status !== 'REQUESTED') throw conflict('Only requested returns can be approved');
    const updated = await prisma.return.update({
      where: { id: row.id },
      data: { status: 'APPROVED', approvedAt: new Date(), processedById: req.user!.id },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'returns.approved',
      entityType: 'Return',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'APPROVED' },
      req,
    });
    await notify(
      row.customerId,
      'ORDER_UPDATE',
      'Return approved',
      `Return ${row.returnNumber} has been approved.`,
      `/returns`,
    );
    res.json({ data: updated });
  }),
);

returnsRouter.post(
  '/:id/reject',
  requirePermission(PERMISSIONS.RETURNS_MANAGE),
  asyncHandler(async (req, res) => {
    const row = await loadReturn(req.user!.id, req.params.id);
    if (!['REQUESTED', 'APPROVED'].includes(row.status)) {
      throw conflict('This return has already been processed');
    }
    const updated = await prisma.return.update({
      where: { id: row.id },
      data: { status: 'REJECTED', processedById: req.user!.id },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'returns.rejected',
      entityType: 'Return',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'REJECTED' },
      req,
    });
    res.json({ data: updated });
  }),
);

returnsRouter.post(
  '/:id/receive',
  requirePermission(PERMISSIONS.RETURNS_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string; status: string; orderId: string }[]
      >`SELECT "id", "status", "orderId" FROM "Return" WHERE "id" = ${req.params.id}::uuid FOR UPDATE`;
      if (!locked[0]) throw notFound('Return not found');
      if (locked[0].status !== 'APPROVED') throw conflict('Only approved returns can be received');

      const row = await tx.return.findUniqueOrThrow({
        where: { id: locked[0].id },
        include: { order: true, items: true },
      });
      if (!row.order.warehouseId) throw conflict('The original order has no fulfillment warehouse');
      if (row.order.status !== 'DELIVERED') throw conflict('The original order is not delivered');

      const settings = await ensureSettings(tx);
      for (const item of row.items) {
        if (!item.restock) continue;
        await applyMovement(
          tx,
          {
            productId: item.productId,
            warehouseId: row.order.warehouseId,
            type: 'RETURN_IN',
            quantity: item.quantity,
            unitCost: item.unitPrice,
            referenceType: 'Return',
            referenceId: row.id,
            reason: `Return ${row.returnNumber}`,
            actorId: req.user!.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
        );
      }

      await tx.customerOrder.update({
        where: { id: row.orderId },
        data: { status: 'RETURNED', paymentStatus: 'REFUNDED' },
      });
      const updated = await tx.return.update({
        where: { id: row.id },
        data: { status: 'RECEIVED', receivedAt: new Date(), processedById: req.user!.id },
      });
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'returns.received',
          entityType: 'Return',
          entityId: row.id,
          after: { refundAmount: row.refundAmount.toFixed(2), restocked: row.items.filter((i) => i.restock).length },
        },
        tx,
      );
      return { updated, row };
    });

    await notify(
      result.row.customerId,
      'ORDER_UPDATE',
      'Return received',
      `Return ${result.row.returnNumber} was received. Refund recorded: ${result.row.refundAmount.toFixed(2)}.`,
      '/returns',
    );
    res.json({ data: result.updated });
  }),
);

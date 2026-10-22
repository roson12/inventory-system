import { Router } from 'express';
import { z } from 'zod';
import { Prisma, MovementType } from '@prisma/client';
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
import { getPagination, paginated } from '../../lib/pagination';
import { businessNumber, roundQuantity } from '../../lib/numbers';
import { recordAudit } from '../../lib/audit';
import { applyMovement, ensureSettings, lockBalance } from '../../services/inventory';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const scopeFilter = async (req: Parameters<typeof requireAuth>[0]) => {
  const scoped = await getScopedWarehouseIds(req.user!);
  return scoped === null ? {} : { warehouseId: { in: scoped } };
};

const balanceQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

inventoryRouter.get(
  '/balances',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  validate({ query: balanceQuery }),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['updatedAt', 'onHand'],
      defaultSort: 'updatedAt',
    });
    const q = req.query as z.infer<typeof balanceQuery>;
    const scoped = await getScopedWarehouseIds(req.user!);
    const where: Prisma.InventoryBalanceWhereInput = {
      ...(scoped === null ? {} : { warehouseId: { in: scoped } }),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.search
        ? {
            product: {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { sku: { contains: q.search, mode: 'insensitive' } },
                { barcode: { contains: q.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    // Low stock is a column-to-column comparison, so filter after loading the page.
    const [rows, total] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              unitOfMeasure: true,
              reorderLevel: true,
              sellingPrice: true,
              costPrice: true,
              isActive: true,
            },
          },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        skip: q.lowStock === 'true' ? 0 : pagination.skip,
        take: q.lowStock === 'true' ? 1000 : pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.inventoryBalance.count({ where }),
    ]);

    const data = rows
      .map((row) => ({
        id: row.id,
        product: row.product,
        warehouse: row.warehouse,
        onHand: row.onHand.toFixed(3),
        reserved: row.reserved.toFixed(3),
        available: row.onHand.minus(row.reserved).toFixed(3),
        avgCost: row.avgCost.toFixed(2),
        value: row.onHand.times(row.avgCost).toFixed(2),
        isLowStock: row.onHand.lessThanOrEqualTo(row.product.reorderLevel),
        updatedAt: row.updatedAt,
      }))
      .filter((row) => (q.lowStock === 'true' ? row.isLowStock : true));

    if (q.lowStock === 'true') {
      res.json(paginated(data, data.length, { ...pagination, page: 1, pageSize: data.length || 20 }));
      return;
    }
    res.json(paginated(data, total, pagination));
  }),
);

const movementQuery = z.object({
  warehouseId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  type: z.nativeEnum(MovementType).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

inventoryRouter.get(
  '/movements',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  validate({ query: movementQuery }),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['createdAt', 'quantity'],
      defaultSort: 'createdAt',
    });
    const q = req.query as z.infer<typeof movementQuery>;
    const where: Prisma.StockMovementWhereInput = {
      ...(await scopeFilter(req)),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lte: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, unitOfMeasure: true } },
          warehouse: { select: { id: true, code: true, name: true } },
        },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json(
      paginated(
        rows.map((m) => ({
          ...m,
          quantity: m.quantity.toFixed(3),
          unitCost: m.unitCost.toFixed(2),
          balanceAfter: m.balanceAfter.toFixed(3),
        })),
        total,
        pagination,
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  kind: z.enum(['INCREASE', 'DECREASE', 'SET']),
  quantity: z.coerce.number().min(0),
  unitCost: z.coerce.number().min(0).optional(),
  reason: z.string().trim().min(3).max(500),
});

async function applyAdjustment(
  adjustmentId: string,
  actorId: string,
  allowSelfApproval: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.stockAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!adjustment) throw notFound('Adjustment not found');
    if (adjustment.status !== 'PENDING') throw conflict('Adjustment has already been processed');
    if (!allowSelfApproval && adjustment.requestedById === actorId) {
      throw forbidden('You cannot approve your own adjustment request');
    }

    const settings = await ensureSettings(tx);
    const balance = await lockBalance(tx, adjustment.productId, adjustment.warehouseId);
    const current = balance.onHand;
    const quantity = adjustment.quantity;
    let delta: Prisma.Decimal;
    if (adjustment.kind === 'INCREASE') delta = quantity;
    else if (adjustment.kind === 'DECREASE') delta = quantity.negated();
    else delta = quantity.minus(current);

    if (delta.isZero()) {
      const updated = await tx.stockAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date(), appliedAt: new Date() },
      });
      return updated;
    }

    await applyMovement(
      tx,
      {
        productId: adjustment.productId,
        warehouseId: adjustment.warehouseId,
        type: 'ADJUSTMENT',
        quantity: delta,
        unitCost:
          adjustment.unitCost ??
          (delta.isPositive() ? balance.avgCost : undefined),
        referenceType: 'StockAdjustment',
        referenceId: adjustment.id,
        reason: adjustment.reason,
        actorId,
      },
      { allowNegativeStock: settings.allowNegativeStock },
    );

    const updated = await tx.stockAdjustment.update({
      where: { id: adjustment.id },
      data: { status: 'APPROVED', approvedById: actorId, approvedAt: new Date(), appliedAt: new Date() },
    });
    await recordAudit(
      {
        actorId,
        action: 'inventory.adjustment_applied',
        entityType: 'StockAdjustment',
        entityId: adjustment.id,
        after: { delta: delta.toFixed(3), kind: adjustment.kind },
      },
      tx,
    );
    return updated;
  });
}

inventoryRouter.post(
  '/adjustments',
  validate({ body: adjustmentSchema }),
  asyncHandler(async (req, res) => {
    if (
      !hasPermission(req.user!, PERMISSIONS.INVENTORY_ADJUST) &&
      !hasPermission(req.user!, PERMISSIONS.INVENTORY_ADJUST_REQUEST)
    ) {
      throw forbidden('Missing permission: inventory.adjust');
    }
    const body = req.body as z.infer<typeof adjustmentSchema>;
    if (body.quantity > 0 && body.quantity > 1_000_000_000) throw badRequest('Quantity is too large');
    const scoped = await getScopedWarehouseIds(req.user!);
    if (!isWarehouseAllowed(scoped, body.warehouseId)) {
      throw forbidden('You do not have access to this warehouse');
    }
    const [product, warehouse] = await Promise.all([
      prisma.product.findUnique({ where: { id: body.productId } }),
      prisma.warehouse.findUnique({ where: { id: body.warehouseId } }),
    ]);
    if (!product) throw notFound('Product not found');
    if (!warehouse) throw notFound('Warehouse not found');

    const immediate = hasPermission(req.user!, PERMISSIONS.INVENTORY_ADJUST);
    const adjustment = await prisma.stockAdjustment.create({
      data: {
        adjustmentNumber: businessNumber('ADJ'),
        productId: body.productId,
        warehouseId: body.warehouseId,
        kind: body.kind,
        quantity: roundQuantity(body.quantity),
        unitCost: body.unitCost,
        reason: body.reason,
        requestedById: req.user!.id,
        status: immediate ? 'PENDING' : 'PENDING',
      },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'inventory.adjustment_requested',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      after: {
        productId: body.productId,
        warehouseId: body.warehouseId,
        kind: body.kind,
        quantity: body.quantity,
      },
      req,
    });

    if (immediate) {
      const applied = await applyAdjustment(adjustment.id, req.user!.id, true);
      res.status(201).json({ data: applied });
      return;
    }
    res.status(201).json({ data: adjustment });
  }),
);

inventoryRouter.get(
  '/adjustments',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const adjustments = await prisma.stockAdjustment.findMany({
      where: { ...(scoped === null ? {} : { warehouseId: { in: scoped } }) },
      include: {
        product: { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({
      data: adjustments.map((a) => ({ ...a, quantity: a.quantity.toFixed(3), unitCost: a.unitCost?.toFixed(2) })),
    });
  }),
);

inventoryRouter.post(
  '/adjustments/:id/approve',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  asyncHandler(async (req, res) => {
    const adjustment = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id } });
    if (!adjustment) throw notFound('Adjustment not found');
    const scoped = await getScopedWarehouseIds(req.user!);
    if (!isWarehouseAllowed(scoped, adjustment.warehouseId)) {
      throw forbidden('You do not have access to this warehouse');
    }
    const applied = await applyAdjustment(adjustment.id, req.user!.id, req.user!.role === 'SUPER_ADMIN');
    res.json({ data: applied });
  }),
);

inventoryRouter.post(
  '/adjustments/:id/reject',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  asyncHandler(async (req, res) => {
    const adjustment = await prisma.stockAdjustment.findUnique({ where: { id: req.params.id } });
    if (!adjustment) throw notFound('Adjustment not found');
    if (adjustment.status !== 'PENDING') throw conflict('Adjustment has already been processed');
    const updated = await prisma.stockAdjustment.update({
      where: { id: adjustment.id },
      data: { status: 'REJECTED', approvedById: req.user!.id, approvedAt: new Date() },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'inventory.adjustment_rejected',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      req,
    });
    res.json({ data: updated });
  }),
);

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

const transferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  notes: z.string().max(1000).optional(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().positive() }))
    .min(1),
});

inventoryRouter.post(
  '/transfers',
  requirePermission(PERMISSIONS.INVENTORY_TRANSFER),
  validate({ body: transferSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transferSchema>;
    if (body.fromWarehouseId === body.toWarehouseId) {
      throw badRequest('Source and destination warehouses must differ');
    }
    const scoped = await getScopedWarehouseIds(req.user!);
    if (!isWarehouseAllowed(scoped, body.fromWarehouseId)) {
      throw forbidden('You do not have access to the source warehouse');
    }
    const [from, to] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: body.fromWarehouseId } }),
      prisma.warehouse.findUnique({ where: { id: body.toWarehouseId } }),
    ]);
    if (!from || !to) throw notFound('Warehouse not found');

    const transfer = await prisma.stockTransfer.create({
      data: {
        transferNumber: businessNumber('TRF'),
        fromWarehouseId: body.fromWarehouseId,
        toWarehouseId: body.toWarehouseId,
        notes: body.notes,
        requestedById: req.user!.id,
        items: {
          create: body.items.map((item) => ({
            productId: item.productId,
            quantity: roundQuantity(item.quantity),
          })),
        },
      },
      include: { items: true },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'inventory.transfer_requested',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      after: { from: body.fromWarehouseId, to: body.toWarehouseId, items: body.items },
      req,
    });
    res.status(201).json({ data: transfer });
  }),
);

inventoryRouter.get(
  '/transfers',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const transfers = await prisma.stockTransfer.findMany({
      where:
        scoped === null
          ? {}
          : { OR: [{ fromWarehouseId: { in: scoped } }, { toWarehouseId: { in: scoped } }] },
      include: {
        fromWarehouse: { select: { id: true, code: true, name: true } },
        toWarehouse: { select: { id: true, code: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ data: transfers });
  }),
);

inventoryRouter.post(
  '/transfers/:id/complete',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: req.params.id },
        include: { items: true },
      });
      if (!transfer) throw notFound('Transfer not found');
      if (!['PENDING', 'APPROVED'].includes(transfer.status)) {
        throw conflict(`Transfer cannot be completed from status ${transfer.status}`);
      }
      const settings = await ensureSettings(tx);

      const items = [...transfer.items].sort((a, b) => a.productId.localeCompare(b.productId));
      const costs = new Map<string, Prisma.Decimal>();
      for (const item of items) {
        const balance = await lockBalance(tx, item.productId, transfer.fromWarehouseId);
        if (balance.onHand.minus(balance.reserved).lessThan(item.quantity)) {
          throw conflict('Insufficient available stock in the source warehouse');
        }
        costs.set(item.productId, balance.avgCost);
      }

      for (const item of items) {
        const unitCost = costs.get(item.productId)!;
        await applyMovement(
          tx,
          {
            productId: item.productId,
            warehouseId: transfer.fromWarehouseId,
            type: 'TRANSFER_OUT',
            quantity: item.quantity.negated(),
            referenceType: 'StockTransfer',
            referenceId: transfer.id,
            actorId: req.user!.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
        );
        await applyMovement(
          tx,
          {
            productId: item.productId,
            warehouseId: transfer.toWarehouseId,
            type: 'TRANSFER_IN',
            quantity: item.quantity,
            unitCost,
            referenceType: 'StockTransfer',
            referenceId: transfer.id,
            actorId: req.user!.id,
          },
          { allowNegativeStock: settings.allowNegativeStock },
        );
        await tx.stockTransferItem.update({ where: { id: item.id }, data: { unitCost } });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'COMPLETED',
          approvedById: req.user!.id,
          approvedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'inventory.transfer_completed',
          entityType: 'StockTransfer',
          entityId: transfer.id,
          after: { from: transfer.fromWarehouseId, to: transfer.toWarehouseId },
        },
        tx,
      );
      return updated;
    });
    res.json({ data: result });
  }),
);

inventoryRouter.post(
  '/transfers/:id/reject',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) throw notFound('Transfer not found');
    if (!['PENDING', 'APPROVED'].includes(transfer.status)) {
      throw conflict('Transfer has already been processed');
    }
    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user!.id,
        approvedAt: new Date(),
        notes: `${transfer.notes ?? ''}\nRejected by ${req.user!.name}`.trim(),
      },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'inventory.transfer_rejected',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      req,
    });
    res.json({ data: updated });
  }),
);

import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, forbidden } from '../../lib/errors';
import {
  getScopedWarehouseIds,
  hasPermission,
  requireAuth,
  requirePermission,
} from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { toCsv } from '../../lib/pagination';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function dateRange(req: { query: Record<string, unknown> }) {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from
    ? new Date(String(req.query.from))
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

async function scopedWhere(req: Parameters<typeof requireAuth>[0]) {
  const scoped = await getScopedWarehouseIds(req.user!);
  return scoped === null ? {} : { warehouseId: { in: scoped } };
}

reportsRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const warehouseWhere = scoped === null ? {} : { warehouseId: { in: scoped } };

    const [
      activeProducts,
      activeWarehouses,
      pendingOrders,
      pendingPurchaseOrders,
      lowStockRows,
      recentOrders,
      valuationRows,
      salesAgg,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true, archivedAt: null } }),
      prisma.warehouse.count({ where: { isActive: true, ...(scoped === null ? {} : { id: { in: scoped } }) } }),
      prisma.customerOrder.count({
        where: { status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY_FOR_DISPATCH'] }, ...warehouseWhere },
      }),
      prisma.purchaseOrder.count({ where: { status: 'SUBMITTED', ...warehouseWhere } }),
      prisma.inventoryBalance.findMany({
        where: warehouseWhere,
        include: { product: { select: { reorderLevel: true, name: true, sku: true } } },
      }),
      prisma.customerOrder.findMany({
        where: warehouseWhere,
        orderBy: { placedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          placedAt: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.inventoryBalance.findMany({ where: warehouseWhere }),
      prisma.customerOrder.aggregate({
        where: {
          status: { notIn: ['CANCELLED', 'RETURNED'] },
          placedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          ...warehouseWhere,
        },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    const canSeeFinancial = hasPermission(req.user!, PERMISSIONS.REPORTS_FINANCIAL);
    const inventoryValue = valuationRows
      .reduce(
        (sum, row) => sum.plus(row.onHand.times(row.avgCost)),
        new Prisma.Decimal(0),
      )
      .toDecimalPlaces(2);
    const lowStock = lowStockRows.filter((row) =>
      row.onHand.lessThanOrEqualTo(row.product.reorderLevel),
    );

    res.json({
      data: {
        activeProducts,
        activeWarehouses,
        pendingOrders,
        pendingPurchaseOrders,
        lowStockCount: lowStock.length,
        lowStock: lowStock.slice(0, 10).map((row) => ({
          productId: row.productId,
          warehouseId: row.warehouseId,
          name: row.product.name,
          sku: row.product.sku,
          onHand: row.onHand.toFixed(3),
          reorderLevel: row.product.reorderLevel.toFixed(3),
        })),
        ...(canSeeFinancial ? { inventoryValue: inventoryValue.toFixed(2) } : {}),
        ...(hasPermission(req.user!, PERMISSIONS.REPORTS_VIEW)
          ? {
              salesLast30Days: (salesAgg._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
              ordersLast30Days: salesAgg._count,
            }
          : {}),
        recentOrders: recentOrders.map((o) => ({ ...o, total: o.total.toFixed(2) })),
      },
    });
  }),
);

reportsRouter.get(
  '/inventory-valuation',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  requirePermission(PERMISSIONS.REPORTS_FINANCIAL),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const warehouseId = typeof req.query.warehouseId === 'string' ? req.query.warehouseId : undefined;
    const rows = await prisma.inventoryBalance.findMany({
      where: {
        ...(scoped === null ? {} : { warehouseId: { in: scoped } }),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        product: { select: { name: true, sku: true, unitOfMeasure: true } },
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { warehouseId: 'asc' },
    });
    const data = rows.map((row) => ({
      warehouse: row.warehouse.name,
      warehouseCode: row.warehouse.code,
      sku: row.product.sku,
      product: row.product.name,
      unitOfMeasure: row.product.unitOfMeasure,
      onHand: row.onHand.toFixed(3),
      avgCost: row.avgCost.toFixed(2),
      value: row.onHand.times(row.avgCost).toFixed(2),
    }));
    const totalValue = rows
      .reduce((sum, row) => sum.plus(row.onHand.times(row.avgCost)), new Prisma.Decimal(0))
      .toFixed(2);
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="inventory-valuation.csv"');
      res.send(toCsv([...data, { warehouse: 'TOTAL', value: totalValue } as never]));
      return;
    }
    res.json({ data, meta: { totalValue } });
  }),
);

reportsRouter.get(
  '/sales',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const scoped = await getScopedWarehouseIds(req.user!);
    const warehouseFilter = scoped === null ? {} : { warehouseId: { in: scoped } };

    const orders = await prisma.customerOrder.findMany({
      where: {
        placedAt: { gte: from, lte: to },
        status: { notIn: ['CANCELLED'] },
        ...warehouseFilter,
      },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    const byDay = new Map<string, { revenue: Prisma.Decimal; orders: number }>();
    const byProduct = new Map<string, { name: string; sku: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal }>();
    let revenue = new Prisma.Decimal(0);

    for (const order of orders) {
      const day = order.placedAt.toISOString().slice(0, 10);
      const dayRow = byDay.get(day) ?? { revenue: new Prisma.Decimal(0), orders: 0 };
      dayRow.revenue = dayRow.revenue.plus(order.total);
      dayRow.orders += 1;
      byDay.set(day, dayRow);
      revenue = revenue.plus(order.total);

      for (const item of order.items) {
        const key = item.productId;
        const row =
          byProduct.get(key) ??
          { name: item.product.name, sku: item.product.sku, quantity: new Prisma.Decimal(0), revenue: new Prisma.Decimal(0) };
        row.quantity = row.quantity.plus(item.quantity);
        row.revenue = row.revenue.plus(item.lineTotal);
        byProduct.set(key, row);
      }
    }

    const data = {
      from: from.toISOString(),
      to: to.toISOString(),
      orderCount: orders.length,
      revenue: revenue.toFixed(2),
      daily: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, row]) => ({ date, revenue: row.revenue.toFixed(2), orders: row.orders })),
      topProducts: [...byProduct.entries()]
        .map(([productId, row]) => ({
          productId,
          name: row.name,
          sku: row.sku,
          quantity: row.quantity.toFixed(3),
          revenue: row.revenue.toFixed(2),
        }))
        .sort((a, b) => Number(b.revenue) - Number(a.revenue))
        .slice(0, 10),
    };

    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="sales-report.csv"');
      res.send(toCsv(data.topProducts));
      return;
    }
    res.json({ data });
  }),
);

reportsRouter.get(
  '/purchasing',
  requirePermission(PERMISSIONS.REPORTS_VIEW),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const scoped = await getScopedWarehouseIds(req.user!);
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(scoped === null ? {} : { warehouseId: { in: scoped } }),
      },
      include: { supplier: { select: { name: true } } },
    });
    const byStatus = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const po of orders) {
      const row = byStatus.get(po.status) ?? { count: 0, total: new Prisma.Decimal(0) };
      row.count += 1;
      row.total = row.total.plus(po.total);
      byStatus.set(po.status, row);
    }
    const data = [...byStatus.entries()].map(([status, row]) => ({
      status,
      count: row.count,
      total: row.total.toFixed(2),
    }));
    res.json({ data });
  }),
);

reportsRouter.get(
  '/low-stock',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const rows = await prisma.inventoryBalance.findMany({
      where: { ...(scoped === null ? {} : { warehouseId: { in: scoped } }) },
      include: {
        product: { select: { id: true, name: true, sku: true, reorderLevel: true, unitOfMeasure: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });
    const low = rows
      .filter((row) => row.onHand.lessThanOrEqualTo(row.product.reorderLevel))
      .map((row) => ({
        productId: row.productId,
        product: row.product.name,
        sku: row.product.sku,
        warehouse: row.warehouse.name,
        warehouseId: row.warehouseId,
        onHand: row.onHand.toFixed(3),
        reorderLevel: row.product.reorderLevel.toFixed(3),
        unitOfMeasure: row.product.unitOfMeasure,
      }));
    res.json({ data: low });
  }),
);

reportsRouter.get(
  '/user-activity',
  requirePermission(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const logs = await prisma.auditLog.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { actorId: true, actor: { select: { name: true, email: true } }, action: true },
    });
    const byUser = new Map<string, { name: string; actions: number }>();
    for (const log of logs) {
      if (!log.actorId) continue;
      const row = byUser.get(log.actorId) ?? { name: log.actor?.name ?? 'Unknown', actions: 0 };
      row.actions += 1;
      byUser.set(log.actorId, row);
    }
    res.json({
      data: [...byUser.entries()]
        .map(([userId, row]) => ({ userId, ...row }))
        .sort((a, b) => b.actions - a.actions),
    });
  }),
);

reportsRouter.get(
  '/stock-movements',
  requirePermission(PERMISSIONS.INVENTORY_READ),
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const scoped = await getScopedWarehouseIds(req.user!);
    const rows = await prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(scoped === null ? {} : { warehouseId: { in: scoped } }),
      },
      include: {
        product: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const data = rows.map((row) => ({
      date: row.createdAt.toISOString(),
      type: row.type,
      sku: row.product.sku,
      product: row.product.name,
      warehouse: row.warehouse.name,
      quantity: row.quantity.toFixed(3),
      unitCost: row.unitCost.toFixed(2),
      balanceAfter: row.balanceAfter.toFixed(3),
      referenceType: row.referenceType ?? '',
      referenceId: row.referenceId ?? '',
    }));
    if (req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-movements.csv"');
      res.send(toCsv(data));
      return;
    }
    res.json({ data });
  }),
);

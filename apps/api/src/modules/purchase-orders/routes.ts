import { Router } from 'express';
import { z } from 'zod';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
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
import { businessNumber, roundMoney } from '../../lib/numbers';
import { recordAudit } from '../../lib/audit';
import { ensureSettings } from '../../services/inventory';
import { notify, notifyRole } from '../../services/orders';

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(requireAuth);

const createSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().positive(),
        unitCost: z.coerce.number().min(0),
        taxRate: z.coerce.number().min(0).max(100).optional(),
      }),
    )
    .min(1),
});

function serializePo(po: Record<string, unknown>) {
  return po;
}

purchaseOrdersRouter.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_READ),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['createdAt', 'total', 'poNumber'],
      defaultSort: 'createdAt',
    });
    const scoped = await getScopedWarehouseIds(req.user!);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: Prisma.PurchaseOrderWhereInput = {
      ...(scoped === null ? {} : { warehouseId: { in: scoped } }),
      ...(status && Object.values(PurchaseOrderStatus).includes(status as PurchaseOrderStatus)
        ? { status: status as PurchaseOrderStatus }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json(paginated(rows.map(serializePo), total, pagination));
  }),
);

purchaseOrdersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_READ),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        supplier: true,
        warehouse: true,
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unitOfMeasure: true } } } },
        receipts: { include: { items: true }, orderBy: { receivedAt: 'desc' } },
      },
    });
    if (!po) throw notFound('Purchase order not found');
    const scoped = await getScopedWarehouseIds(req.user!);
    if (!isWarehouseAllowed(scoped, po.warehouseId)) throw forbidden('Warehouse is out of scope');
    res.json({ data: po });
  }),
);

purchaseOrdersRouter.post(
  '/',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_WRITE),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const scoped = await getScopedWarehouseIds(req.user!);
    if (!isWarehouseAllowed(scoped, body.warehouseId)) throw forbidden('Warehouse is out of scope');

    const [supplier, warehouse, products, settings] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: body.supplierId } }),
      prisma.warehouse.findUnique({ where: { id: body.warehouseId } }),
      prisma.product.findMany({ where: { id: { in: body.items.map((i) => i.productId) } } }),
      ensureSettings(),
    ]);
    if (!supplier || !supplier.isActive) throw badRequest('Supplier is not available');
    if (!warehouse || !warehouse.isActive) throw badRequest('Warehouse is not available');
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('One or more products do not exist');
    }

    let subtotal = new Prisma.Decimal(0);
    let taxTotal = new Prisma.Decimal(0);
    const items = body.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitCost = new Prisma.Decimal(item.unitCost);
      const taxRate = new Prisma.Decimal(item.taxRate ?? 0);
      const lineTotal = quantity.times(unitCost).toDecimalPlaces(2);
      const tax = lineTotal.times(taxRate).dividedBy(100).toDecimalPlaces(2);
      subtotal = subtotal.plus(lineTotal);
      taxTotal = taxTotal.plus(tax);
      return {
        productId: item.productId,
        quantity,
        unitCost,
        taxRate,
        lineTotal,
      };
    });
    const total = subtotal.plus(taxTotal).toDecimalPlaces(2);
    const approvalRequired = total.greaterThan(settings.purchaseApprovalLimit);

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber: businessNumber('PO'),
        supplierId: body.supplierId,
        warehouseId: body.warehouseId,
        notes: body.notes,
        expectedAt: body.expectedAt ? new Date(body.expectedAt) : undefined,
        subtotal: roundMoney(subtotal.toNumber()),
        taxTotal: roundMoney(taxTotal.toNumber()),
        total: roundMoney(total.toNumber()),
        approvalRequired,
        status: 'DRAFT',
        createdById: req.user!.id,
        items: { create: items },
      },
      include: { items: true },
    });

    await recordAudit({
      actorId: req.user!.id,
      action: 'purchase_orders.created',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      after: { poNumber: po.poNumber, total: po.total.toFixed(2), approvalRequired },
      req,
    });
    res.status(201).json({ data: po });
  }),
);

purchaseOrdersRouter.post(
  '/:id/submit',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_WRITE),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) throw notFound('Purchase order not found');
    if (po.status !== 'DRAFT') throw conflict('Only draft purchase orders can be submitted');
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'purchase_orders.submitted',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      before: { status: po.status },
      after: { status: 'SUBMITTED' },
      req,
    });
    await notifyRole(
      'ADMIN',
      'PURCHASE_ORDER',
      'Purchase order awaiting approval',
      `${po.poNumber} was submitted and is awaiting approval.`,
      `/purchase-orders/${po.id}`,
    );
    await notifyRole(
      'SUPER_ADMIN',
      'PURCHASE_ORDER',
      'Purchase order awaiting approval',
      `${po.poNumber} was submitted and is awaiting approval.`,
      `/purchase-orders/${po.id}`,
    );
    res.json({ data: updated });
  }),
);

purchaseOrdersRouter.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_APPROVE),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) throw notFound('Purchase order not found');
    if (po.status !== 'SUBMITTED') throw conflict('Only submitted purchase orders can be approved');
    if (po.approvalRequired && !hasPermission(req.user!, PERMISSIONS.PURCHASE_ORDERS_APPROVE_UNLIMITED)) {
      throw forbidden('This purchase order exceeds your approval limit');
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'APPROVED', approvedById: req.user!.id, approvedAt: new Date() },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'purchase_orders.approved',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      before: { status: po.status },
      after: { status: 'APPROVED' },
      req,
    });
    await notify(
      po.createdById,
      'PURCHASE_ORDER',
      'Purchase order approved',
      `${po.poNumber} has been approved and can be received.`,
      `/purchase-orders/${po.id}`,
    );
    res.json({ data: updated });
  }),
);

purchaseOrdersRouter.post(
  '/:id/reject',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_APPROVE),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) throw notFound('Purchase order not found');
    if (po.status !== 'SUBMITTED') throw conflict('Only submitted purchase orders can be rejected');
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'REJECTED', approvedById: req.user!.id, approvedAt: new Date() },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'purchase_orders.rejected',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      before: { status: po.status },
      after: { status: 'REJECTED' },
      req,
    });
    res.json({ data: updated });
  }),
);

purchaseOrdersRouter.post(
  '/:id/cancel',
  requirePermission(PERMISSIONS.PURCHASE_ORDERS_WRITE),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) throw notFound('Purchase order not found');
    if (!['DRAFT', 'SUBMITTED', 'APPROVED'].includes(po.status)) {
      throw conflict('This purchase order can no longer be cancelled');
    }
    const updated = await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: { status: 'CANCELLED' },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'purchase_orders.cancelled',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      before: { status: po.status },
      after: { status: 'CANCELLED' },
      req,
    });
    res.json({ data: updated });
  }),
);

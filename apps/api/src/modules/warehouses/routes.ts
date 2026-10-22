import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, conflict, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { getScopedWarehouseIds, requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';

export const warehousesRouter = Router();
warehousesRouter.use(requireAuth);

warehousesRouter.get(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_READ),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const warehouses = await prisma.warehouse.findMany({
      where: {
        ...(scoped === null ? {} : { id: { in: scoped } }),
        ...(req.user!.role === 'CUSTOMER' ? { isActive: true } : {}),
      },
      orderBy: { name: 'asc' },
      include: { locations: { where: { isActive: true } }, _count: { select: { balances: true } } },
    });
    res.json({ data: warehouses });
  }),
);

const schema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  address: z.string().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

warehousesRouter.post(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_WRITE),
  validate({ body: schema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof schema>;
    const warehouse = await prisma.warehouse.create({ data: body });
    await recordAudit({
      actorId: req.user!.id,
      action: 'warehouses.created',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      after: { code: warehouse.code, name: warehouse.name },
      req,
    });
    res.status(201).json({ data: warehouse });
  }),
);

warehousesRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.WAREHOUSES_WRITE),
  validate({ body: schema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Warehouse not found');
    const warehouse = await prisma.warehouse.update({
      where: { id: existing.id },
      data: req.body as z.infer<typeof schema>,
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'warehouses.updated',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: warehouse.name, isActive: warehouse.isActive },
      req,
    });
    res.json({ data: warehouse });
  }),
);

warehousesRouter.post(
  '/:id/deactivate',
  requirePermission(PERMISSIONS.WAREHOUSES_WRITE),
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { balances: { where: { onHand: { gt: 0 } } } } } },
    });
    if (!warehouse) throw notFound('Warehouse not found');
    if (warehouse._count.balances > 0) {
      throw conflict('Move or adjust all stock out of this warehouse before deactivating it');
    }
    await prisma.warehouse.update({ where: { id: warehouse.id }, data: { isActive: false } });
    await recordAudit({
      actorId: req.user!.id,
      action: 'warehouses.deactivated',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      req,
    });
    res.json({ data: { id: warehouse.id, isActive: false } });
  }),
);

const locationSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
});

warehousesRouter.post(
  '/:id/locations',
  requirePermission(PERMISSIONS.WAREHOUSES_WRITE),
  validate({ body: locationSchema }),
  asyncHandler(async (req, res) => {
    const warehouse = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
    if (!warehouse) throw notFound('Warehouse not found');
    const location = await prisma.warehouseLocation.create({
      data: { warehouseId: warehouse.id, ...(req.body as z.infer<typeof locationSchema>) },
    });
    res.status(201).json({ data: location });
  }),
);

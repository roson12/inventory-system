import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { hasPermission, requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

function serialize(supplier: Record<string, unknown>, includeCosts: boolean) {
  if (includeCosts) return supplier;
  const { products, ...rest } = supplier as { products?: unknown[] };
  return {
    ...rest,
    products: Array.isArray(products)
      ? products.map((p) => {
          const { unitCost, ...productRest } = p as Record<string, unknown>;
          return productRest;
        })
      : products,
  };
}

suppliersRouter.get(
  '/',
  requirePermission(PERMISSIONS.SUPPLIERS_READ),
  asyncHandler(async (req, res) => {
    const includeCosts = hasPermission(req.user!, PERMISSIONS.SUPPLIER_COSTS_READ);
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        products: { include: { product: { select: { id: true, name: true, sku: true } } } },
        _count: { select: { purchaseOrders: true } },
      },
    });
    res.json({ data: suppliers.map((s) => serialize(s, includeCosts)) });
  }),
);

suppliersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.SUPPLIERS_READ),
  asyncHandler(async (req, res) => {
    const includeCosts = hasPermission(req.user!, PERMISSIONS.SUPPLIER_COSTS_READ);
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        products: { include: { product: true } },
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            poNumber: true,
            status: true,
            total: true,
            createdAt: true,
            warehouse: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!supplier) throw notFound('Supplier not found');
    res.json({ data: serialize(supplier, includeCosts) });
  }),
);

const schema = z.object({
  name: z.string().trim().min(2).max(200),
  contactName: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

suppliersRouter.post(
  '/',
  requirePermission(PERMISSIONS.SUPPLIERS_WRITE),
  validate({ body: schema }),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.create({ data: req.body as z.infer<typeof schema> });
    await recordAudit({
      actorId: req.user!.id,
      action: 'suppliers.created',
      entityType: 'Supplier',
      entityId: supplier.id,
      after: { name: supplier.name },
      req,
    });
    res.status(201).json({ data: supplier });
  }),
);

suppliersRouter.patch(
  '/:id',
  requirePermission(PERMISSIONS.SUPPLIERS_WRITE),
  validate({ body: schema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Supplier not found');
    const supplier = await prisma.supplier.update({
      where: { id: existing.id },
      data: req.body as Partial<z.infer<typeof schema>>,
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'suppliers.updated',
      entityType: 'Supplier',
      entityId: supplier.id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: supplier.name, isActive: supplier.isActive },
      req,
    });
    res.json({ data: supplier });
  }),
);

const supplierProductSchema = z.object({
  productId: z.string().uuid(),
  supplierSku: z.string().max(80).nullable().optional(),
  unitCost: z.coerce.number().min(0),
  leadTimeDays: z.coerce.number().int().min(0).max(3650).optional(),
});

suppliersRouter.post(
  '/:id/products',
  requirePermission(PERMISSIONS.SUPPLIERS_WRITE),
  requirePermission(PERMISSIONS.SUPPLIER_COSTS_READ),
  validate({ body: supplierProductSchema }),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) throw notFound('Supplier not found');
    const body = req.body as z.infer<typeof supplierProductSchema>;
    const link = await prisma.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: supplier.id, productId: body.productId } },
      create: { supplierId: supplier.id, ...body },
      update: body,
    });
    res.status(201).json({ data: link });
  }),
);

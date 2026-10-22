import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, conflict, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';

export const categoriesRouter = Router();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

categoriesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.json({ data: categories });
  }),
);

categoriesRouter.get(
  '/manage',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_READ),
  asyncHandler(async (_req, res) => {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } }, parent: true },
    });
    res.json({ data: categories });
  }),
);

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

categoriesRouter.post(
  '/',
  requireAuth,
  requirePermission(PERMISSIONS.CATEGORIES_WRITE),
  validate({ body: schema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof schema>;
    if (body.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) throw notFound('Parent category not found');
    }
    const category = await prisma.category.create({
      data: { ...body, slug: slugify(body.name) },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'categories.created',
      entityType: 'Category',
      entityId: category.id,
      after: { name: category.name },
      req,
    });
    res.status(201).json({ data: category });
  }),
);

categoriesRouter.patch(
  '/:id',
  requireAuth,
  requirePermission(PERMISSIONS.CATEGORIES_WRITE),
  validate({ body: schema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Category not found');
    const body = req.body as Partial<z.infer<typeof schema>>;
    if (body.parentId) {
      if (body.parentId === existing.id) throw conflict('A category cannot be its own parent');
      const parent = await prisma.category.findUnique({ where: { id: body.parentId } });
      if (!parent) throw notFound('Parent category not found');
    }
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: {
        ...body,
        ...(body.name ? { slug: slugify(body.name) } : {}),
      },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'categories.updated',
      entityType: 'Category',
      entityId: category.id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: category.name, isActive: category.isActive },
      req,
    });
    res.json({ data: category });
  }),
);

categoriesRouter.post(
  '/:id/deactivate',
  requireAuth,
  requirePermission(PERMISSIONS.CATEGORIES_WRITE),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
    });
    if (!category) throw notFound('Category not found');
    if (category._count.products > 0) {
      throw conflict('Reassign active products before deactivating this category');
    }
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    await recordAudit({
      actorId: req.user!.id,
      action: 'categories.deactivated',
      entityType: 'Category',
      entityId: category.id,
      req,
    });
    res.json({ data: { id: category.id, isActive: false } });
  }),
);

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError, asyncHandler, badRequest, conflict, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { getPagination, paginated } from '../../lib/pagination';
import { recordAudit } from '../../lib/audit';
import { env } from '../../config/env';

export const productsRouter = Router();

fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const extensionByMime: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${extensionByMime[file.mimetype] ?? ''}`),
  }),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowedMime.has(file.mimetype)) {
      cb(new Error('Only JPEG, PNG, WebP, or GIF images are allowed'));
      return;
    }
    cb(null, true);
  },
});

const listQuery = z.object({
  search: z.string().trim().optional(),
  categoryId: z.string().uuid().optional(),
  barcode: z.string().trim().optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

async function availabilityFor(productIds: string[], warehouseIds: string[] | null = null) {
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      productId: { in: productIds },
      ...(warehouseIds === null ? {} : { warehouseId: { in: warehouseIds } }),
    },
  });
  const map = new Map<string, { onHand: Prisma.Decimal; reserved: Prisma.Decimal }>();
  for (const b of balances) {
    const current = map.get(b.productId) ?? {
      onHand: new Prisma.Decimal(0),
      reserved: new Prisma.Decimal(0),
    };
    map.set(b.productId, {
      onHand: current.onHand.plus(b.onHand),
      reserved: current.reserved.plus(b.reserved),
    });
  }
  return map;
}

function serializeProduct(
  product: Prisma.ProductGetPayload<{ include: { images: true; category: true } }>,
  includeCost: boolean,
  availability?: { onHand: Prisma.Decimal; reserved: Prisma.Decimal },
) {
  return {
    id: product.id,
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    unitOfMeasure: product.unitOfMeasure,
    sellingPrice: product.sellingPrice.toFixed(2),
    reorderLevel: product.reorderLevel.toFixed(3),
    isActive: product.isActive,
    archivedAt: product.archivedAt,
    category: product.category,
    images: product.images,
    available: availability
      ? availability.onHand.minus(availability.reserved).toFixed(3)
      : '0.000',
    onHand: includeCost && availability ? availability.onHand.toFixed(3) : undefined,
    ...(includeCost
      ? { costPrice: product.costPrice.toFixed(2), createdById: product.createdById }
      : {}),
  };
}

productsRouter.get(
  '/',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['name', 'sku', 'sellingPrice', 'createdAt'],
      defaultSort: 'name',
    });
    const q = req.query as z.infer<typeof listQuery>;
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      archivedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { sku: { contains: q.search, mode: 'insensitive' } },
              { barcode: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.barcode ? { barcode: { equals: q.barcode } } : {}),
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { images: { orderBy: { isPrimary: 'desc' } }, category: true },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.product.count({ where }),
    ]);
    const availability = await availabilityFor(products.map((p) => p.id));
    res.json(
      paginated(
        products.map((p) => serializeProduct(p, false, availability.get(p.id))),
        total,
        pagination,
      ),
    );
  }),
);

productsRouter.get(
  '/manage/list',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_READ),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['name', 'sku', 'sellingPrice', 'createdAt'],
      defaultSort: 'name',
    });
    const q = req.query as z.infer<typeof listQuery>;
    const where: Prisma.ProductWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { sku: { contains: q.search, mode: 'insensitive' } },
              { barcode: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.barcode ? { barcode: { equals: q.barcode } } : {}),
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { images: { orderBy: { isPrimary: 'desc' } }, category: true },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.product.count({ where }),
    ]);
    const availability = await availabilityFor(products.map((p) => p.id));
    res.json(
      paginated(
        products.map((p) => serializeProduct(p, true, availability.get(p.id))),
        total,
        pagination,
      ),
    );
  }),
);

productsRouter.get(
  '/manage/:id',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_READ),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { images: true, category: true, supplierProducts: { include: { supplier: true } } },
    });
    if (!product) throw notFound('Product not found');
    const availability = await availabilityFor([product.id]);
    res.json({ data: { ...serializeProduct(product, true, availability.get(product.id)), supplierProducts: product.supplierProducts } });
  }),
);

productsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, isActive: true, archivedAt: null },
      include: { images: { orderBy: { isPrimary: 'desc' } }, category: true },
    });
    if (!product) throw notFound('Product not found');
    const availability = await availabilityFor([product.id]);
    res.json({ data: serializeProduct(product, false, availability.get(product.id)) });
  }),
);

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(80).nullable().optional(),
  name: z.string().trim().min(2).max(200),
  description: z.string().max(5000).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  unitOfMeasure: z.string().trim().min(1).max(20).default('unit'),
  costPrice: z.coerce.number().min(0).default(0),
  sellingPrice: z.coerce.number().min(0).default(0),
  reorderLevel: z.coerce.number().min(0).default(0),
  isActive: z.boolean().optional(),
});

productsRouter.post(
  '/',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  validate({ body: productSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof productSchema>;
    if (body.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
      if (!category) throw badRequest('Category does not exist');
    }
    const product = await prisma.product.create({
      data: {
        ...body,
        barcode: body.barcode || null,
        costPrice: new Prisma.Decimal(body.costPrice.toFixed(2)),
        sellingPrice: new Prisma.Decimal(body.sellingPrice.toFixed(2)),
        reorderLevel: new Prisma.Decimal(body.reorderLevel.toFixed(3)),
        createdById: req.user!.id,
      },
      include: { images: true, category: true },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'products.created',
      entityType: 'Product',
      entityId: product.id,
      after: { sku: product.sku, name: product.name },
      req,
    });
    res.status(201).json({ data: serializeProduct(product, true) });
  }),
);

productsRouter.patch(
  '/:id',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  validate({ body: productSchema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Product not found');
    const body = req.body as Partial<z.infer<typeof productSchema>>;
    if (body.categoryId) {
      const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
      if (!category) throw badRequest('Category does not exist');
    }
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...body,
        ...(body.barcode !== undefined ? { barcode: body.barcode || null } : {}),
        ...(body.costPrice !== undefined
          ? { costPrice: new Prisma.Decimal(body.costPrice.toFixed(2)) }
          : {}),
        ...(body.sellingPrice !== undefined
          ? { sellingPrice: new Prisma.Decimal(body.sellingPrice.toFixed(2)) }
          : {}),
        ...(body.reorderLevel !== undefined
          ? { reorderLevel: new Prisma.Decimal(body.reorderLevel.toFixed(3)) }
          : {}),
      },
      include: { images: true, category: true },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'products.updated',
      entityType: 'Product',
      entityId: product.id,
      before: { sku: existing.sku, name: existing.name, sellingPrice: existing.sellingPrice.toFixed(2) },
      after: { sku: product.sku, name: product.name, sellingPrice: product.sellingPrice.toFixed(2) },
      req,
    });
    res.json({ data: serializeProduct(product, true) });
  }),
);

productsRouter.post(
  '/:id/archive',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Product not found');
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { isActive: false, archivedAt: new Date() },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'products.archived',
      entityType: 'Product',
      entityId: product.id,
      before: { isActive: existing.isActive },
      after: { isActive: false, archivedAt: product.archivedAt },
      req,
    });
    res.json({ data: { id: product.id, isActive: false } });
  }),
);

productsRouter.post(
  '/:id/images',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('An image file is required');
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) throw notFound('Product not found');

    const image = await prisma.productImage.create({
      data: {
        productId: product.id,
        url: `/uploads/${req.file.filename}`,
        altText: typeof req.body.altText === 'string' ? req.body.altText : undefined,
        uploadedById: req.user!.id,
        isPrimary: (await prisma.productImage.count({ where: { productId: product.id } })) === 0,
      },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'products.image_uploaded',
      entityType: 'ProductImage',
      entityId: image.id,
      after: { productId: product.id, url: image.url },
      req,
    });
    res.status(201).json({ data: image });
  }),
);

productsRouter.delete(
  '/:id/images/:imageId',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  asyncHandler(async (req, res) => {
    const image = await prisma.productImage.findFirst({
      where: { id: req.params.imageId, productId: req.params.id },
    });
    if (!image) throw notFound('Image not found');

    await prisma.productImage.delete({ where: { id: image.id } });
    const filename = path.basename(image.url);
    const filePath = path.join(env.UPLOAD_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await recordAudit({
      actorId: req.user!.id,
      action: 'products.image_deleted',
      entityType: 'ProductImage',
      entityId: image.id,
      before: { url: image.url },
      req,
    });
    res.status(204).end();
  }),
);

productsRouter.post(
  '/:id/primary-image/:imageId',
  requireAuth,
  requirePermission(PERMISSIONS.PRODUCTS_WRITE),
  asyncHandler(async (req, res) => {
    const image = await prisma.productImage.findFirst({
      where: { id: req.params.imageId, productId: req.params.id },
    });
    if (!image) throw notFound('Image not found');
    await prisma.$transaction([
      prisma.productImage.updateMany({ where: { productId: req.params.id }, data: { isPrimary: false } }),
      prisma.productImage.update({ where: { id: image.id }, data: { isPrimary: true } }),
    ]);
    res.json({ data: { id: image.id, isPrimary: true } });
  }),
);

// Multer and file-filter errors become clean 4xx responses.
productsRouter.use((err: unknown, _req: unknown, _res: unknown, next: (e: unknown) => void) => {
  if (err instanceof multer.MulterError || (err instanceof Error && err.message.startsWith('Only '))) {
    return next(new AppError(400, 'UPLOAD_ERROR', err.message));
  }
  return next(err);
});

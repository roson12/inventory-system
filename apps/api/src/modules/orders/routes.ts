import { Router } from 'express';
import { z } from 'zod';
import { Prisma, CustomerOrderStatus } from '@prisma/client';
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
import {
  advanceOrder,
  cancelOrder,
  confirmOrder,
  createCustomerOrder,
  markOrderPaid,
} from '../../services/orders';

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

const createSchema = z.object({
  customerId: z.string().uuid().optional(),
  shippingName: z.string().trim().min(2).max(200),
  shippingPhone: z.string().trim().max(30).optional(),
  shippingAddress: z.string().trim().min(5).max(1000),
  notes: z.string().max(2000).optional(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.coerce.number().positive() }))
    .min(1),
});

const include = {
  items: true,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  reservations: true,
} satisfies Prisma.CustomerOrderInclude;

ordersRouter.post(
  '/',
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    let customerId: string;
    if (req.user!.role === 'CUSTOMER') {
      if (!req.user!.customerId) throw forbidden('Customer profile is missing');
      customerId = req.user!.id;
    } else {
      if (!hasPermission(req.user!, PERMISSIONS.ORDERS_CREATE)) {
        throw forbidden('Missing permission: orders.create');
      }
      customerId = body.customerId ?? req.user!.id;
      const customer = await prisma.user.findUnique({ where: { id: customerId } });
      if (!customer || customer.role !== 'CUSTOMER') throw badRequest('customerId must be a Customer');
    }

    const order = await createCustomerOrder({
      customerId,
      items: body.items,
      shippingName: body.shippingName,
      shippingPhone: body.shippingPhone,
      shippingAddress: body.shippingAddress,
      notes: body.notes,
    });
    res.status(201).json({ data: order });
  }),
);

ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['placedAt', 'total', 'status'],
      defaultSort: 'placedAt',
    });
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    let where: Prisma.CustomerOrderWhereInput = {};

    if (req.user!.role === 'CUSTOMER') {
      where.customerId = req.user!.id;
    } else if (hasPermission(req.user!, PERMISSIONS.ORDERS_READ_ALL)) {
      const scoped = await getScopedWarehouseIds(req.user!);
      if (scoped !== null) {
        where.OR = [{ warehouseId: { in: scoped } }, { status: 'PENDING' }];
      }
    } else if (hasPermission(req.user!, PERMISSIONS.ORDERS_READ_ASSIGNED)) {
      const scoped = await getScopedWarehouseIds(req.user!);
      where.OR = [{ warehouseId: { in: scoped ?? [] } }, { status: 'PENDING' }];
    } else {
      where.customerId = req.user!.id;
    }

    if (status && Object.values(CustomerOrderStatus).includes(status as CustomerOrderStatus)) {
      where = { AND: [where, { status: status as CustomerOrderStatus }] };
    }
    if (q) {
      where = {
        AND: [
          where,
          {
            OR: [
              { orderNumber: { contains: q, mode: 'insensitive' } },
              { customer: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.customerOrder.findMany({
        where,
        include,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.customerOrder.count({ where }),
    ]);
    res.json(paginated(rows, total, pagination));
  }),
);

async function loadOrderForUser(
  req: Parameters<typeof requireAuth>[0],
  id: string,
) {
  const order = await prisma.customerOrder.findUnique({ where: { id }, include });
  if (!order) throw notFound('Customer order not found');

  if (req.user!.role === 'CUSTOMER') {
    if (order.customerId !== req.user!.id) throw forbidden('You can only view your own orders');
    return order;
  }
  if (hasPermission(req.user!, PERMISSIONS.ORDERS_READ_ALL)) {
    const scoped = await getScopedWarehouseIds(req.user!);
    if (order.warehouseId && scoped !== null && !isWarehouseAllowed(scoped, order.warehouseId)) {
      throw forbidden('Order is outside your warehouse scope');
    }
    return order;
  }
  if (hasPermission(req.user!, PERMISSIONS.ORDERS_READ_ASSIGNED)) {
    const scoped = await getScopedWarehouseIds(req.user!);
    if (order.warehouseId && !isWarehouseAllowed(scoped, order.warehouseId)) {
      throw forbidden('Order is outside your warehouse scope');
    }
    if (!order.warehouseId && order.status !== 'PENDING') {
      throw forbidden('Order is outside your warehouse scope');
    }
    return order;
  }
  throw forbidden('You do not have permission to view this order');
}

ordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ data: await loadOrderForUser(req, req.params.id) });
  }),
);

ordersRouter.post(
  '/:id/confirm',
  requirePermission(PERMISSIONS.ORDERS_CONFIRM),
  asyncHandler(async (req, res) => {
    const scoped = await getScopedWarehouseIds(req.user!);
    const order = await prisma.customerOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Customer order not found');
    const updated = await confirmOrder(order.id, req.user!.id, scoped);
    res.json({ data: updated });
  }),
);

const cancelSchema = z.object({ reason: z.string().max(500).optional() });

ordersRouter.post(
  '/:id/cancel',
  validate({ body: cancelSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof cancelSchema>;
    if (req.user!.role === 'CUSTOMER') {
      const updated = await cancelOrder(req.params.id, req.user!.id, {
        asCustomerId: req.user!.id,
        reason: body.reason,
      });
      res.json({ data: updated });
      return;
    }
    if (!hasPermission(req.user!, PERMISSIONS.ORDERS_CANCEL)) {
      throw forbidden('Missing permission: orders.cancel');
    }
    const order = await prisma.customerOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Customer order not found');
    if (order.warehouseId) {
      const scoped = await getScopedWarehouseIds(req.user!);
      if (!isWarehouseAllowed(scoped, order.warehouseId)) throw forbidden('Warehouse is out of scope');
    }
    const updated = await cancelOrder(order.id, req.user!.id, { reason: body.reason });
    res.json({ data: updated });
  }),
);

const transitionSchema = z.object({
  status: z.enum(['PROCESSING', 'READY_FOR_DISPATCH', 'SHIPPED', 'DELIVERED']),
});

ordersRouter.post(
  '/:id/transition',
  requirePermission(PERMISSIONS.ORDERS_PROCESS),
  validate({ body: transitionSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof transitionSchema>;
    const order = await prisma.customerOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Customer order not found');
    if (order.warehouseId) {
      const scoped = await getScopedWarehouseIds(req.user!);
      if (!isWarehouseAllowed(scoped, order.warehouseId)) throw forbidden('Warehouse is out of scope');
    }
    const updated = await advanceOrder(order.id, body.status, req.user!.id);
    res.json({ data: updated });
  }),
);

const paymentSchema = z.object({
  paymentMethod: z.string().trim().min(2).max(50),
  paymentReference: z.string().trim().max(100).optional(),
});

ordersRouter.post(
  '/:id/payment',
  requirePermission(PERMISSIONS.ORDERS_MARK_PAID),
  validate({ body: paymentSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof paymentSchema>;
    const updated = await markOrderPaid(req.params.id, req.user!.id, body);
    res.json({ data: updated });
  }),
);

// Explicitly reject unsupported transitions early with a clear error.
ordersRouter.post(
  '/:id/status',
  asyncHandler(async () => {
    throw badRequest('Use /transition with a valid status');
  }),
);

import { Prisma, type CustomerOrderStatus, type NotificationType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { businessNumber, roundMoney } from '../lib/numbers';
import { recordAudit } from '../lib/audit';
import { applyMovement, consumeReservations, ensureSettings, releaseReservations, reserveStock } from './inventory';

export const ORDER_TRANSITIONS: Record<CustomerOrderStatus, CustomerOrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY_FOR_DISPATCH', 'CANCELLED'],
  READY_FOR_DISPATCH: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  RETURNED: [],
};

export async function notify(
  userId: string,
  type: NotificationType,
  title: string,
  message: string,
  link?: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
) {
  await db.notification.create({ data: { userId, type, title, message, link } });
}

export async function notifyRole(
  role: 'SUPER_ADMIN' | 'ADMIN',
  type: NotificationType,
  title: string,
  message: string,
  link?: string,
) {
  const users = await prisma.user.findMany({
    where: { role, status: 'ACTIVE' },
    select: { id: true },
  });
  if (users.length === 0) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, type, title, message, link })),
  });
}

export interface OrderLineInput {
  productId: string;
  quantity: Prisma.Decimal | number | string;
}

export interface CreateOrderInput {
  customerId: string;
  items: OrderLineInput[];
  shippingName: string;
  shippingPhone?: string;
  shippingAddress: string;
  notes?: string;
}

export async function createCustomerOrder(input: CreateOrderInput) {
  if (input.items.length === 0) throw badRequest('An order needs at least one item');
  const settings = await ensureSettings();

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true, archivedAt: null },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  let subtotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);
  const lines: Prisma.CustomerOrderItemCreateWithoutOrderInput[] = [];

  for (const item of input.items) {
    const product = productMap.get(item.productId);
    if (!product) throw badRequest(`Product ${item.productId} is not available for sale`);
    const quantity = new Prisma.Decimal(item.quantity);
    if (quantity.lessThanOrEqualTo(0)) throw badRequest('Order quantities must be positive');
    if (quantity.decimalPlaces() > 3) throw badRequest('Quantities may have at most 3 decimals');

    const unitPrice = new Prisma.Decimal(product.sellingPrice);
    const lineTotal = unitPrice.times(quantity).toDecimalPlaces(2);
    const taxRate = settings.taxEnabled ? new Prisma.Decimal(settings.defaultTaxRate) : new Prisma.Decimal(0);
    const taxAmount = lineTotal.times(taxRate).dividedBy(100).toDecimalPlaces(2);

    subtotal = subtotal.plus(lineTotal);
    taxTotal = taxTotal.plus(taxAmount);

    lines.push({
      product: { connect: { id: product.id } },
      productName: product.name,
      sku: product.sku,
      quantity,
      unitPrice,
      taxRate,
      taxAmount,
      lineTotal,
    });
  }

  const total = subtotal.plus(taxTotal).toDecimalPlaces(2);

  const order = await prisma.customerOrder.create({
    data: {
      orderNumber: businessNumber('ORD'),
      customer: { connect: { id: input.customerId } },
      status: 'PENDING',
      subtotal: roundMoney(subtotal.toNumber()),
      taxTotal: roundMoney(taxTotal.toNumber()),
      total: roundMoney(total.toNumber()),
      currencyCode: settings.currencyCode,
      shippingName: input.shippingName,
      shippingPhone: input.shippingPhone,
      shippingAddress: input.shippingAddress,
      notes: input.notes,
      items: { create: lines },
    },
    include: { items: true },
  });

  await recordAudit({
    actorId: input.customerId,
    action: 'orders.created',
    entityType: 'CustomerOrder',
    entityId: order.id,
    after: { orderNumber: order.orderNumber, total: order.total.toFixed(2), status: order.status },
  });

  return order;
}

/** Chooses the accessible warehouse with the greatest availability across every line. */
async function chooseFulfillmentWarehouse(
  productIds: string[],
  quantities: Map<string, Prisma.Decimal>,
  warehouseIds: string[] | null,
): Promise<string> {
  const warehouses = await prisma.warehouse.findMany({
    where: {
      isActive: true,
      ...(warehouseIds === null ? {} : { id: { in: warehouseIds } }),
    },
    select: { id: true, name: true },
  });
  if (warehouses.length === 0) throw conflict('No accessible warehouse is available');

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      productId: { in: productIds },
      warehouseId: { in: warehouses.map((w) => w.id) },
    },
  });

  let best: { warehouseId: string; score: Prisma.Decimal } | null = null;
  for (const warehouse of warehouses) {
    let minAvailable: Prisma.Decimal | null = null;
    for (const productId of productIds) {
      const balance = balances.find(
        (b) => b.warehouseId === warehouse.id && b.productId === productId,
      );
      const available = balance
        ? new Prisma.Decimal(balance.onHand).minus(balance.reserved)
        : new Prisma.Decimal(0);
      const needed = quantities.get(productId)!;
      if (minAvailable === null || available.lessThan(minAvailable)) minAvailable = available;
      if (available.lessThan(needed) && (best === null || minAvailable.lessThan(best.score))) {
        // still track score for a helpful error
      }
    }
    const score = minAvailable ?? new Prisma.Decimal(0);
    if (!best || score.greaterThan(best.score)) {
      best = { warehouseId: warehouse.id, score };
    }
  }

  if (!best) throw conflict('No warehouse can fulfill this order');
  const short = productIds.find(
    (productId) => quantities.get(productId)!.greaterThan(best!.score),
  );
  if (short) {
    throw conflict('Insufficient available stock to confirm this order', {
      productId: short,
      requested: quantities.get(short)!.toFixed(3),
    });
  }
  return best.warehouseId;
}

/**
 * Confirms a Pending order and reserves stock atomically. Only one confirmation
 * can win; a concurrent or repeated confirmation fails without double-reserving.
 */
export async function confirmOrder(
  orderId: string,
  actorId: string,
  warehouseIds: string[] | null,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw notFound('Customer order not found');
    if (order.status !== 'PENDING') {
      throw conflict(`Order cannot be confirmed from status ${order.status}`);
    }

    const quantities = new Map<string, Prisma.Decimal>();
    for (const item of order.items) {
      quantities.set(item.productId, new Prisma.Decimal(item.quantity));
    }
    const productIds = order.items.map((i) => i.productId);
    const warehouseId = order.warehouseId ?? (await chooseFulfillmentWarehouse(productIds, quantities, warehouseIds));

    // Lock and refresh the order status inside the transaction: the row lock makes
    // confirmation idempotent under concurrency.
    const locked = await tx.$queryRaw<
      { id: string; status: CustomerOrderStatus }[]
    >`SELECT "id", "status" FROM "CustomerOrder" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
    if (!locked[0] || locked[0].status !== 'PENDING') {
      throw conflict('Order has already been processed');
    }

    await reserveStock(
      tx,
      order.id,
      warehouseId,
      order.items.map((item) => ({
        productId: item.productId,
        quantity: new Prisma.Decimal(item.quantity),
      })),
    );

    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        status: 'CONFIRMED',
        warehouseId,
        confirmedAt: new Date(),
        processedById: actorId,
      },
    });

    await recordAudit(
      {
        actorId,
        action: 'orders.confirmed',
        entityType: 'CustomerOrder',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'CONFIRMED', warehouseId },
      },
      tx,
    );

    await notify(
      order.customerId,
      'ORDER_UPDATE',
      'Order confirmed',
      `Order ${order.orderNumber} has been confirmed and stock reserved.`,
      `/orders/${order.id}`,
      tx,
    );

    return updated;
  });
}

export async function cancelOrder(
  orderId: string,
  actorId: string,
  options: { asCustomerId?: string; reason?: string } = {},
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({ where: { id: orderId } });
    if (!order) throw notFound('Customer order not found');
    if (options.asCustomerId && order.customerId !== options.asCustomerId) {
      throw forbidden('You can only cancel your own orders');
    }
    if (options.asCustomerId && order.status !== 'PENDING') {
      throw conflict('This order can no longer be cancelled by the customer');
    }
    if (['SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status)) {
      throw conflict(`Order cannot be cancelled from status ${order.status}`);
    }

    if (order.status !== 'PENDING') {
      await releaseReservations(tx, order.id);
    }
    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: options.reason,
        processedById: actorId,
      },
    });
    await recordAudit(
      {
        actorId,
        action: 'orders.cancelled',
        entityType: 'CustomerOrder',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'CANCELLED', reason: options.reason },
      },
      tx,
    );
    return updated;
  });
}

export async function advanceOrder(
  orderId: string,
  target: Exclude<CustomerOrderStatus, 'PENDING' | 'CONFIRMED' | 'CANCELLED'>,
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw notFound('Customer order not found');

    const allowed = ORDER_TRANSITIONS[order.status];
    if (!allowed.includes(target)) {
      throw conflict(`Invalid transition from ${order.status} to ${target}`);
    }

    if (target === 'SHIPPED') {
      if (!order.warehouseId) throw conflict('Order has no fulfillment warehouse');
      await consumeReservations(tx, order.id);
      const settings = await tx.systemSetting.findUnique({ where: { id: 1 } });
      for (const item of order.items) {
        await applyMovement(
          tx,
          {
            productId: item.productId,
            warehouseId: order.warehouseId,
            type: 'ISSUE',
            quantity: new Prisma.Decimal(item.quantity).negated(),
            referenceType: 'CustomerOrder',
            referenceId: order.id,
            actorId,
            reason: `Dispatch of ${order.orderNumber}`,
          },
          { allowNegativeStock: settings?.allowNegativeStock ?? false },
        );
      }
    }

    const timestamp =
      target === 'PROCESSING'
        ? { processingAt: new Date() }
        : target === 'READY_FOR_DISPATCH'
          ? { readyForDispatchAt: new Date() }
          : target === 'SHIPPED'
            ? { dispatchedAt: new Date() }
            : target === 'DELIVERED'
              ? { deliveredAt: new Date() }
              : {};

    const updated = await tx.customerOrder.update({
      where: { id: order.id },
      data: { status: target, processedById: actorId, ...timestamp },
    });

    await recordAudit(
      {
        actorId,
        action: `orders.${target.toLowerCase()}`,
        entityType: 'CustomerOrder',
        entityId: order.id,
        before: { status: order.status },
        after: { status: target },
      },
      tx,
    );

    await notify(
      order.customerId,
      'ORDER_UPDATE',
      `Order ${target.replaceAll('_', ' ').toLowerCase()}`,
      `Order ${order.orderNumber} is now ${target.replaceAll('_', ' ').toLowerCase()}.`,
      `/orders/${order.id}`,
      tx,
    );

    return updated;
  });
}

export async function markOrderPaid(
  orderId: string,
  actorId: string,
  input: { paymentMethod: string; paymentReference?: string },
) {
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId } });
  if (!order) throw notFound('Customer order not found');
  if (order.paymentStatus === 'PAID') throw conflict('Order is already marked paid');
  if (order.status === 'CANCELLED') throw conflict('Cancelled orders cannot be marked paid');

  const updated = await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      paymentStatus: 'PAID',
      paymentMethod: input.paymentMethod,
      paymentReference: input.paymentReference,
      paidAt: new Date(),
      processedById: actorId,
    },
  });
  await recordAudit({
    actorId,
    action: 'orders.payment_recorded',
    entityType: 'CustomerOrder',
    entityId: order.id,
    before: { paymentStatus: order.paymentStatus },
    after: { paymentStatus: 'PAID', paymentMethod: input.paymentMethod },
  });
  return updated;
}

export async function notifyLowStock(
  productId: string,
  warehouseId: string,
): Promise<void> {
  const [product, balance] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId } }),
    prisma.inventoryBalance.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    }),
  ]);
  if (!product || !balance) return;
  if (new Prisma.Decimal(balance.onHand).greaterThan(product.reorderLevel)) return;

  await notifyRole(
    'ADMIN',
    'LOW_STOCK',
    `Low stock: ${product.name}`,
    `${product.sku} has ${balance.onHand.toFixed(3)} ${product.unitOfMeasure} on hand (reorder level ${product.reorderLevel.toFixed(3)}).`,
    '/inventory',
  );
  await notifyRole(
    'SUPER_ADMIN',
    'LOW_STOCK',
    `Low stock: ${product.name}`,
    `${product.sku} has ${balance.onHand.toFixed(3)} ${product.unitOfMeasure} on hand (reorder level ${product.reorderLevel.toFixed(3)}).`,
    '/inventory',
  );
}

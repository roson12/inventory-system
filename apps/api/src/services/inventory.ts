import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { conflict, notFound } from '../lib/errors';
import { recordAudit } from '../lib/audit';

export type Tx = Prisma.TransactionClient;

export async function ensureSettings(db: Tx | typeof prisma = prisma) {
  const existing = await db.systemSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return db.systemSetting.create({ data: { id: 1 } });
}

export interface BalanceRow {
  id: string;
  productId: string;
  warehouseId: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

/** Creates the balance row if missing, then locks it for the rest of the transaction. */
export async function lockBalance(
  tx: Tx,
  productId: string,
  warehouseId: string,
): Promise<BalanceRow> {
  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "productId", "warehouseId", "onHand", "reserved", "avgCost", "updatedAt")
    VALUES (gen_random_uuid(), ${productId}::uuid, ${warehouseId}::uuid, 0, 0, 0, now())
    ON CONFLICT ("productId", "warehouseId") DO NOTHING`;
  const rows = await tx.$queryRaw<BalanceRow[]>`
    SELECT "id", "productId", "warehouseId", "onHand", "reserved", "avgCost"
    FROM "InventoryBalance"
    WHERE "productId" = ${productId}::uuid AND "warehouseId" = ${warehouseId}::uuid
    FOR UPDATE`;
  if (!rows[0]) throw new Error('Failed to lock inventory balance');
  return rows[0];
}

export interface MovementInput {
  productId: string;
  warehouseId: string;
  type: Prisma.StockMovementCreateInput['type'];
  /** Signed quantity: positive increases On-hand, negative decreases it. */
  quantity: Prisma.Decimal | number | string;
  /** Unit cost for inbound movements. Outbound movements use the current average. */
  unitCost?: Prisma.Decimal | number | string;
  referenceType?: string;
  referenceId?: string;
  reason?: string;
  actorId?: string | null;
}

export interface MovementResult {
  movementId: string;
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  avgCost: Prisma.Decimal;
}

const INBOUND_TYPES = new Set([
  'OPENING',
  'RECEIPT',
  'RETURN_IN',
  'TRANSFER_IN',
]);

/**
 * Applies a single stock movement and appends to the immutable ledger.
 * Callers must already be inside a transaction when changing more than one row.
 */
export async function applyMovement(
  tx: Tx,
  input: MovementInput,
  options: { allowNegativeStock?: boolean } = {},
): Promise<MovementResult> {
  const quantity = new Prisma.Decimal(input.quantity);
  if (quantity.isZero()) throw conflict('Movement quantity must not be zero');

  const balance = await lockBalance(tx, input.productId, input.warehouseId);
  const onHand = new Prisma.Decimal(balance.onHand);
  const reserved = new Prisma.Decimal(balance.reserved);
  const avgCost = new Prisma.Decimal(balance.avgCost);
  const nextOnHand = onHand.plus(quantity);

  if (nextOnHand.isNegative() && !options.allowNegativeStock) {
    throw conflict('Insufficient on-hand stock for this movement');
  }
  if (nextOnHand.minus(reserved).isNegative()) {
    throw conflict('The requested quantity is reserved for confirmed orders');
  }

  const isInbound = quantity.isPositive();
  let nextAvgCost = avgCost;
  let movementUnitCost = avgCost;

  if (isInbound) {
    const cost = input.unitCost !== undefined ? new Prisma.Decimal(input.unitCost) : avgCost;
    movementUnitCost = cost;
    const totalExisting = onHand.isPositive() ? onHand : new Prisma.Decimal(0);
    const denominator = totalExisting.plus(quantity);
    nextAvgCost = denominator.isZero()
      ? cost
      : totalExisting.times(avgCost).plus(quantity.times(cost)).dividedBy(denominator).toDecimalPlaces(2);
  } else {
    // Outbound stock leaves at the current moving-average cost; the average is unchanged.
    movementUnitCost = avgCost;
  }

  const updated = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: { onHand: nextOnHand, avgCost: nextAvgCost },
  });

  const movement = await tx.stockMovement.create({
    data: {
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity,
      unitCost: movementUnitCost,
      balanceAfter: nextOnHand,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      actorId: input.actorId ?? null,
    },
  });

  await recordAudit(
    {
      actorId: input.actorId,
      action: `inventory.${input.type.toLowerCase()}`,
      entityType: 'StockMovement',
      entityId: movement.id,
      after: {
        productId: input.productId,
        warehouseId: input.warehouseId,
        quantity: quantity.toFixed(3),
        unitCost: movementUnitCost.toFixed(2),
        balanceAfter: nextOnHand.toFixed(3),
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    },
    tx,
  );

  return {
    movementId: movement.id,
    onHand: updated.onHand,
    reserved: updated.reserved,
    avgCost: updated.avgCost,
  };
}

export async function reserveStock(
  tx: Tx,
  orderId: string,
  warehouseId: string,
  items: { productId: string; quantity: Prisma.Decimal }[],
): Promise<void> {
  const ordered = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
  for (const item of ordered) {
    const balance = await lockBalance(tx, item.productId, warehouseId);
    const available = new Prisma.Decimal(balance.onHand).minus(balance.reserved);
    if (available.lessThan(item.quantity)) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { name: true, sku: true },
      });
      throw conflict(
        `Insufficient available stock for ${product?.sku ?? item.productId}`,
        { productId: item.productId, available: available.toFixed(3), requested: item.quantity.toFixed(3) },
      );
    }
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { reserved: new Prisma.Decimal(balance.reserved).plus(item.quantity) },
    });
    await tx.stockReservation.upsert({
      where: {
        orderId_productId_warehouseId: { orderId, productId: item.productId, warehouseId },
      },
      create: { orderId, productId: item.productId, warehouseId, quantity: item.quantity },
      update: { status: 'ACTIVE', quantity: item.quantity, releasedAt: null, consumedAt: null },
    });
  }
}

export async function releaseReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, status: 'ACTIVE' },
    orderBy: { productId: 'asc' },
  });
  for (const reservation of reservations) {
    const balance = await lockBalance(tx, reservation.productId, reservation.warehouseId);
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        reserved: (() => {
          const remaining = new Prisma.Decimal(balance.reserved).minus(reservation.quantity);
          return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
        })(),
      },
    });
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  }
}

export async function consumeReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, status: 'ACTIVE' },
    orderBy: { productId: 'asc' },
  });
  for (const reservation of reservations) {
    const balance = await lockBalance(tx, reservation.productId, reservation.warehouseId);
    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: {
        reserved: (() => {
          const remaining = new Prisma.Decimal(balance.reserved).minus(reservation.quantity);
          return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
        })(),
      },
    });
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
  }
}

export async function getAvailableByProduct(
  productIds: string[],
  warehouseIds: string[] | null,
): Promise<Map<string, Prisma.Decimal>> {
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      productId: { in: productIds },
      ...(warehouseIds === null ? {} : { warehouseId: { in: warehouseIds } }),
    },
  });
  const totals = new Map<string, Prisma.Decimal>();
  for (const balance of balances) {
    const current = totals.get(balance.productId) ?? new Prisma.Decimal(0);
    totals.set(
      balance.productId,
      current.plus(new Prisma.Decimal(balance.onHand).minus(balance.reserved)),
    );
  }
  return totals;
}

export async function findProductOrThrow(productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, archivedAt: null },
  });
  if (!product) throw notFound('Product not found');
  return product;
}

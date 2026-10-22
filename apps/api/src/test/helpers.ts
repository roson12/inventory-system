import argon2 from 'argon2';
import type { Agent } from 'supertest';
import request from 'supertest';
import type { Express } from 'express';
import { Prisma, type Role } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { applyMovement, ensureSettings } from '../services/inventory';

export const app: Express = createApp();
export const PASSWORD = 'TestPassword123!';

export async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "StockMovement", "InventoryBalance", "GoodsReceiptItem", "GoodsReceipt",
      "PurchaseOrderItem", "PurchaseOrder", "SupplierProduct", "Supplier",
      "StockReservation", "ReturnItem", "Return", "CustomerOrderItem", "CustomerOrder",
      "StockAdjustment", "StockTransferItem", "StockTransfer",
      "ProductImage", "Product", "Category",
      "UserWarehouseAssignment", "WarehouseLocation", "Warehouse",
      "AuditLog", "Notification", "PasswordResetToken", "UserPermissionOverride",
      "User", "session"
    CASCADE
  `);
}

export async function createUser(
  role: Role,
  email: string,
  options: { name?: string; password?: string; warehouseIds?: string[] } = {},
) {
  const passwordHash = await argon2.hash(options.password ?? PASSWORD, { type: argon2.argon2id });
  return prisma.user.create({
    data: {
      email,
      name: options.name ?? `${role} User`,
      role,
      passwordHash,
      ...(role === 'CUSTOMER' ? { customer: { create: {} } } : {}),
      ...(options.warehouseIds?.length
        ? { warehouseAssignments: { create: options.warehouseIds.map((warehouseId) => ({ warehouseId })) } }
        : {}),
    },
  });
}

export async function createWarehouse(code: string, name = code) {
  return prisma.warehouse.create({ data: { code, name } });
}

export async function createProduct(input: {
  sku: string;
  name?: string;
  price?: number;
  cost?: number;
  reorder?: number;
}) {
  return prisma.product.create({
    data: {
      sku: input.sku,
      name: input.name ?? input.sku,
      sellingPrice: new Prisma.Decimal((input.price ?? 100).toFixed(2)),
      costPrice: new Prisma.Decimal((input.cost ?? 50).toFixed(2)),
      reorderLevel: new Prisma.Decimal((input.reorder ?? 0).toFixed(3)),
    },
  });
}

export async function getCsrf(agent: Agent) {
  const res = await agent.get('/api/auth/csrf').expect(200);
  return res.body.data.csrfToken as string;
}

export async function login(email: string, password = PASSWORD): Promise<Agent> {
  const agent = request.agent(app);
  const csrf = await getCsrf(agent);
  const res = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', csrf)
    .send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function authedUser(
  role: Role,
  email: string,
  options: { warehouseIds?: string[] } = {},
) {
  const user = await createUser(role, email, options);
  const agent = await login(email);
  return { user, agent };
}

export async function csrfFor(agent: Agent) {
  return getCsrf(agent);
}

export async function addStock(
  productId: string,
  warehouseId: string,
  quantity: number,
  unitCost: number,
  type: 'OPENING' | 'RECEIPT' = 'OPENING',
) {
  await ensureSettings();
  await prisma.$transaction(async (tx) => {
    await applyMovement(tx, {
      productId,
      warehouseId,
      type,
      quantity: new Prisma.Decimal(quantity.toFixed(3)),
      unitCost: new Prisma.Decimal(unitCost.toFixed(2)),
      reason: 'test stock',
    });
  });
}

export async function balanceOf(productId: string, warehouseId: string) {
  return prisma.inventoryBalance.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });
}

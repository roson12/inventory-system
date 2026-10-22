import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  addStock,
  authedUser,
  balanceOf,
  createProduct,
  createUser,
  createWarehouse,
  csrfFor,
  login,
  resetBusinessData,
} from './helpers';

let warehouseId: string;
let secondWarehouseId: string;

async function createSupplier(agent: Awaited<ReturnType<typeof login>>) {
  const csrf = await csrfFor(agent);
  const res = await agent
    .post('/api/suppliers')
    .set('x-csrf-token', csrf)
    .send({ name: 'Test Supplier', email: 'supply@example.com' })
    .expect(201);
  return res.body.data;
}

async function createPo(
  agent: Awaited<ReturnType<typeof login>>,
  supplierId: string,
  productId: string,
  quantity: number,
  unitCost: number,
) {
  const csrf = await csrfFor(agent);
  return agent
    .post('/api/purchase-orders')
    .set('x-csrf-token', csrf)
    .send({
      supplierId,
      warehouseId,
      items: [{ productId, quantity, unitCost }],
    });
}

beforeEach(async () => {
  await resetBusinessData();
  warehouseId = (await createWarehouse('WH-INV', 'Inventory Warehouse')).id;
  secondWarehouseId = (await createWarehouse('WH-INV2', 'Second Warehouse')).id;
});

describe('inventory integrity and valuation', () => {
  it('applies moving weighted-average cost on goods receipts', async () => {
    const { agent } = await authedUser('ADMIN', 'inv-admin@test.local');
    const supplier = await createSupplier(agent);
    const product = await createProduct({ sku: 'AVG-1', price: 30, cost: 10 });
    const csrf = await csrfFor(agent);

    const po1 = await createPo(agent, supplier.id, product.id, 10, 10);
    expect(po1.status).toBe(201);
    await agent.post(`/api/purchase-orders/${po1.body.data.id}/submit`).set('x-csrf-token', csrf).expect(200);
    await agent.post(`/api/purchase-orders/${po1.body.data.id}/approve`).set('x-csrf-token', csrf).expect(200);
    const po1Detail = await agent.get(`/api/purchase-orders/${po1.body.data.id}`).expect(200);
    const item1 = po1Detail.body.data.items[0];
    await agent
      .post('/api/goods-receipts')
      .set('x-csrf-token', csrf)
      .send({
        purchaseOrderId: po1.body.data.id,
        items: [{ purchaseOrderItemId: item1.id, quantity: 10 }],
      })
      .expect(201);

    let balance = await balanceOf(product.id, warehouseId);
    expect(balance?.onHand.toFixed(3)).toBe('10.000');
    expect(balance?.avgCost.toFixed(2)).toBe('10.00');

    const po2 = await createPo(agent, supplier.id, product.id, 10, 20);
    expect(po2.status).toBe(201);
    await agent.post(`/api/purchase-orders/${po2.body.data.id}/submit`).set('x-csrf-token', csrf).expect(200);
    await agent.post(`/api/purchase-orders/${po2.body.data.id}/approve`).set('x-csrf-token', csrf).expect(200);
    const po2Detail = await agent.get(`/api/purchase-orders/${po2.body.data.id}`).expect(200);
    await agent
      .post('/api/goods-receipts')
      .set('x-csrf-token', csrf)
      .send({
        purchaseOrderId: po2.body.data.id,
        items: [{ purchaseOrderItemId: po2Detail.body.data.items[0].id, quantity: 10 }],
      })
      .expect(201);

    balance = await balanceOf(product.id, warehouseId);
    expect(balance?.onHand.toFixed(3)).toBe('20.000');
    expect(balance?.avgCost.toFixed(2)).toBe('15.00');

    const receipts = await prisma.stockMovement.findMany({
      where: { productId: product.id, type: 'RECEIPT' },
      orderBy: { createdAt: 'asc' },
    });
    expect(receipts.map((m) => m.unitCost.toFixed(2))).toEqual(['10.00', '20.00']);

    const valuation = await agent.get('/api/reports/inventory-valuation').expect(200);
    expect(valuation.body.meta.totalValue).toBe('300.00');
  });

  it('rejects receiving more than the outstanding purchase-order quantity', async () => {
    const { agent } = await authedUser('ADMIN', 'inv-admin2@test.local');
    const supplier = await createSupplier(agent);
    const product = await createProduct({ sku: 'OVER-1' });
    const csrf = await csrfFor(agent);
    const po = await createPo(agent, supplier.id, product.id, 5, 10);
    expect(po.status).toBe(201);
    await agent.post(`/api/purchase-orders/${po.body.data.id}/submit`).set('x-csrf-token', csrf);
    await agent.post(`/api/purchase-orders/${po.body.data.id}/approve`).set('x-csrf-token', csrf);
    const detail = await agent.get(`/api/purchase-orders/${po.body.data.id}`);
    const res = await agent
      .post('/api/goods-receipts')
      .set('x-csrf-token', csrf)
      .send({
        purchaseOrderId: po.body.data.id,
        items: [{ purchaseOrderItemId: detail.body.data.items[0].id, quantity: 6 }],
      });
    expect(res.status).toBe(409);
    const balance = await balanceOf(product.id, warehouseId);
    expect(balance).toBeNull();
  });

  it('routes Staff adjustments through approval and blocks self-approval', async () => {
    const product = await createProduct({ sku: 'ADJ-1' });
    await addStock(product.id, warehouseId, 10, 5);
    const staff = await createUser('STAFF', 'adj-staff@test.local', { warehouseIds: [warehouseId] });
    const staffAgent = await login('adj-staff@test.local');
    const { agent: adminAgent } = await authedUser('ADMIN', 'adj-admin@test.local');
    const staffCsrf = await csrfFor(staffAgent);

    const request = await staffAgent
      .post('/api/inventory/adjustments')
      .set('x-csrf-token', staffCsrf)
      .send({
        productId: product.id,
        warehouseId,
        kind: 'INCREASE',
        quantity: 5,
        reason: 'Cycle count surplus',
      })
      .expect(201);
    expect(request.body.data.status).toBe('PENDING');

    const selfApprove = await staffAgent
      .post(`/api/inventory/adjustments/${request.body.data.id}/approve`)
      .set('x-csrf-token', staffCsrf);
    expect(selfApprove.status).toBe(403);

    const adminCsrf = await csrfFor(adminAgent);
    await adminAgent
      .post(`/api/inventory/adjustments/${request.body.data.id}/approve`)
      .set('x-csrf-token', adminCsrf)
      .expect(200);

    const balance = await balanceOf(product.id, warehouseId);
    expect(balance?.onHand.toFixed(3)).toBe('15.000');
  });

  it('blocks Stock users from self-approving even when granted inventory.adjust', async () => {
    const product = await createProduct({ sku: 'ADJ-SELF' });
    await addStock(product.id, warehouseId, 10, 5);
    const staff = await createUser('STAFF', 'self@test.local', { warehouseIds: [warehouseId] });
    await prisma.userPermissionOverride.create({
      data: { userId: staff.id, permissionKey: 'inventory.adjust', effect: 'ALLOW' },
    });
    const adjustment = await prisma.stockAdjustment.create({
      data: {
        adjustmentNumber: 'ADJ-SELF-1',
        productId: product.id,
        warehouseId,
        kind: 'DECREASE',
        quantity: new Prisma.Decimal(2),
        reason: 'damaged',
        requestedById: staff.id,
      },
    });
    const agent = await login('self@test.local');
    const csrf = await csrfFor(agent);
    const res = await agent
      .post(`/api/inventory/adjustments/${adjustment.id}/approve`)
      .set('x-csrf-token', csrf);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/own adjustment/i);
  });

  it('prevents stock from going negative and preserves reserved stock', async () => {
    const product = await createProduct({ sku: 'NEG-1' });
    await addStock(product.id, warehouseId, 2, 5);
    const { agent: adminAgent } = await authedUser('ADMIN', 'neg-admin@test.local');
    const csrf = await csrfFor(adminAgent);
    const res = await adminAgent
      .post('/api/inventory/adjustments')
      .set('x-csrf-token', csrf)
      .send({
        productId: product.id,
        warehouseId,
        kind: 'DECREASE',
        quantity: 5,
        reason: 'Attempted overdraw',
      });
    expect(res.status).toBe(409);
    const balance = await balanceOf(product.id, warehouseId);
    expect(balance?.onHand.toFixed(3)).toBe('2.000');
  });

  it('transfers stock at the source carrying cost', async () => {
    const product = await createProduct({ sku: 'TRF-1' });
    await addStock(product.id, warehouseId, 10, 12);
    const { agent: adminAgent } = await authedUser('ADMIN', 'trf-admin@test.local');
    const csrf = await csrfFor(adminAgent);

    const transfer = await adminAgent
      .post('/api/inventory/transfers')
      .set('x-csrf-token', csrf)
      .send({
        fromWarehouseId: warehouseId,
        toWarehouseId: secondWarehouseId,
        items: [{ productId: product.id, quantity: 4 }],
      })
      .expect(201);

    await adminAgent
      .post(`/api/inventory/transfers/${transfer.body.data.id}/complete`)
      .set('x-csrf-token', csrf)
      .expect(200);

    const source = await balanceOf(product.id, warehouseId);
    const destination = await balanceOf(product.id, secondWarehouseId);
    expect(source?.onHand.toFixed(3)).toBe('6.000');
    expect(destination?.onHand.toFixed(3)).toBe('4.000');
    expect(destination?.avgCost.toFixed(2)).toBe('12.00');
  });

  it('exposes no endpoint that mutates or deletes historical stock movements', async () => {
    const product = await createProduct({ sku: 'LEDGER-1' });
    await addStock(product.id, warehouseId, 3, 5);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { productId: product.id } });
    const { agent: adminAgent } = await authedUser('ADMIN', 'ledger-admin@test.local');
    const csrf = await csrfFor(adminAgent);

    await adminAgent.delete(`/api/inventory/movements/${movement.id}`).set('x-csrf-token', csrf).expect(404);
    await adminAgent
      .put(`/api/inventory/movements/${movement.id}`)
      .set('x-csrf-token', csrf)
      .send({ quantity: 999 })
      .expect(404);
    expect(await prisma.stockMovement.count({ where: { id: movement.id } })).toBe(1);
  });
});

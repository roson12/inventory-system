import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import {
  addStock,
  authedUser,
  createProduct,
  createUser,
  createWarehouse,
  csrfFor,
  login,
  resetBusinessData,
} from './helpers';

let wh1: string;
let wh2: string;
let productId: string;

beforeEach(async () => {
  await resetBusinessData();
  wh1 = (await createWarehouse('WH-SCOPE-1', 'Scoped One')).id;
  wh2 = (await createWarehouse('WH-SCOPE-2', 'Scoped Two')).id;
  const product = await createProduct({ sku: 'SCOPE-1', price: 10, cost: 4 });
  productId = product.id;
  await addStock(productId, wh1, 10, 4);
  await addStock(productId, wh2, 10, 4);
});

describe('warehouse scope', () => {
  it('limits Staff inventory reads to assigned warehouses', async () => {
    await createUser('STAFF', 'scoped@test.local', { warehouseIds: [wh1] });
    const agent = await login('scoped@test.local');

    const balances = await agent.get('/api/inventory/balances').expect(200);
    expect(balances.body.data.length).toBe(1);
    expect(balances.body.data[0].warehouse.id).toBe(wh1);

    const warehouses = await agent.get('/api/warehouses').expect(200);
    expect(warehouses.body.data.map((w: { id: string }) => w.id)).toEqual([wh1]);
  });

  it('denies Staff access to a warehouse they are not assigned to', async () => {
    await createUser('STAFF', 'unassigned@test.local', { warehouseIds: [wh1] });
    const agent = await login('unassigned@test.local');
    const csrf = await csrfFor(agent);

    const res = await agent
      .post('/api/inventory/adjustments')
      .set('x-csrf-token', csrf)
      .send({
        productId,
        warehouseId: wh2,
        kind: 'INCREASE',
        quantity: 1,
        reason: 'out of scope',
      });
    expect(res.status).toBe(403);

    const transfer = await agent
      .post('/api/inventory/transfers')
      .set('x-csrf-token', csrf)
      .send({
        fromWarehouseId: wh2,
        toWarehouseId: wh1,
        items: [{ productId, quantity: 1 }],
      });
    expect(transfer.status).toBe(403);
  });

  it('does not let a Staff user see orders fulfilled by an unassigned warehouse', async () => {
    await createUser('CUSTOMER', 'scope-buyer@test.local');
    const customer = await login('scope-buyer@test.local');
    const customerCsrf = await csrfFor(customer);
    const order = await customer
      .post('/api/orders')
      .set('x-csrf-token', customerCsrf)
      .send({
        shippingName: 'Scope Buyer',
        shippingAddress: '1 Scope Street',
        items: [{ productId, quantity: 1 }],
      })
      .expect(201);

    // Force fulfillment into WH2.
    await prisma.customerOrder.update({
      where: { id: order.body.data.id },
      data: { warehouseId: wh2, status: 'CONFIRMED' },
    });
    await prisma.inventoryBalance.update({
      where: { productId_warehouseId: { productId, warehouseId: wh2 } },
      data: { reserved: 1 },
    });

    await createUser('STAFF', 'scope-staff@test.local', { warehouseIds: [wh1] });
    const staff = await login('scope-staff@test.local');
    const res = await staff.get(`/api/orders/${order.body.data.id}`);
    expect(res.status).toBe(403);
  });

  it('lets Super Admin see every warehouse', async () => {
    const { agent } = await authedUser('SUPER_ADMIN', 'scope-super@test.local');
    const balances = await agent.get('/api/inventory/balances').expect(200);
    expect(balances.body.data.length).toBe(2);
  });
});

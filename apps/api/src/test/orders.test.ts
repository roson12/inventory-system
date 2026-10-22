import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import {
  PASSWORD,
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
let productId: string;

async function placeOrder(
  agent: Awaited<ReturnType<typeof login>>,
  quantity: number,
  address = '1 Test Street',
) {
  const csrf = await csrfFor(agent);
  return agent
    .post('/api/orders')
    .set('x-csrf-token', csrf)
    .send({
      shippingName: 'Casey Customer',
      shippingAddress: address,
      items: [{ productId, quantity }],
    });
}

beforeEach(async () => {
  await resetBusinessData();
  const warehouse = await createWarehouse('WH-ORD', 'Order Warehouse');
  warehouseId = warehouse.id;
  const product = await createProduct({ sku: 'ORD-ITEM', price: 25, cost: 10 });
  productId = product.id;
  await addStock(productId, warehouseId, 100, 10);
});

describe('customer order lifecycle', () => {
  it('creates PENDING orders without reserving stock, reserves on confirmation, and releases on cancel', async () => {
    await createUser('CUSTOMER', 'buyer@test.local');
    const customerAgent = await login('buyer@test.local');
    const { agent: adminAgent } = await authedUser('ADMIN', 'ops@test.local');

    const created = await placeOrder(customerAgent, 4);
    expect(created.status).toBe(201);
    const orderId = created.body.data.id;
    expect(created.body.data.status).toBe('PENDING');

    let balance = await balanceOf(productId, warehouseId);
    expect(balance?.reserved.toFixed(3)).toBe('0.000');
    expect(await prisma.stockReservation.count({ where: { orderId } })).toBe(0);

    const adminCsrf = await csrfFor(adminAgent);
    const confirmed = await adminAgent
      .post(`/api/orders/${orderId}/confirm`)
      .set('x-csrf-token', adminCsrf)
      .expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    balance = await balanceOf(productId, warehouseId);
    expect(balance?.reserved.toFixed(3)).toBe('4.000');
    expect(await prisma.stockReservation.count({ where: { orderId, status: 'ACTIVE' } })).toBe(1);

    const duplicate = await adminAgent
      .post(`/api/orders/${orderId}/confirm`)
      .set('x-csrf-token', adminCsrf);
    expect(duplicate.status).toBe(409);
    balance = await balanceOf(productId, warehouseId);
    expect(balance?.reserved.toFixed(3)).toBe('4.000');

    await adminAgent
      .post(`/api/orders/${orderId}/cancel`)
      .set('x-csrf-token', adminCsrf)
      .send({ reason: 'Customer changed their mind' })
      .expect(200);

    balance = await balanceOf(productId, warehouseId);
    expect(balance?.reserved.toFixed(3)).toBe('0.000');
    expect(await prisma.stockReservation.count({ where: { orderId, status: 'RELEASED' } })).toBe(1);
  });

  it('enforces the order state machine and consumes reservations on dispatch', async () => {
    await createUser('CUSTOMER', 'buyer2@test.local');
    const customerAgent = await login('buyer2@test.local');
    const { agent: adminAgent } = await authedUser('ADMIN', 'ops2@test.local');
    const orderRes = await placeOrder(customerAgent, 5);
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;
    const csrf = await csrfFor(adminAgent);

    const earlyShip = await adminAgent
      .post(`/api/orders/${order.id}/transition`)
      .set('x-csrf-token', csrf)
      .send({ status: 'SHIPPED' });
    expect(earlyShip.status).toBe(409);

    await adminAgent.post(`/api/orders/${order.id}/confirm`).set('x-csrf-token', csrf).expect(200);
    await adminAgent
      .post(`/api/orders/${order.id}/transition`)
      .set('x-csrf-token', csrf)
      .send({ status: 'PROCESSING' })
      .expect(200);
    await adminAgent
      .post(`/api/orders/${order.id}/transition`)
      .set('x-csrf-token', csrf)
      .send({ status: 'READY_FOR_DISPATCH' })
      .expect(200);
    await adminAgent
      .post(`/api/orders/${order.id}/transition`)
      .set('x-csrf-token', csrf)
      .send({ status: 'SHIPPED' })
      .expect(200);

    const balance = await balanceOf(productId, warehouseId);
    expect(balance?.onHand.toFixed(3)).toBe('95.000');
    expect(balance?.reserved.toFixed(3)).toBe('0.000');
    expect(await prisma.stockMovement.count({ where: { referenceId: order.id, type: 'ISSUE' } })).toBe(1);

    await adminAgent
      .post(`/api/orders/${order.id}/transition`)
      .set('x-csrf-token', csrf)
      .send({ status: 'DELIVERED' })
      .expect(200);
  });

  it('prevents customers from confirming orders or viewing another customer order', async () => {
    await createUser('CUSTOMER', 'owner@test.local');
    await createUser('CUSTOMER', 'other@test.local');
    const owner = await login('owner@test.local');
    const other = await login('other@test.local');
    const orderRes = await placeOrder(owner, 1);
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;

    const csrf = await csrfFor(owner);
    const confirm = await owner
      .post(`/api/orders/${order.id}/confirm`)
      .set('x-csrf-token', csrf);
    expect(confirm.status).toBe(403);

    await other.get(`/api/orders/${order.id}`).expect(403);
    await owner.get(`/api/orders/${order.id}`).expect(200);
  });

  it('prevents concurrent confirmations from overselling stock', async () => {
    await createUser('CUSTOMER', 'race1@test.local');
    const c1 = await login('race1@test.local');
    const { agent: adminAgent } = await authedUser('ADMIN', 'race-admin@test.local');

    await createProduct({ sku: 'SMALL', price: 10, cost: 5 });
    const small = await prisma.product.findUniqueOrThrow({ where: { sku: 'SMALL' } });
    await addStock(small.id, warehouseId, 5, 5);

    async function orderFor(sku: string, quantity: number) {
      const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
      const csrf = await csrfFor(c1);
      const res = await c1
        .post('/api/orders')
        .set('x-csrf-token', csrf)
        .send({
          shippingName: 'Race',
          shippingAddress: '2 Race Street',
          items: [{ productId: product.id, quantity }],
        });
      return res.body.data;
    }

    const a = await orderFor('SMALL', 3);
    const b = await orderFor('SMALL', 3);
    const csrf = await csrfFor(adminAgent);

    const [ra, rb] = await Promise.all([
      adminAgent.post(`/api/orders/${a.id}/confirm`).set('x-csrf-token', csrf),
      adminAgent.post(`/api/orders/${b.id}/confirm`).set('x-csrf-token', csrf),
    ]);

    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 409]);
    const balance = await balanceOf(small.id, warehouseId);
    expect(balance?.reserved.toFixed(3)).toBe('3.000');
    expect(balance!.onHand.minus(balance!.reserved).greaterThanOrEqualTo(0)).toBe(true);
  });

  it('marks orders paid only through the authorized endpoint', async () => {
    await createUser('CUSTOMER', 'payer@test.local');
    const customer = await login('payer@test.local');
    const orderRes = await placeOrder(customer, 1);
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data;

    const csrf = await csrfFor(customer);
    const denied = await customer
      .post(`/api/orders/${order.id}/payment`)
      .set('x-csrf-token', csrf)
      .send({ paymentMethod: 'cash' });
    expect(denied.status).toBe(403);

    const { agent: adminAgent } = await authedUser('ADMIN', 'cashier@test.local');
    const adminCsrf = await csrfFor(adminAgent);
    const paid = await adminAgent
      .post(`/api/orders/${order.id}/payment`)
      .set('x-csrf-token', adminCsrf)
      .send({ paymentMethod: 'cash', paymentReference: 'RC-1' })
      .expect(200);
    expect(paid.body.data.paymentStatus).toBe('PAID');
  });
});

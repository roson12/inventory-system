import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import {
  PASSWORD,
  app,
  createUser,
  getCsrf,
  login,
  resetBusinessData,
} from './helpers';

beforeEach(async () => {
  await resetBusinessData();
});

describe('authentication', () => {
  it('requires a CSRF token for state-changing requests', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/register')
      .send({ name: 'No Token', email: 'notoken@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('public registration always creates a Customer, never an admin role', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrf)
      .send({
        name: 'New Customer',
        email: 'new@example.com',
        password: PASSWORD,
        role: 'SUPER_ADMIN',
      })
      .expect(201);
    expect(res.body.data.role).toBe('CUSTOMER');
    expect(res.body.data.customer).toBeTruthy();
    const user = await prisma.user.findUnique({ where: { email: 'new@example.com' } });
    expect(user?.role).toBe('CUSTOMER');
  });

  it('rejects duplicate registration emails', async () => {
    await createUser('CUSTOMER', 'dupe@example.com');
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/api/auth/register')
      .set('x-csrf-token', csrf)
      .send({ name: 'Dupe', email: 'dupe@example.com', password: PASSWORD });
    expect(res.status).toBe(409);
  });

  it('logs in with a session cookie and logs out', async () => {
    await createUser('CUSTOMER', 'login@example.com');
    const agent = await login('login@example.com');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.email).toBe('login@example.com');

    const csrf = await getCsrf(agent);
    await agent.post('/api/auth/logout').set('x-csrf-token', csrf).expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  it('rejects invalid credentials and does not leak account existence', async () => {
    await createUser('CUSTOMER', 'real@example.com');
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const wrong = await agent
      .post('/api/auth/login')
      .set('x-csrf-token', csrf)
      .send({ email: 'real@example.com', password: 'WrongPassword123' });
    expect(wrong.status).toBe(401);

    const agent2 = request.agent(app);
    const csrf2 = await getCsrf(agent2);
    const missing = await agent2
      .post('/api/auth/login')
      .set('x-csrf-token', csrf2)
      .send({ email: 'missing@example.com', password: 'WrongPassword123' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toBe(wrong.body.error.message);
  });

  it('expires password reset tokens after one use and revokes other sessions', async () => {
    const user = await createUser('CUSTOMER', 'reset@example.com');
    const existingAgent = await login('reset@example.com');

    const token = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    await agent
      .post('/api/auth/password/reset')
      .set('x-csrf-token', csrf)
      .send({ token, password: 'BrandNewPass123!' })
      .expect(200);

    // Old session is revoked.
    await existingAgent.get('/api/auth/me').expect(401);

    const reuse = await agent
      .post('/api/auth/password/reset')
      .set('x-csrf-token', csrf)
      .send({ token, password: 'AnotherPass123!' });
    expect(reuse.status).toBe(400);

    const fresh = await login('reset@example.com', 'BrandNewPass123!');
    await fresh.get('/api/auth/me').expect(200);
  });

  it('blocks unauthenticated access to protected endpoints', async () => {
    await request(app).get('/api/orders').expect(401);
    await request(app).get('/api/inventory/balances').expect(401);
    await request(app).get('/api/users').expect(401);
  });
});

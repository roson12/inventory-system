import argon2 from 'argon2';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import { createInitialSuperAdmin } from '../services/bootstrap';
import { app, authedUser, csrfFor, getCsrf, resetBusinessData } from './helpers';

const ROOT_PASSWORD = 'RootPassword123!';

beforeEach(async () => {
  await resetBusinessData();
});

describe('initial Super Admin bootstrap', () => {
  it('creates the first Super Admin with an Argon2id hash, never the plaintext', async () => {
    const created = await createInitialSuperAdmin({
      email: 'Root@Example.com',
      name: 'Root Admin',
      password: ROOT_PASSWORD,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(user.email).toBe('root@example.com');
    expect(user.role).toBe('SUPER_ADMIN');
    expect(user.status).toBe('ACTIVE');
    expect(user.passwordHash).not.toBe(ROOT_PASSWORD);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user.passwordHash, ROOT_PASSWORD)).toBe(true);
  });

  it('refuses to create a second Super Admin', async () => {
    await createInitialSuperAdmin({
      email: 'root@example.com',
      name: 'Root Admin',
      password: ROOT_PASSWORD,
    });

    await expect(
      createInitialSuperAdmin({
        email: 'second-root@example.com',
        name: 'Second Root',
        password: 'SecondRoot123!',
      }),
    ).rejects.toThrow(/already exists/i);

    await expect(prisma.user.count({ where: { role: 'SUPER_ADMIN' } })).resolves.toBe(1);
  });

  it('rejects weak and well-known default passwords', async () => {
    await expect(
      createInitialSuperAdmin({ email: 'root@example.com', name: 'Root', password: 'short' }),
    ).rejects.toThrow(/at least 10 characters/i);
    await expect(
      createInitialSuperAdmin({
        email: 'root@example.com',
        name: 'Root',
        password: 'ChangeMe!SuperAdmin123',
      }),
    ).rejects.toThrow(/known default/i);
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('rejects an invalid email address', async () => {
    await expect(
      createInitialSuperAdmin({
        email: 'not-an-email',
        name: 'Root',
        password: ROOT_PASSWORD,
      }),
    ).rejects.toThrow(/valid email/i);
  });
});

describe('unauthorised privilege escalation', () => {
  it('rejects unauthenticated attempts to create a Super Admin', async () => {
    const agent = request.agent(app);
    const csrf = await getCsrf(agent);
    const res = await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({
        name: 'Anonymous',
        email: 'anon@example.com',
        password: ROOT_PASSWORD,
        role: 'SUPER_ADMIN',
      });
    expect(res.status).toBe(401);
  });

  it('rejects Staff and Admin attempts to create a Super Admin', async () => {
    for (const role of ['STAFF', 'ADMIN'] as const) {
      const { agent } = await authedUser(role, `${role.toLowerCase()}-escalate@example.com`);
      const csrf = await csrfFor(agent);
      const res = await agent
        .post('/api/users')
        .set('x-csrf-token', csrf)
        .send({
          name: 'Sneaky',
          email: `${role.toLowerCase()}-sneaky@example.com`,
          password: ROOT_PASSWORD,
          role: 'SUPER_ADMIN',
        });
      expect(res.status).toBe(403);
    }
  });
});

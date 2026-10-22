import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma';
import {
  authedUser,
  createUser,
  csrfFor,
  login,
  resetBusinessData,
} from './helpers';

beforeEach(async () => {
  await resetBusinessData();
});

describe('role and permission boundaries', () => {
  it('prevents an Admin from creating a Super Admin', async () => {
    const { agent } = await authedUser('ADMIN', 'admin@test.local');
    const csrf = await csrfFor(agent);
    const res = await agent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({
        name: 'Sneaky',
        email: 'sneaky@test.local',
        password: 'SneakyPass123!',
        role: 'SUPER_ADMIN',
      });
    expect(res.status).toBe(403);
  });

  it('prevents Staff and Admin from changing their own role', async () => {
    const { agent: staffAgent, user: staff } = await authedUser('STAFF', 'staff@test.local');
    const staffCsrf = await csrfFor(staffAgent);
    const staffRes = await staffAgent
      .patch(`/api/users/${staff.id}`)
      .set('x-csrf-token', staffCsrf)
      .send({ role: 'ADMIN' });
    expect(staffRes.status).toBe(403);

    const { agent: adminAgent, user: admin } = await authedUser('ADMIN', 'admin2@test.local');
    const adminCsrf = await csrfFor(adminAgent);
    const adminRes = await adminAgent
      .patch(`/api/users/${admin.id}`)
      .set('x-csrf-token', adminCsrf)
      .send({ role: 'SUPER_ADMIN' });
    expect(adminRes.status).toBe(403);
  });

  it('only lets a Super Admin edit role permissions and forbids shrinking Super Admin', async () => {
    const { agent: superAgent } = await authedUser('SUPER_ADMIN', 'super@test.local');
    const { agent: adminAgent } = await authedUser('ADMIN', 'admin3@test.local');

    const adminCsrf = await csrfFor(adminAgent);
    const denied = await adminAgent
      .put('/api/roles/ADMIN/permissions')
      .set('x-csrf-token', adminCsrf)
      .send({ permissions: ['products.read'] });
    expect(denied.status).toBe(403);

    const superCsrf = await csrfFor(superAgent);
    const originalAdminPermissions = (
      await prisma.rolePermission.findMany({ where: { role: 'ADMIN' } })
    ).map((p) => p.permissionKey);

    const shrink = await superAgent
      .put('/api/roles/SUPER_ADMIN/permissions')
      .set('x-csrf-token', superCsrf)
      .send({ permissions: ['products.read'] });
    expect(shrink.status).toBe(400);

    const grant = await superAgent
      .put('/api/roles/ADMIN/permissions')
      .set('x-csrf-token', superCsrf)
      .send({ permissions: ['products.read', 'users.read', 'users.manage_staff'] })
      .expect(200);
    expect(grant.body.data.permissions).toContain('users.manage_staff');

    // Restore the seeded defaults so other test files see the standard policy.
    await superAgent
      .put('/api/roles/ADMIN/permissions')
      .set('x-csrf-token', superCsrf)
      .send({ permissions: originalAdminPermissions })
      .expect(200);
    const restored = await prisma.rolePermission.findMany({ where: { role: 'ADMIN' } });
    expect(restored.length).toBe(originalAdminPermissions.length);
  });

  it('honours per-user permission grants and denials (deny wins)', async () => {
    const { agent: superAgent } = await authedUser('SUPER_ADMIN', 'super2@test.local');
    const admin = await createUser('ADMIN', 'override@test.local');
    const superCsrf = await csrfFor(superAgent);

    await superAgent
      .put(`/api/users/${admin.id}/permissions`)
      .set('x-csrf-token', superCsrf)
      .send({
        overrides: [
          { permissionKey: 'users.manage_staff', effect: 'ALLOW' },
          { permissionKey: 'products.write', effect: 'DENY' },
        ],
      })
      .expect(200);

    const adminAgent = await login('override@test.local');
    const csrf = await csrfFor(adminAgent);

    const canManageStaff = await adminAgent
      .post('/api/users')
      .set('x-csrf-token', csrf)
      .send({
        name: 'New Staff',
        email: 'newstaff@test.local',
        password: 'NewStaff123!Pass',
        role: 'STAFF',
      });
    expect(canManageStaff.status).toBe(201);

    const deniedWrite = await adminAgent
      .post('/api/products')
      .set('x-csrf-token', csrf)
      .send({ sku: 'DENY-1', name: 'Denied', sellingPrice: 1 });
    expect(deniedWrite.status).toBe(403);
  });

  it('prevents deactivating the last active Super Admin', async () => {
    const { agent, user } = await authedUser('SUPER_ADMIN', 'last-super@test.local');
    const csrf = await csrfFor(agent);
    const res = await agent
      .patch(`/api/users/${user.id}`)
      .set('x-csrf-token', csrf)
      .send({ status: 'INACTIVE' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/last active Super Admin/i);
  });

  it('blocks Customers from internal inventory and user management', async () => {
    const { agent } = await authedUser('CUSTOMER', 'cust@test.local');
    await agent.get('/api/inventory/balances').expect(403);
    await agent.get('/api/users').expect(403);
    await agent.get('/api/audit-logs').expect(403);
    await agent.get('/api/suppliers').expect(403);
    await agent.get('/api/settings').expect(403);
  });
});

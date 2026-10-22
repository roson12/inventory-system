import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth';
import { PERMISSIONS, PERMISSION_CATALOG } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get(
  '/',
  requirePermission(PERMISSIONS.USERS_READ),
  asyncHandler(async (_req, res) => {
    const rolePermissions = await prisma.rolePermission.findMany({ orderBy: { permissionKey: 'asc' } });
    const data = Object.values(Role).map((role) => ({
      role,
      permissions:
        role === 'SUPER_ADMIN'
          ? PERMISSION_CATALOG.map((p) => p.key)
          : rolePermissions.filter((p) => p.role === role).map((p) => p.permissionKey),
    }));
    res.json({ data });
  }),
);

rolesRouter.get(
  '/permissions',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ data: PERMISSION_CATALOG });
  }),
);

const updateSchema = z.object({
  permissions: z.array(z.string()),
});

rolesRouter.put(
  '/:role/permissions',
  requireRole('SUPER_ADMIN'),
  validate({ body: updateSchema }),
  asyncHandler(async (req, res) => {
    const role = req.params.role as Role;
    if (!Object.values(Role).includes(role)) throw badRequest('Unknown role');
    if (role === 'SUPER_ADMIN') {
      throw badRequest('Super Admin permissions cannot be reduced or modified');
    }
    const valid = new Set(PERMISSION_CATALOG.map((p) => p.key));
    const requested = [...new Set((req.body as z.infer<typeof updateSchema>).permissions)];
    const unknown = requested.filter((p) => !valid.has(p as never));
    if (unknown.length) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);

    const before = await prisma.rolePermission.findMany({ where: { role } });
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { role } });
      if (requested.length) {
        await tx.rolePermission.createMany({
          data: requested.map((permissionKey) => ({ role, permissionKey })),
        });
      }
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'roles.permissions_updated',
          entityType: 'Role',
          entityId: role,
          before: { permissions: before.map((p) => p.permissionKey) },
          after: { permissions: requested },
          req,
        },
        tx,
      );
    });
    res.json({ data: { role, permissions: requested } });
  }),
);

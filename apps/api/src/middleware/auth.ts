import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { ALL_PERMISSIONS, type PermissionKey } from '../lib/permissions';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  customerId?: string | null;
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function resolvePermissions(userId: string, role: Role): Promise<Set<string>> {
  if (role === 'SUPER_ADMIN') return new Set<string>(ALL_PERMISSIONS);

  const [rolePermissions, overrides] = await Promise.all([
    prisma.rolePermission.findMany({ where: { role }, select: { permissionKey: true } }),
    prisma.userPermissionOverride.findMany({
      where: { userId },
      select: { permissionKey: true, effect: true },
    }),
  ]);

  const granted = new Set(rolePermissions.map((p) => p.permissionKey));
  for (const override of overrides) {
    if (override.effect === 'DENY') granted.delete(override.permissionKey);
    else granted.add(override.permissionKey);
  }
  return granted;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const userId = req.session.userId;
    if (!userId) throw unauthorized();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { customer: { select: { id: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      req.session.destroy(() => undefined);
      throw unauthorized('Your session is no longer valid');
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      customerId: user.customer?.id ?? null,
      permissions: await resolvePermissions(user.id, user.role),
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function hasPermission(user: AuthUser, permission: PermissionKey | string): boolean {
  return user.role === 'SUPER_ADMIN' || user.permissions.has(permission);
}

export function requirePermission(permission: PermissionKey | string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!hasPermission(req.user, permission)) {
      return next(forbidden(`Missing permission: ${permission}`));
    }
    return next();
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('This action is not available for your role'));
    }
    return next();
  };
}

/**
 * Returns null when the user may access all warehouses, otherwise the explicit
 * list. Staff with no assignments get [] (no access).
 */
export async function getScopedWarehouseIds(user: AuthUser): Promise<string[] | null> {
  if (user.role === 'SUPER_ADMIN') return null;
  const assignments = await prisma.userWarehouseAssignment.findMany({
    where: { userId: user.id },
    select: { warehouseId: true },
  });
  const ids = assignments.map((a) => a.warehouseId);
  if (ids.length === 0 && user.role === 'ADMIN') return null;
  return ids;
}

export function isWarehouseAllowed(scoped: string[] | null, warehouseId: string): boolean {
  return scoped === null || scoped.includes(warehouseId);
}

export async function assertWarehouseAccess(
  user: AuthUser,
  warehouseId: string,
): Promise<void> {
  const scoped = await getScopedWarehouseIds(user);
  if (!isWarehouseAllowed(scoped, warehouseId)) {
    throw forbidden('You do not have access to this warehouse');
  }
}

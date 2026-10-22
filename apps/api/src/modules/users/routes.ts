import { Router } from 'express';
import argon2 from 'argon2';
import { z } from 'zod';
import { Role, UserStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import {
  getScopedWarehouseIds,
  hasPermission,
  requireAuth,
  requirePermission,
  resolvePermissions,
} from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { passwordSchema } from '../../lib/passwords';
import { recordAudit } from '../../lib/audit';
import { getPagination, paginated } from '../../lib/pagination';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const listQuery = z.object({
  search: z.string().trim().optional(),
  role: z.nativeEnum(Role).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

usersRouter.get(
  '/',
  requirePermission(PERMISSIONS.USERS_READ),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['name', 'email', 'role', 'status', 'createdAt'],
      defaultSort: 'createdAt',
    });
    const { search, role, status } = req.query as z.infer<typeof listQuery>;
    const where = {
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
          warehouseAssignments: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    res.json(paginated(rows, total, pagination));
  }),
);

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.nativeEnum(Role),
  phone: z.string().max(30).optional(),
  warehouseIds: z.array(z.string().uuid()).optional(),
});

function permissionForTargetRole(role: Role): string {
  switch (role) {
    case 'STAFF':
    case 'CUSTOMER':
      return PERMISSIONS.USERS_MANAGE_STAFF;
    case 'ADMIN':
      return PERMISSIONS.USERS_MANAGE_ADMIN;
    case 'SUPER_ADMIN':
      return PERMISSIONS.USERS_MANAGE_SUPER_ADMIN;
  }
}

usersRouter.post(
  '/',
  validate({ body: createUserSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createUserSchema>;
    if (!hasPermission(req.user!, permissionForTargetRole(body.role))) {
      throw forbidden(`You cannot create a ${body.role} account`);
    }
    if (body.role !== 'SUPER_ADMIN' && body.role !== 'CUSTOMER' && !hasPermission(req.user!, PERMISSIONS.USERS_READ)) {
      throw forbidden('Missing user management permission');
    }
    if (await prisma.user.findUnique({ where: { email: body.email } })) {
      throw conflict('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        phone: body.phone,
        role: body.role,
        passwordHash,
        mustChangePassword: true,
        ...(body.role === 'CUSTOMER' ? { customer: { create: { phone: body.phone } } } : {}),
        ...(body.warehouseIds?.length
          ? { warehouseAssignments: { create: body.warehouseIds.map((warehouseId) => ({ warehouseId })) } }
          : {}),
      },
      select: { id: true, email: true, name: true, role: true, status: true },
    });

    await recordAudit({
      actorId: req.user!.id,
      action: 'users.created',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: user.role },
      req,
    });
    res.status(201).json({ data: user });
  }),
);

const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().max(30).nullable().optional(),
  role: z.nativeEnum(Role).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  password: passwordSchema.optional(),
  warehouseIds: z.array(z.string().uuid()).optional(),
});

usersRouter.patch(
  '/:id',
  validate({ body: updateUserSchema }),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('User not found');
    const body = req.body as z.infer<typeof updateUserSchema>;

    if (target.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      throw forbidden('Only a Super Admin can modify a Super Admin account');
    }
    if (body.role && body.role !== target.role) {
      if (!hasPermission(req.user!, PERMISSIONS.USERS_MANAGE_SUPER_ADMIN)) {
        throw forbidden('Only a Super Admin can change user roles');
      }
      if (target.id === req.user!.id) throw forbidden('You cannot change your own role');
      if (!hasPermission(req.user!, permissionForTargetRole(body.role))) {
        throw forbidden(`You cannot assign the ${body.role} role`);
      }
    }
    if (!body.role && target.role !== 'SUPER_ADMIN' && !hasPermission(req.user!, permissionForTargetRole(target.role))) {
      throw forbidden('You cannot manage this account');
    }

    if (body.status && body.status !== 'ACTIVE' && target.role === 'SUPER_ADMIN') {
      const activeSupers = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      if (activeSupers <= 1) {
        throw conflict('The last active Super Admin cannot be deactivated');
      }
    }

    if (body.role && body.role !== 'SUPER_ADMIN' && target.role === 'SUPER_ADMIN') {
      const activeSupers = await prisma.user.count({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      if (activeSupers <= 1) {
        throw conflict('The last active Super Admin cannot be demoted');
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.role !== undefined) data.role = body.role;
    if (body.status !== undefined) data.status = body.status;
    if (body.password) {
      data.passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
      data.mustChangePassword = true;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.warehouseIds) {
        await tx.userWarehouseAssignment.deleteMany({ where: { userId: target.id } });
        if (body.warehouseIds.length) {
          await tx.userWarehouseAssignment.createMany({
            data: body.warehouseIds.map((warehouseId) => ({ userId: target.id, warehouseId })),
          });
        }
      }
      const result = await tx.user.update({
        where: { id: target.id },
        data,
        select: { id: true, email: true, name: true, phone: true, role: true, status: true },
      });
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'users.updated',
          entityType: 'User',
          entityId: target.id,
          before: { name: target.name, role: target.role, status: target.status },
          after: { name: result.name, role: result.role, status: result.status },
          req,
        },
        tx,
      );
      return result;
    });

    // Privilege or credential changes invalidate existing sessions.
    if (body.role || body.status || body.password) {
      if (target.id !== req.user!.id) {
        await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${target.id}`;
      }
    }

    res.json({ data: updated });
  }),
);

usersRouter.get(
  '/:id',
  requirePermission(PERMISSIONS.USERS_READ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        customer: true,
        warehouseAssignments: { include: { warehouse: true } },
        permissionOverrides: true,
      },
    });
    if (!user) throw notFound('User not found');
    res.json({ data: user });
  }),
);

const overridesSchema = z.object({
  overrides: z.array(
    z.object({
      permissionKey: z.string(),
      effect: z.enum(['ALLOW', 'DENY']),
    }),
  ),
});

usersRouter.put(
  '/:id/permissions',
  requirePermission(PERMISSIONS.ROLES_MANAGE),
  validate({ body: overridesSchema }),
  asyncHandler(async (req, res) => {
    const { overrides } = req.body as z.infer<typeof overridesSchema>;
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound('User not found');
    if (target.role === 'SUPER_ADMIN') throw badRequest('Super Admin permissions cannot be overridden');

    await prisma.$transaction(async (tx) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId: target.id } });
      if (overrides.length) {
        await tx.userPermissionOverride.createMany({
          data: overrides.map((o) => ({ userId: target.id, ...o })),
        });
      }
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'users.permissions_updated',
          entityType: 'User',
          entityId: target.id,
          after: { overrides },
          req,
        },
        tx,
      );
    });

    const permissions = Array.from(await resolvePermissions(target.id, target.role)).sort();
    res.json({ data: { permissions } });
  }),
);

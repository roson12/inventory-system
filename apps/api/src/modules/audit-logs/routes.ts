import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { getPagination, paginated } from '../../lib/pagination';

export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requirePermission(PERMISSIONS.AUDIT_READ));

auditLogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const pagination = getPagination(req, {
      allowedSort: ['createdAt'],
      defaultSort: 'createdAt',
    });
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
    const where: Prisma.AuditLogWhereInput = {
      ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(entityType ? { entityType } : {}),
      ...(actorId ? { actorId } : {}),
      ...(typeof req.query.from === 'string' || typeof req.query.to === 'string'
        ? {
            createdAt: {
              ...(typeof req.query.from === 'string' ? { gte: new Date(req.query.from) } : {}),
              ...(typeof req.query.to === 'string' ? { lte: new Date(req.query.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        skip: pagination.skip,
        take: pagination.take,
        orderBy: { [pagination.sortBy]: pagination.sortDir },
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json(paginated(rows, total, pagination));
  }),
);

import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma } from './prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  req?: Request;
}

/**
 * Audit entries are append-only. They are written with the same transaction as
 * the action they describe whenever the caller passes its transaction client.
 */
export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: input.req?.ip,
      userAgent: input.req?.get('user-agent'),
    },
  });
}

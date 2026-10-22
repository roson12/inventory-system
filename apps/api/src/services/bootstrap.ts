import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { hashPassword, passwordSchema, REJECTED_PASSWORDS } from '../lib/passwords';

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

const inputSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required'),
  name: z.string().trim().min(2).max(120),
  password: passwordSchema,
});

export interface InitialSuperAdmin {
  id: string;
  email: string;
  role: 'SUPER_ADMIN';
}

/**
 * Creates the very first Super Admin. This is intentionally refused once any
 * Super Admin exists, so the command cannot be replayed to mint extra
 * privileged accounts. Further Super Admins must be created through the
 * authenticated users API by an existing Super Admin.
 */
export async function createInitialSuperAdmin(input: {
  email: string;
  name: string;
  password: string;
}): Promise<InitialSuperAdmin> {
  if (REJECTED_PASSWORDS.has(input.password) || REJECTED_PASSWORDS.has(input.password.toLowerCase())) {
    throw new BootstrapError('That password is a known default and cannot be used');
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BootstrapError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }

  const { email, name, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    // Serialise concurrent bootstrap attempts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(748281)`;

    const existing = await tx.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { email: true },
    });
    if (existing) {
      throw new BootstrapError(
        `A Super Admin already exists${existing.email ? ` (${existing.email})` : ''}. ` +
          'Sign in as that account to create another one.',
      );
    }

    const emailTaken = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (emailTaken) {
      throw new BootstrapError('An account with this email already exists');
    }

    const user = await tx.user.create({
      data: {
        email,
        name,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        passwordHash,
      },
      select: { id: true, email: true, role: true },
    });

    return { id: user.id, email: user.email, role: user.role as 'SUPER_ADMIN' };
  });
}

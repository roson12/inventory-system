import { Router } from 'express';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { asyncHandler, badRequest, conflict, unauthorized } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { requireAuth, resolvePermissions } from '../../middleware/auth';
import { csrfTokenHandler, ensureCsrfToken } from '../../middleware/csrf';
import { recordAudit } from '../../lib/audit';
import { sendPasswordResetEmail } from '../../lib/mailer';
import { passwordSchema } from '../../lib/passwords';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  phone: z.string().trim().max(30).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });

const resetSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 10_000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 10_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } },
});

function regenerateSession(req: Parameters<typeof requireAuth>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function sessionUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      customer: true,
      warehouseAssignments: {
        include: { warehouse: { select: { id: true, code: true, name: true } } },
      },
      permissionOverrides: { select: { permissionKey: true, effect: true } },
    },
  });
  if (!user) throw unauthorized();
  const permissions = Array.from(await resolvePermissions(user.id, user.role)).sort();

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    status: user.status,
    customer: user.customer,
    warehouses: user.warehouseAssignments.map((a) => a.warehouse),
    permissions,
    mustChangePassword: user.mustChangePassword,
  };
}

authRouter.get('/csrf', csrfTokenHandler);

authRouter.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body as z.infer<typeof registerSchema>;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw conflict('An account with this email already exists');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        phone,
        role: 'CUSTOMER',
        customer: { create: { phone } },
      },
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    ensureCsrfToken(req);
    await recordAudit(
      { actorId: user.id, action: 'auth.register', entityType: 'User', entityId: user.id, req },
    );

    res.status(201).json({ data: await sessionUser(user.id) });
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) throw unauthorized('Invalid email or password');
    if (user.status !== 'ACTIVE') throw unauthorized('This account is not active');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw unauthorized('This account is temporarily locked. Try again later.');
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil: failed >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
        },
      });
      throw unauthorized('Invalid email or password');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await regenerateSession(req);
    req.session.userId = user.id;
    ensureCsrfToken(req);
    await recordAudit(
      { actorId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, req },
    );

    res.json({ data: await sessionUser(user.id) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const userId = req.session.userId;
    if (userId) {
      await recordAudit({ actorId: userId, action: 'auth.logout', entityType: 'User', entityId: userId, req });
    }
    req.session.destroy(() => {
      res.clearCookie('ims.sid');
      res.status(204).end();
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await sessionUser(req.user!.id) });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  addressLine1: z.string().trim().max(300).nullable().optional(),
  addressLine2: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(30).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
});

authRouter.patch(
  '/profile',
  requireAuth,
  validate({ body: profileSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof profileSchema>;
    const { name, phone, ...customerFields } = body;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.user!.id },
        data: { ...(name !== undefined ? { name } : {}), ...(phone !== undefined ? { phone } : {}) },
      });
      if (req.user!.role === 'CUSTOMER') {
        await tx.customer.upsert({
          where: { userId: req.user!.id },
          create: { userId: req.user!.id, phone, ...customerFields },
          update: { ...(phone !== undefined ? { phone } : {}), ...customerFields },
        });
      }
      await recordAudit(
        {
          actorId: req.user!.id,
          action: 'auth.profile_updated',
          entityType: 'User',
          entityId: req.user!.id,
          after: { name, phone },
          req,
        },
        tx,
      );
    });

    res.json({ data: await sessionUser(req.user!.id) });
  }),
);

authRouter.post(
  '/password/forgot',
  authLimiter,
  validate({ body: forgotSchema }),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotSchema>;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && user.status === 'ACTIVE') {
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    }

    // Always the same response, to avoid account enumeration.
    res.json({ data: { message: 'If an account exists, a reset link has been sent.' } });
  }),
);

authRouter.post(
  '/password/reset',
  authLimiter,
  validate({ body: resetSchema }),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as z.infer<typeof resetSchema>;
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('This reset link is invalid or has expired');
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${record.userId}`,
    ]);

    await recordAudit({
      actorId: record.userId,
      action: 'auth.password.reset',
      entityType: 'User',
      entityId: record.userId,
      req,
    });

    res.json({ data: { message: 'Password updated. Please sign in.' } });
  }),
);

authRouter.post(
  '/password/change',
  requireAuth,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) throw badRequest('Current password is incorrect');

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    await recordAudit({
      actorId: user.id,
      action: 'auth.password.change',
      entityType: 'User',
      entityId: user.id,
      req,
    });
    res.json({ data: { message: 'Password changed' } });
  }),
);

authRouter.post(
  '/sessions/revoke-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${userId}`;
    await recordAudit({
      actorId: userId,
      action: 'auth.sessions.revoke_all',
      entityType: 'User',
      entityId: userId,
      req,
    });
    req.session.destroy(() => {
      res.clearCookie('ims.sid');
      res.status(204).end();
    });
  }),
);

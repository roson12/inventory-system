import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user!.id, ...(unreadOnly ? { isRead: false } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notification.count({ where: { userId: req.user!.id, isRead: false } }),
    ]);
    res.json({ data: rows, meta: { unreadCount } });
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const count = await prisma.notification.count({
      where: { userId: req.user!.id, isRead: false },
    });
    res.json({ data: { count } });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!notification) throw notFound('Notification not found');
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { isRead: true },
    });
    res.json({ data: updated });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ data: { ok: true } });
  }),
);

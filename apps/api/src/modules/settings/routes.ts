import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { requireAuth, requirePermission } from '../../middleware/auth';
import { PERMISSIONS } from '../../lib/permissions';
import { recordAudit } from '../../lib/audit';
import { ensureSettings } from '../../services/inventory';

export const settingsRouter = Router();

// Public subset needed by the storefront before/after sign-in.
settingsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const settings = await ensureSettings();
    res.json({
      data: {
        companyName: settings.companyName,
        currencyCode: settings.currencyCode,
        taxEnabled: settings.taxEnabled,
        defaultTaxRate: settings.defaultTaxRate,
        allowNegativeStock: settings.allowNegativeStock,
      },
    });
  }),
);

settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req, res) => {
    res.json({ data: await ensureSettings() });
  }),
);

const schema = z.object({
  companyName: z.string().trim().min(2).max(200).optional(),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  allowNegativeStock: z.boolean().optional(),
  purchaseApprovalLimit: z.coerce.number().min(0).optional(),
  taxEnabled: z.boolean().optional(),
  defaultTaxRate: z.coerce.number().min(0).max(100).optional(),
  lowStockNotifications: z.boolean().optional(),
});

settingsRouter.put(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: schema }),
  asyncHandler(async (req, res) => {
    const before = await ensureSettings();
    const body = req.body as z.infer<typeof schema>;
    const updated = await prisma.systemSetting.update({
      where: { id: 1 },
      data: { ...body, updatedById: req.user!.id },
    });
    await recordAudit({
      actorId: req.user!.id,
      action: 'settings.updated',
      entityType: 'SystemSetting',
      entityId: '1',
      before,
      after: updated,
      req,
    });
    res.json({ data: updated });
  }),
);

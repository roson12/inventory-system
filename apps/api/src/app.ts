import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { sessionMiddleware } from './config/session';
import { csrfProtection } from './middleware/csrf';
import { authRouter } from './modules/auth/routes';
import { usersRouter } from './modules/users/routes';
import { rolesRouter } from './modules/roles/routes';
import { productsRouter } from './modules/products/routes';
import { categoriesRouter } from './modules/categories/routes';
import { warehousesRouter } from './modules/warehouses/routes';
import { inventoryRouter } from './modules/inventory/routes';
import { suppliersRouter } from './modules/suppliers/routes';
import { purchaseOrdersRouter } from './modules/purchase-orders/routes';
import { goodsReceiptsRouter } from './modules/goods-receipts/routes';
import { ordersRouter } from './modules/orders/routes';
import { returnsRouter } from './modules/returns/routes';
import { reportsRouter } from './modules/reports/routes';
import { notificationsRouter } from './modules/notifications/routes';
import { auditLogsRouter } from './modules/audit-logs/routes';
import { settingsRouter } from './modules/settings/routes';
import { errorHandler, notFoundHandler } from './lib/errors';
import { openApiSpec } from './docs/openapi';
import { prisma } from './lib/prisma';

export function createApp() {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  if (env.CORS_ORIGIN) {
    const origins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    app.use(cors({ origin: origins, credentials: true }));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(sessionMiddleware);

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.isTest ? 100_000 : 1000,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.use('/uploads', express.static(env.UPLOAD_DIR, { maxAge: '7d', fallthrough: true }));

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'up', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api/openapi.json', (_req, res) => res.json(openApiSpec));

  app.use(csrfProtection);

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/warehouses', warehousesRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchase-orders', purchaseOrdersRouter);
  app.use('/api/goods-receipts', goodsReceiptsRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/returns', returnsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/audit-logs', auditLogsRouter);
  app.use('/api/settings', settingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

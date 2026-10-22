import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { sessionPool } from './config/session';

const app = createApp();
const server = app.listen(env.PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on http://0.0.0.0:${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`[api] ${signal} received, shutting down`);
  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), sessionPool.end()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

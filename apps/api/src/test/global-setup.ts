import { execSync } from 'node:child_process';

export default async function globalSetup() {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ??
    'postgresql://ims:change-me-in-production@localhost:5432/ims_test?schema=public';

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    SEED_DEMO_DATA: 'false',
    BOOTSTRAP_SUPER_ADMIN_EMAIL: 'test-super@example.com',
    BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'TestSuper123!Pass',
    BOOTSTRAP_SUPER_ADMIN_NAME: 'Test Super Admin',
  };

  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  execSync('npx tsx prisma/seed.ts', {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
}

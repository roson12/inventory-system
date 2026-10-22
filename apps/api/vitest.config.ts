import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://ims:change-me-in-production@localhost:5432/ims_test?schema=public';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      SESSION_SECRET: 'test-session-secret-value-1234567890',
      COOKIE_SECURE: 'false',
      TRUST_PROXY: '1',
      UPLOAD_DIR: './uploads-test',
      BOOTSTRAP_SUPER_ADMIN_EMAIL: 'test-super@example.com',
      BOOTSTRAP_SUPER_ADMIN_PASSWORD: 'TestSuper123!Pass',
      SEED_DEMO_DATA: 'false',
      APP_URL: 'http://localhost:5173',
    },
  },
});

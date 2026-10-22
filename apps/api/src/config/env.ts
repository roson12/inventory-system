import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

// Works both when running from apps/api (npm run dev) and from the container root.
for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  '/app/.env',
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const booleanString = z
  .string()
  .optional()
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default('development-only-secret-change-me'),
  COOKIE_SECURE: booleanString,
  TRUST_PROXY: z.coerce.number().default(1),
  APP_URL: z.string().default('http://localhost:8080'),
  CORS_ORIGIN: z.string().optional(),
  UPLOAD_DIR: z.string().default(path.resolve(process.cwd(), 'uploads')),
  MAX_UPLOAD_MB: z.coerce.number().default(5),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: booleanString,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('no-reply@example.com'),
  // No defaults: a privileged account must never be created from credentials
  // baked into the source tree. Set these only for the one-time bootstrap.
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_SUPER_ADMIN_PASSWORD: z
    .string()
    .min(10)
    .max(128)
    .regex(/[A-Za-z]/)
    .regex(/[0-9]/)
    .optional(),
  BOOTSTRAP_SUPER_ADMIN_NAME: z.string().default('Super Admin'),
  SEED_DEMO_DATA: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  SEED_ON_START: booleanString,
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  cookieSecure: parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === 'production',
};

if (env.isProduction && env.SESSION_SECRET === 'development-only-secret-change-me') {
  throw new Error('SESSION_SECRET must be set to a strong random value in production');
}

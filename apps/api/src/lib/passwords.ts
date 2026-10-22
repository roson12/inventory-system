import argon2 from 'argon2';
import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

// Passwords that must never be accepted for a privileged account.
export const REJECTED_PASSWORDS = new Set([
  'ChangeMe!SuperAdmin123',
  'changeme',
  'password',
  'admin123',
]);

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

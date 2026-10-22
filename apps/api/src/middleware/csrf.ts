import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    pendingPasswordReset?: string;
  }
}

export function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfTokenHandler(req: Request, res: Response) {
  res.json({ data: { csrfToken: ensureCsrfToken(req) } });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit token bound to the server-side session. State-changing requests
 * must echo the token in the x-csrf-token header.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session.csrfToken;
  const supplied = req.get('x-csrf-token');

  if (!expected || !supplied) {
    return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token'));
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token'));
  }
  return next();
}

import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

export const validate =
  (schema: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) req.body = schema.body.parse(req.body);
      if (schema.query) {
        const parsed = schema.query.parse(req.query);
        // Express 4 exposes req.query as a getter-backed object; mutate carefully.
        Object.keys(req.query).forEach((key) => delete (req.query as Record<string, unknown>)[key]);
        Object.assign(req.query, parsed);
      }
      if (schema.params) Object.assign(req.params, schema.params.parse(req.params));
      next();
    } catch (err) {
      next(err);
    }
  };

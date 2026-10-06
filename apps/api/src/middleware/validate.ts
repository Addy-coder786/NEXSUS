import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates and replaces req.body / req.query / req.params with the parsed (coerced, defaulted)
 * values. Zod errors are converted to 422 by the error handler.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query);
        // req.query is a getter in Express 4; assign fields onto the existing object
        Object.keys(req.query).forEach((k) => delete (req.query as Record<string, unknown>)[k]);
        Object.assign(req.query, parsed);
      }
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Typed accessor for a validated query. */
export function typedQuery<T extends ZodTypeAny>(req: { query: unknown }, _schema: T): z.infer<T> {
  return req.query as z.infer<T>;
}

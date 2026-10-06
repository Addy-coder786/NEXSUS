import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiErrorBody } from '@nexus/shared';
import { isProd } from '../config/env';
import { logger } from '../config/logger';
import { ApiError } from '../utils/ApiError';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, ERROR_CODES.NOT_FOUND, `Route ${req.method} ${req.path} not found`));
};

function normalize(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (err instanceof ZodError) {
    return ApiError.validation(
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid ${err.path}: ${String(err.value)}`);
  }
  // Duplicate key
  if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    const keys = Object.keys((err as { keyValue?: Record<string, unknown> }).keyValue ?? {});
    return ApiError.conflict(`${keys.join(', ') || 'Value'} already exists`);
  }
  if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    return new ApiError(413, ERROR_CODES.BAD_REQUEST, 'Request body too large');
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return ApiError.badRequest('Malformed JSON body');
  }
  return ApiError.internal();
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiErr = normalize(err);

  if (apiErr.status >= 500) {
    logger.error({ err, reqId: req.id, path: req.path }, 'Unhandled error');
  } else if (apiErr.status !== 404) {
    logger.debug({ code: apiErr.code, path: req.path }, apiErr.message);
  }

  const body: ApiErrorBody = {
    success: false,
    error: {
      code: apiErr.code,
      message: apiErr.status >= 500 && isProd ? 'Something went wrong' : apiErr.message,
      ...(apiErr.details !== undefined ? { details: apiErr.details } : {}),
    },
  };
  res.status(apiErr.status).json(body);
};

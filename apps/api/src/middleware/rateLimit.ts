import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';
import { ApiError } from '../utils/ApiError';

function make(windowMs: number, limit: number, keyByEmail = false) {
  return rateLimit({
    windowMs,
    limit: isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = keyByEmail ? (req.body as { email?: string } | undefined)?.email : undefined;
      return email ? `${req.ip}:${email.toLowerCase()}` : (req.ip ?? 'unknown');
    },
    handler: (_req, _res, next) => next(ApiError.rateLimited()),
  });
}

/** Global API limiter. */
export const apiLimiter = make(15 * 60 * 1000, 1000);
/** Login / register / password reset: per IP + email. */
export const authLimiter = make(15 * 60 * 1000, 20, true);
/** Email-sending endpoints (forgot password, resend verification). */
export const emailLimiter = make(60 * 60 * 1000, 5, true);

import type { RequestHandler } from 'express';
import { ERROR_CODES } from '@nexus/shared';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { ApiError } from '../utils/ApiError';
import { ACCESS_COOKIE } from '../utils/cookies';
import { verifyAccessToken } from '../utils/tokens';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      id?: string;
    }
  }
}

function extractToken(req: Parameters<RequestHandler>[0]): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = (req.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE];
  return cookie ?? null;
}

/** Requires a valid access token. Attaches req.user. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized();

    const payload = verifyAccessToken(token);
    const [user, sessionAlive] = await Promise.all([
      User.findById(payload.sub).select('email name emailVerified tokenVersion deletedAt').lean(),
      // Logout deletes or revokes the session, so the access token dies immediately
      // instead of living out its 15 minute TTL.
      Session.exists({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } }),
    ]);

    if (!user || user.deletedAt) throw ApiError.unauthorized('Account not found');
    if (!sessionAlive || user.tokenVersion !== payload.tv) {
      throw ApiError.unauthorized('Session revoked', ERROR_CODES.TOKEN_INVALID);
    }

    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified,
      sessionId: payload.sid,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Like authenticate, but continues anonymously if no/invalid token. */
export const optionalAuth: RequestHandler = (req, res, next) => {
  if (!extractToken(req)) return next();
  authenticate(req, res, (err) => (err ? next() : next()));
};

/** Write actions require a verified email address. */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!req.user.emailVerified) {
    return next(new ApiError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Please verify your email address first'));
  }
  next();
};

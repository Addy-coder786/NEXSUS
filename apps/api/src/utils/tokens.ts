import jwt, { type SignOptions } from 'jsonwebtoken';
import { ACCESS_TOKEN_TTL_SEC, ERROR_CODES } from '@nexus/shared';
import { env } from '../config/env';
import { ApiError } from './ApiError';

export interface AccessTokenPayload {
  /** user id */
  sub: string;
  /** session id */
  sid: string;
  /** user.tokenVersion at issue time; bumping it invalidates all access tokens */
  tv: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  /** unique id of this refresh token; its sha256 is stored on the session for rotation */
  jti: string;
}

const ISSUER = 'nexus';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    issuer: ISSUER,
    audience: 'access',
  });
}

export function signRefreshToken(payload: RefreshTokenPayload, ttlSec: number): string {
  const opts: SignOptions = { expiresIn: ttlSec, issuer: ISSUER, audience: 'refresh' };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, opts);
}

function verify<T>(token: string, secret: string, audience: 'access' | 'refresh'): T {
  try {
    return jwt.verify(token, secret, { issuer: ISSUER, audience }) as T;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Token expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    throw ApiError.unauthorized('Invalid token', ERROR_CODES.TOKEN_INVALID);
  }
}

export const verifyAccessToken = (token: string) =>
  verify<AccessTokenPayload & jwt.JwtPayload>(token, env.JWT_ACCESS_SECRET, 'access');

export const verifyRefreshToken = (token: string) =>
  verify<RefreshTokenPayload & jwt.JwtPayload>(token, env.JWT_REFRESH_SECRET, 'refresh');

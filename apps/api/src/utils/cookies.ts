import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_TTL_SEC } from '@nexus/shared';
import { env, isProd } from '../config/env';

export const ACCESS_COOKIE = 'nx_access';
export const REFRESH_COOKIE = 'nx_refresh';
/** Refresh cookie is only sent to the auth router, so a leaked access path can't replay it. */
export const REFRESH_COOKIE_PATH = '/api/auth';

const base: CookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  domain: env.COOKIE_DOMAIN,
};

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string, refreshTtlSec: number) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_TOKEN_TTL_SEC * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: refreshTtlSec * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
}

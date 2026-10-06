import type { Request, RequestHandler, Response } from 'express';
import type {
  ForgotPasswordInput,
  LoginInput,
  OAuthProvider,
  RegisterInput,
  ResetPasswordInput,
} from '@nexus/shared';
import { env, features } from '../../config/env';
import { logger } from '../../config/logger';
import type { AuthUser } from '../../middleware/authenticate';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../../utils/cookies';
import { created, noContent, ok } from '../../utils/response';
import { verifyAccessToken, verifyRefreshToken } from '../../utils/tokens';
import * as authService from './auth.service';
import type { IssuedTokens, RequestMeta } from './auth.service';
import * as oauthService from './oauth.service';

function requestMeta(req: Request): RequestMeta {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null };
}

function requireUser(req: Request): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

function applyTokens(res: Response, tokens: IssuedTokens): void {
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, tokens.refreshTtlSec);
}

function readRefreshCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE] ?? null;
}

/** Reads a single string query value; arrays and objects are treated as absent. */
function queryString(req: Request, key: string): string | null {
  const value = (req.query as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  return cookies?.nx_access ?? null;
}

// ---------------------------------------------------------------------------
// Register / login / session lifecycle
// ---------------------------------------------------------------------------

export const register = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.register(req.body as RegisterInput, requestMeta(req));
  applyTokens(res, tokens);
  created(res, { user: user.toDto() });
});

export const login = asyncHandler(async (req, res) => {
  const { user, tokens } = await authService.login(req.body as LoginInput, requestMeta(req));
  applyTokens(res, tokens);
  ok(res, { user: user.toDto() });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = readRefreshCookie(req);
  try {
    if (!token) throw ApiError.unauthorized('Refresh token missing');
    const { user, tokens } = await authService.refreshSession(token);
    applyTokens(res, tokens);
    ok(res, { user: user.toDto() });
  } catch (err) {
    // Whatever went wrong, the client's cookies are no longer usable.
    clearAuthCookies(res);
    throw err;
  }
});

/**
 * Finds the session id to delete without requiring a *valid* access token: an expired access
 * token or just the refresh cookie is enough, so logout works even after the 15 min window.
 */
function sessionIdFromRequest(req: Request): string | null {
  if (req.user) return req.user.sessionId;
  const access = readAccessToken(req);
  if (access) {
    try {
      return verifyAccessToken(access).sid;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  const refreshToken = readRefreshCookie(req);
  if (refreshToken) {
    try {
      return verifyRefreshToken(refreshToken).sid;
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }
  return null;
}

export const logout = asyncHandler(async (req, res) => {
  await authService.logout(sessionIdFromRequest(req));
  clearAuthCookies(res);
  noContent(res);
});

export const logoutAll = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  await authService.logoutAll(user.id);
  clearAuthCookies(res);
  noContent(res);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(requireUser(req).id);
  ok(res, user.toDto());
});

// ---------------------------------------------------------------------------
// Password reset & email verification
// ---------------------------------------------------------------------------

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body as ForgotPasswordInput;
  await authService.forgotPassword(email);
  ok(res, { message: 'If an account exists for that email, a password reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body as ResetPasswordInput;
  await authService.resetPassword(token, password);
  clearAuthCookies(res);
  noContent(res);
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body as { token: string };
  const user = await authService.verifyEmail(token);
  ok(res, { user: user.toDto() });
});

export const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(requireUser(req).id);
  noContent(res);
});

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const listSessions = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  ok(res, await authService.listSessions(user.id, user.sessionId));
});

export const deleteSession = asyncHandler(async (req, res) => {
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  await authService.revokeSession(user.id, id);
  noContent(res);
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export const providers: RequestHandler = (_req, res) => {
  ok(res, { google: features.googleOAuth, slack: features.slackOAuth });
};

export const startOAuth = (provider: OAuthProvider) =>
  asyncHandler(async (req, res) => {
    if (!oauthService.isProviderEnabled(provider)) throw ApiError.notFound('OAuth provider');
    const { redirect } = req.query as { redirect?: string };
    const url = await oauthService.buildAuthorizationUrl(provider, oauthService.sanitizeRedirect(redirect));
    res.redirect(302, url);
  });

export const oauthCallback = (provider: OAuthProvider) =>
  asyncHandler(async (req, res) => {
    const failure = `${env.CLIENT_URL}/login?error=oauth_failed`;
    try {
      if (!oauthService.isProviderEnabled(provider)) throw new oauthService.OAuthError('Provider disabled');
      const code = queryString(req, 'code');
      const state = queryString(req, 'state');
      const error = queryString(req, 'error');
      if (error) throw new oauthService.OAuthError(`Provider returned error: ${error}`);
      if (!code || !state) throw new oauthService.OAuthError('Missing code or state');

      const redirect = await oauthService.consumeState(provider, state);
      if (redirect === null) throw new oauthService.OAuthError('Unknown or expired state');

      const profile = await oauthService.fetchProfile(provider, code);
      const user = await oauthService.findOrCreateOAuthUser(provider, profile);
      const tokens = await authService.createSession(user, requestMeta(req), false);
      applyTokens(res, tokens);
      res.redirect(302, `${env.CLIENT_URL}/auth/callback?redirect=${encodeURIComponent(redirect)}`);
    } catch (err) {
      logger.warn({ err, provider }, 'OAuth sign-in failed');
      clearAuthCookies(res);
      res.redirect(302, failure);
    }
  });

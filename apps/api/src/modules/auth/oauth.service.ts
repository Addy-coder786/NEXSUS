import type { OAuthProvider } from '@nexus/shared';
import { env, features } from '../../config/env';
import { logger } from '../../config/logger';
import { cache } from '../../config/redis';
import { User, type UserDocument } from '../../models/User';
import { randomToken } from '../../utils/crypto';

export interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Extra query parameters appended to the authorize URL. */
  authorizeParams?: Record<string, string>;
}

/** Normalised identity returned by a provider's userinfo endpoint. */
export interface OAuthProfile {
  providerId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

const STATE_TTL_SEC = 10 * 60;
const stateKey = (provider: OAuthProvider, state: string) => `oauth:state:${provider}:${state}`;

export function isProviderEnabled(provider: OAuthProvider): boolean {
  return provider === 'google' ? features.googleOAuth : features.slackOAuth;
}

export function getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
  if (!isProviderEnabled(provider)) return null;
  const redirectUri = `${env.API_URL}/api/auth/${provider}/callback`;

  if (provider === 'google') {
    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
      scopes: ['openid', 'email', 'profile'],
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri,
      authorizeParams: { access_type: 'online', prompt: 'select_account' },
    };
  }
  return {
    authorizeUrl: 'https://slack.com/openid/connect/authorize',
    tokenUrl: 'https://slack.com/api/openid.connect.token',
    userInfoUrl: 'https://slack.com/api/openid.connect.userInfo',
    scopes: ['openid', 'email', 'profile'],
    clientId: env.SLACK_CLIENT_ID ?? '',
    clientSecret: env.SLACK_CLIENT_SECRET ?? '',
    redirectUri,
  };
}

/** Only allow same-origin paths as post-login destinations (prevents open redirects). */
export function sanitizeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

/** Creates a CSRF state, remembers the post-login redirect for it, and builds the authorize URL. */
export async function buildAuthorizationUrl(provider: OAuthProvider, redirect: string): Promise<string> {
  const config = getProviderConfig(provider);
  if (!config) throw new OAuthError(`${provider} OAuth is not configured`);

  const state = randomToken();
  await cache.set(stateKey(provider, state), { redirect: sanitizeRedirect(redirect) }, STATE_TTL_SEC);

  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', state);
  for (const [k, v] of Object.entries(config.authorizeParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

/** Validates and consumes a state value. Returns the stored redirect path, or null if unknown. */
export async function consumeState(provider: OAuthProvider, state: string): Promise<string | null> {
  if (!state) return null;
  const key = stateKey(provider, state);
  const stored = await cache.get<{ redirect: string }>(key);
  if (!stored) return null;
  await cache.del(key);
  return sanitizeRedirect(stored.redirect);
}

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new OAuthError(`Token endpoint responded ${res.status}`);
  return (await res.json()) as T;
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new OAuthError(`Userinfo endpoint responded ${res.status}`);
  return (await res.json()) as T;
}

interface TokenResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface SlackUserInfo {
  ok?: boolean;
  error?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/** Exchanges the authorization code for tokens and loads the user's profile. */
export async function fetchProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const config = getProviderConfig(provider);
  if (!config) throw new OAuthError(`${provider} OAuth is not configured`);

  const token = await postForm<TokenResponse>(config.tokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  if (token.ok === false || token.error || !token.access_token) {
    throw new OAuthError(`Token exchange failed: ${token.error ?? 'no access token'}`);
  }

  if (provider === 'google') {
    const info = await getJson<GoogleUserInfo>(config.userInfoUrl, token.access_token);
    if (!info.sub || !info.email) throw new OAuthError('Google profile is missing sub/email');
    return {
      providerId: info.sub,
      email: info.email.toLowerCase(),
      emailVerified: info.email_verified === true,
      name: info.name ?? null,
      avatarUrl: info.picture ?? null,
    };
  }

  const info = await getJson<SlackUserInfo>(config.userInfoUrl, token.access_token);
  if (info.ok === false || info.error) {
    throw new OAuthError(`Slack userinfo failed: ${info.error ?? 'unknown'}`);
  }
  if (!info.sub || !info.email) throw new OAuthError('Slack profile is missing sub/email');
  return {
    providerId: info.sub,
    email: info.email.toLowerCase(),
    // Slack only exposes workspace-verified addresses through OpenID Connect.
    emailVerified: true,
    name: info.name ?? null,
    avatarUrl: info.picture ?? null,
  };
}

/**
 * Resolves the local user for an OAuth identity:
 *  1. a user already linked to this provider account;
 *  2. a user with the same (verified) email, who gets the provider linked;
 *  3. otherwise a new user with `emailVerified: true` and no password.
 */
export async function findOrCreateOAuthUser(
  provider: OAuthProvider,
  profile: OAuthProfile,
): Promise<UserDocument> {
  if (!profile.emailVerified) throw new OAuthError('Provider email is not verified');

  const linked = await User.findOne(
    { deletedAt: null, oauthAccounts: { $elemMatch: { provider, providerId: profile.providerId } } },
    '+passwordHash',
  );
  if (linked) {
    if (!linked.avatarUrl && profile.avatarUrl) linked.avatarUrl = profile.avatarUrl;
    linked.lastLoginAt = new Date();
    await linked.save();
    return linked;
  }

  const byEmail = await User.findOne({ email: profile.email, deletedAt: null }, '+passwordHash');
  if (byEmail) {
    byEmail.oauthAccounts.push({ provider, providerId: profile.providerId, email: profile.email });
    byEmail.emailVerified = true;
    if (!byEmail.avatarUrl && profile.avatarUrl) byEmail.avatarUrl = profile.avatarUrl;
    byEmail.lastLoginAt = new Date();
    await byEmail.save();
    logger.info({ userId: byEmail._id, provider }, 'Linked OAuth provider to existing user');
    return byEmail;
  }

  const fallbackName = profile.email.split('@')[0] ?? 'New user';
  const user = new User({
    name: (profile.name?.trim() || fallbackName).slice(0, 60),
    email: profile.email,
    emailVerified: true,
    avatarUrl: profile.avatarUrl,
    oauthAccounts: [{ provider, providerId: profile.providerId, email: profile.email }],
    lastLoginAt: new Date(),
  });
  await user.save();
  logger.info({ userId: user._id, provider }, 'Created user from OAuth sign-in');
  return user;
}

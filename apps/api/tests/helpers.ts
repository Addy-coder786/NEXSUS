import { REFRESH_TOKEN_TTL_SEC } from '@nexus/shared';
import request from 'supertest';
import { createApp } from '../src/app';
import { Session } from '../src/models/Session';
import { User, type UserDocument } from '../src/models/User';
import { ACCESS_COOKIE } from '../src/utils/cookies';
import { sha256, randomToken } from '../src/utils/crypto';
import { signAccessToken } from '../src/utils/tokens';

export const app = createApp();
export const api = () => request(app);

let counter = 0;

export interface TestUser {
  user: UserDocument;
  id: string;
  /** Cookie header value to send with authenticated requests. */
  cookie: string;
  accessToken: string;
}

/**
 * Creates a verified user directly in the DB and signs an access token for them.
 * Does not depend on the auth routes, so every module's tests can use it.
 */
export async function createTestUser(overrides: Partial<{ name: string; email: string; password: string; emailVerified: boolean }> = {}): Promise<TestUser> {
  counter += 1;
  const user = new User({
    name: overrides.name ?? `User ${counter}`,
    email: overrides.email ?? `user${counter}-${Date.now()}@test.dev`,
    emailVerified: overrides.emailVerified ?? true,
  });
  await user.setPassword(overrides.password ?? 'Password123');
  await user.save();

  const session = await Session.create({
    userId: user._id,
    refreshTokenHash: sha256(randomToken()),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SEC * 1000),
  });
  const accessToken = signAccessToken({ sub: String(user._id), sid: String(session._id), tv: user.tokenVersion });

  return { user, id: String(user._id), cookie: `${ACCESS_COOKIE}=${accessToken}`, accessToken };
}

/** Pull the value of a Set-Cookie header by name from a supertest response. */
export function getCookie(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith(`${name}=`));
}

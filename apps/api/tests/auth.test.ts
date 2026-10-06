import { ERROR_CODES, REFRESH_TOKEN_REMEMBER_TTL_SEC, REFRESH_TOKEN_TTL_SEC } from '@nexus/shared';
import mongoose from 'mongoose';
import type { Response } from 'supertest';
import { env, features } from '../src/config/env';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { sentEmails, type EmailMessage } from '../src/services/email';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/utils/cookies';
import { api, createTestUser, getCookie } from './helpers';

const PASSWORD = 'Password123';

/** "name=value" part of a Set-Cookie header. */
const cookieValue = (setCookie: string | undefined): string => setCookie?.split(';')[0] ?? '';

/** Cookie header carrying both auth cookies from a response. */
function authCookies(res: Response): string {
  return [cookieValue(getCookie(res, ACCESS_COOKIE)), cookieValue(getCookie(res, REFRESH_COOKIE))].join('; ');
}

function refreshCookie(res: Response): string {
  return cookieValue(getCookie(res, REFRESH_COOKIE));
}

function accessCookie(res: Response): string {
  return cookieValue(getCookie(res, ACCESS_COOKIE));
}

function maxAge(setCookie: string | undefined): number {
  const match = /Max-Age=(\d+)/.exec(setCookie ?? '');
  return match ? Number(match[1]) : -1;
}

function expectCleared(setCookie: string | undefined, name: string) {
  expect(setCookie).toBeDefined();
  expect(setCookie).toMatch(new RegExp(`^${name}=;`));
  expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970/);
}

function tokenFromEmail(email: EmailMessage | undefined, pathName: string): string {
  expect(email).toBeDefined();
  const match = new RegExp(`${pathName}\\?token=([A-Za-z0-9_%-]+)`).exec(email?.html ?? '');
  expect(match).not.toBeNull();
  return decodeURIComponent(match?.[1] ?? '');
}

let emailCounter = 0;
const uniqueEmail = () => `auth${(emailCounter += 1)}-${Date.now()}@test.dev`;

async function registerUser(overrides: Partial<{ name: string; email: string; password: string }> = {}) {
  const body = {
    name: overrides.name ?? 'Ada Lovelace',
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? PASSWORD,
  };
  const res = await api().post('/api/auth/register').send(body);
  return { res, body };
}

async function loginUser(email: string, password = PASSWORD, extra: Record<string, unknown> = {}) {
  return api().post('/api/auth/login').send({ email, password, ...extra });
}

beforeEach(() => {
  sentEmails.length = 0;
});

describe('POST /api/auth/register', () => {
  it('creates the user, sets both cookies and sends a verification email', async () => {
    const { res, body } = await registerUser({ email: 'Ada@Test.DEV' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const user = res.body.data.user;
    expect(user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@test.dev',
      emailVerified: false,
      hasPassword: true,
      oauthProviders: [],
      avatarUrl: null,
    });
    expect(user.id).toMatch(/^[0-9a-f]{24}$/);
    expect(user.passwordHash).toBeUndefined();
    expect(user.preferences.theme).toBe('system');

    const access = getCookie(res, ACCESS_COOKIE);
    const refresh = getCookie(res, REFRESH_COOKIE);
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/Path=\//);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Path=\/api\/auth/);
    expect(maxAge(refresh)).toBe(REFRESH_TOKEN_TTL_SEC);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({ to: 'ada@test.dev', subject: 'Verify your email address' });
    expect(sentEmails[0]?.html).toContain(`${env.CLIENT_URL}/verify-email?token=`);

    expect(await Session.countDocuments({ userId: user.id })).toBe(1);
    void body;
  });

  it('returns 409 for a duplicate email (case-insensitive)', async () => {
    const { body } = await registerUser({ email: 'dupe@test.dev' });
    const { res } = await registerUser({ email: 'DUPE@test.dev', name: 'Someone Else' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe(ERROR_CODES.CONFLICT);
    void body;
  });

  it('returns 422 for a weak password', async () => {
    const { res } = await registerUser({ password: 'weak' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'password' })]),
    );
    expect(sentEmails).toHaveLength(0);
  });

  it('returns 422 for an invalid email or short name', async () => {
    const { res } = await registerUser({ email: 'not-an-email' });
    expect(res.status).toBe(422);
    const { res: res2 } = await registerUser({ name: 'A' });
    expect(res2.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with valid credentials and sets cookies', async () => {
    const { body } = await registerUser();
    const res = await loginUser(body.email);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(body.email);
    expect(getCookie(res, ACCESS_COOKIE)).toBeDefined();
    expect(maxAge(getCookie(res, REFRESH_COOKIE))).toBe(REFRESH_TOKEN_TTL_SEC);

    const dbUser = await User.findOne({ email: body.email });
    expect(dbUser?.lastLoginAt).toBeInstanceOf(Date);
    expect(await Session.countDocuments({ userId: dbUser?._id })).toBe(2);
  });

  it('honours rememberMe with a longer refresh cookie and session', async () => {
    const { body } = await registerUser();
    const res = await loginUser(body.email, PASSWORD, { rememberMe: true });

    expect(res.status).toBe(200);
    expect(maxAge(getCookie(res, REFRESH_COOKIE))).toBe(REFRESH_TOKEN_REMEMBER_TTL_SEC);
    const sessions = await Session.find({ rememberMe: true });
    expect(sessions).toHaveLength(1);
  });

  it('returns the same generic 401 for a wrong password and an unknown email', async () => {
    const { body } = await registerUser();
    const wrong = await loginUser(body.email, 'WrongPass123');
    const unknown = await loginUser('nobody@test.dev', PASSWORD);

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(unknown.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(getCookie(wrong, ACCESS_COOKIE)).toBeUndefined();
  });

  it('rejects password login for OAuth-only accounts with the same 401', async () => {
    await User.create({
      name: 'OAuth Only',
      email: 'oauth-only@test.dev',
      emailVerified: true,
      oauthAccounts: [{ provider: 'google', providerId: 'g-1', email: 'oauth-only@test.dev' }],
    });
    const res = await loginUser('oauth-only@test.dev', PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });
});

describe('GET /api/auth/me', () => {
  it('works with the access cookie and with a Bearer token', async () => {
    const { res: reg } = await registerUser();
    const viaCookie = await api().get('/api/auth/me').set('Cookie', accessCookie(reg));
    expect(viaCookie.status).toBe(200);
    expect(viaCookie.body.data.id).toBe(reg.body.data.user.id);

    const token = accessCookie(reg).slice(`${ACCESS_COOKIE}=`.length);
    const viaBearer = await api().get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(viaBearer.status).toBe(200);
    expect(viaBearer.body.data.email).toBe(reg.body.data.user.email);
    expect(viaBearer.body.data.passwordHash).toBeUndefined();
  });

  it('returns 401 without a token and for a malformed token', async () => {
    const none = await api().get('/api/auth/me');
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);

    const bad = await api().get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt');
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
  });

  it('also works with the helper-created test user', async () => {
    const tu = await createTestUser();
    const res = await api().get('/api/auth/me').set('Cookie', tu.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(tu.id);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates both cookies and keeps the session alive', async () => {
    const { res: reg } = await registerUser();
    const sessionBefore = await Session.findOne({});

    const res = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(reg.body.data.user.id);
    // Access tokens with identical claims signed in the same second are byte-identical (iat has
    // 1 s resolution), so rotation is asserted on the refresh token, which carries a random jti.
    expect(accessCookie(res)).toMatch(/^nx_access=.+/);
    expect(refreshCookie(res)).not.toBe(refreshCookie(reg));
    expect(maxAge(getCookie(res, REFRESH_COOKIE))).toBeLessThanOrEqual(REFRESH_TOKEN_TTL_SEC);

    const sessionAfter = await Session.findById(sessionBefore?._id);
    expect(sessionAfter?.refreshTokenHash).not.toBe(sessionBefore?.refreshTokenHash);
    expect(await Session.countDocuments({})).toBe(1);

    const me = await api().get('/api/auth/me').set('Cookie', accessCookie(res));
    expect(me.status).toBe(200);
  });

  it('detects reuse of an old refresh token, revokes the session and rejects the rotated token too', async () => {
    const { res: reg } = await registerUser();
    const first = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(first.status).toBe(200);

    // Replay the original (already rotated-out) token.
    const reuse = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
    expectCleared(getCookie(reuse, ACCESS_COOKIE), ACCESS_COOKIE);
    expectCleared(getCookie(reuse, REFRESH_COOKIE), REFRESH_COOKIE);

    const session = await Session.findOne({});
    expect(session?.revokedAt).toBeInstanceOf(Date);

    // The legitimate client's latest token is now dead as well.
    const again = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(first));
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
  });

  it('returns 401 without a refresh cookie or with garbage', async () => {
    const none = await api().post('/api/auth/refresh');
    expect(none.status).toBe(401);
    const bad = await api().post('/api/auth/refresh').set('Cookie', `${REFRESH_COOKIE}=garbage`);
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
  });

  it('returns 401 once the session was deleted', async () => {
    const { res: reg } = await registerUser();
    await Session.deleteMany({});
    const res = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('deletes the session, clears cookies and the refresh token stops working', async () => {
    const { res: reg } = await registerUser();
    const res = await api().post('/api/auth/logout').set('Cookie', authCookies(reg));

    expect(res.status).toBe(204);
    expectCleared(getCookie(res, ACCESS_COOKIE), ACCESS_COOKIE);
    expectCleared(getCookie(res, REFRESH_COOKIE), REFRESH_COOKIE);
    expect(await Session.countDocuments({})).toBe(0);

    // Browser now has no cookies.
    const me = await api().get('/api/auth/me');
    expect(me.status).toBe(401);
    // And the old refresh token can no longer mint access tokens.
    const refresh = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(refresh.status).toBe(401);
  });

  it('works with only the refresh cookie (expired access token scenario)', async () => {
    const { res: reg } = await registerUser();
    const res = await api().post('/api/auth/logout').set('Cookie', refreshCookie(reg));
    expect(res.status).toBe(204);
    expect(await Session.countDocuments({})).toBe(0);
  });

  it('is a no-op 204 without any cookies', async () => {
    const res = await api().post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('POST /api/auth/logout-all', () => {
  it('invalidates access and refresh tokens of every session', async () => {
    const { res: s1, body } = await registerUser();
    const s2 = await loginUser(body.email);
    expect(await Session.countDocuments({})).toBe(2);

    const res = await api().post('/api/auth/logout-all').set('Cookie', authCookies(s1));
    expect(res.status).toBe(204);
    expectCleared(getCookie(res, ACCESS_COOKIE), ACCESS_COOKIE);
    expect(await Session.countDocuments({})).toBe(0);

    for (const s of [s1, s2]) {
      const me = await api().get('/api/auth/me').set('Cookie', accessCookie(s));
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
      const refresh = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(s));
      expect(refresh.status).toBe(401);
    }

    const user = await User.findOne({ email: body.email });
    expect(user?.tokenVersion).toBe(1);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/auth/logout-all');
    expect(res.status).toBe(401);
  });
});

describe('password reset flow', () => {
  it('always answers 200 and only emails existing accounts', async () => {
    const { body } = await registerUser();
    sentEmails.length = 0;

    const known = await api().post('/api/auth/forgot-password').send({ email: body.email.toUpperCase() });
    expect(known.status).toBe(200);
    expect(known.body.data.message).toEqual(expect.any(String));
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.subject).toBe('Reset your NEXUS password');
    expect(sentEmails[0]?.html).toContain(`${env.CLIENT_URL}/reset-password?token=`);

    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@test.dev' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.message).toBe(known.body.data.message);
    expect(sentEmails).toHaveLength(1);
  });

  it('resets the password, kills old sessions and makes the token single-use', async () => {
    const { res: reg, body } = await registerUser();
    sentEmails.length = 0;
    await api().post('/api/auth/forgot-password').send({ email: body.email });
    const token = tokenFromEmail(sentEmails[0], 'reset-password');

    const reset = await api().post('/api/auth/reset-password').send({ token, password: 'NewPassword456' });
    expect(reset.status).toBe(204);

    // Old credentials and sessions are gone.
    expect((await loginUser(body.email, PASSWORD)).status).toBe(401);
    expect(await Session.countDocuments({})).toBe(0);
    const oldAccess = await api().get('/api/auth/me').set('Cookie', accessCookie(reg));
    expect(oldAccess.status).toBe(401);
    expect(oldAccess.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);
    const oldRefresh = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(reg));
    expect(oldRefresh.status).toBe(401);

    // New password works.
    const login = await loginUser(body.email, 'NewPassword456');
    expect(login.status).toBe(200);

    // Token cannot be replayed.
    const replay = await api().post('/api/auth/reset-password').send({ token, password: 'Another789Pass' });
    expect(replay.status).toBe(400);
    expect(replay.body.error.message).toBe('Invalid or expired token');

    // A "password changed" notice was sent.
    expect(sentEmails.some((e) => e.subject === 'Your NEXUS password was changed')).toBe(true);
  });

  it('rejects unknown tokens and weak passwords', async () => {
    const bogus = await api()
      .post('/api/auth/reset-password')
      .send({ token: 'x'.repeat(40), password: 'NewPassword456' });
    expect(bogus.status).toBe(400);

    const weak = await api().post('/api/auth/reset-password').send({ token: 'x'.repeat(40), password: 'weak' });
    expect(weak.status).toBe(422);

    const short = await api().post('/api/auth/reset-password').send({ token: 'short', password: 'NewPassword456' });
    expect(short.status).toBe(422);
  });

  it('issues a new reset token that supersedes the previous one', async () => {
    const { body } = await registerUser();
    sentEmails.length = 0;
    await api().post('/api/auth/forgot-password').send({ email: body.email });
    await api().post('/api/auth/forgot-password').send({ email: body.email });
    const first = tokenFromEmail(sentEmails[0], 'reset-password');
    const second = tokenFromEmail(sentEmails[1], 'reset-password');
    expect(first).not.toBe(second);

    const stale = await api().post('/api/auth/reset-password').send({ token: first, password: 'NewPassword456' });
    expect(stale.status).toBe(400);
    const fresh = await api().post('/api/auth/reset-password').send({ token: second, password: 'NewPassword456' });
    expect(fresh.status).toBe(204);
  });
});

describe('email verification', () => {
  it('verifies the email with the token from the registration email', async () => {
    const { res: reg } = await registerUser();
    const token = tokenFromEmail(sentEmails[0], 'verify-email');

    const res = await api().post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerified).toBe(true);
    expect(res.body.data.user.id).toBe(reg.body.data.user.id);

    const me = await api().get('/api/auth/me').set('Cookie', accessCookie(reg));
    expect(me.body.data.emailVerified).toBe(true);

    // Opening the link again is harmless.
    const again = await api().post('/api/auth/verify-email').send({ token });
    expect(again.status).toBe(200);
  });

  it('rejects unknown tokens', async () => {
    const res = await api().post('/api/auth/verify-email').send({ token: 'y'.repeat(40) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Invalid or expired token');
  });

  it('resend invalidates the previous token and sends a new one', async () => {
    const { res: reg } = await registerUser();
    const oldToken = tokenFromEmail(sentEmails[0], 'verify-email');
    sentEmails.length = 0;

    const resend = await api().post('/api/auth/resend-verification').set('Cookie', accessCookie(reg));
    expect(resend.status).toBe(204);
    expect(sentEmails).toHaveLength(1);
    const newToken = tokenFromEmail(sentEmails[0], 'verify-email');
    expect(newToken).not.toBe(oldToken);

    const stale = await api().post('/api/auth/verify-email').send({ token: oldToken });
    expect(stale.status).toBe(400);

    const fresh = await api().post('/api/auth/verify-email').send({ token: newToken });
    expect(fresh.status).toBe(200);

    const alreadyVerified = await api().post('/api/auth/resend-verification').set('Cookie', accessCookie(reg));
    expect(alreadyVerified.status).toBe(400);
  });

  it('resend requires authentication', async () => {
    const res = await api().post('/api/auth/resend-verification');
    expect(res.status).toBe(401);
  });
});

describe('sessions', () => {
  it('lists sessions newest first with the current one flagged', async () => {
    const { res: s1, body } = await registerUser();
    const s2 = await loginUser(body.email).then((r) => r);
    const s2Again = await api()
      .post('/api/auth/login')
      .set('User-Agent', 'NexusTest/2.0')
      .send({ email: body.email, password: PASSWORD });
    void s2;

    const res = await api().get('/api/auth/sessions').set('Cookie', accessCookie(s2Again));
    expect(res.status).toBe(200);
    const list = res.body.data as Array<{ id: string; current: boolean; userAgent: string | null; createdAt: string }>;
    expect(list).toHaveLength(3);
    expect(list[0]?.current).toBe(true);
    expect(list[0]?.userAgent).toBe('NexusTest/2.0');
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.every((s) => typeof s.createdAt === 'string')).toBe(true);
    for (let i = 1; i < list.length; i += 1) {
      expect(new Date(list[i - 1]?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(list[i]?.createdAt ?? 0).getTime(),
      );
    }

    const fromFirst = await api().get('/api/auth/sessions').set('Cookie', accessCookie(s1));
    expect(fromFirst.body.data.find((s: { current: boolean }) => s.current).id).toBe(list[2]?.id);
  });

  it('deletes another session of the same user and refuses foreign or unknown ids', async () => {
    const { res: s1, body } = await registerUser();
    const s2 = await loginUser(body.email);
    const other = await createTestUser();

    const list = await api().get('/api/auth/sessions').set('Cookie', accessCookie(s1));
    const target = list.body.data.find((s: { current: boolean }) => !s.current) as { id: string };

    const del = await api().delete(`/api/auth/sessions/${target.id}`).set('Cookie', accessCookie(s1));
    expect(del.status).toBe(204);
    expect(await Session.findById(target.id)).toBeNull();
    const refresh = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(s2));
    expect(refresh.status).toBe(401);

    const again = await api().delete(`/api/auth/sessions/${target.id}`).set('Cookie', accessCookie(s1));
    expect(again.status).toBe(404);

    const otherSessions = await Session.find({ userId: other.id });
    const foreign = await api()
      .delete(`/api/auth/sessions/${String(otherSessions[0]?._id)}`)
      .set('Cookie', accessCookie(s1));
    expect(foreign.status).toBe(404);
    expect(await Session.countDocuments({ userId: other.id })).toBe(1);

    const invalid = await api().delete('/api/auth/sessions/not-an-id').set('Cookie', accessCookie(s1));
    expect(invalid.status).toBe(422);

    const unknown = await api()
      .delete(`/api/auth/sessions/${new mongoose.Types.ObjectId().toHexString()}`)
      .set('Cookie', accessCookie(s1));
    expect(unknown.status).toBe(404);
  });
});

describe('OAuth', () => {
  it('GET /providers reports which providers are configured', async () => {
    const res = await api().get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ google: false, slack: false });
  });

  it('returns 404 when starting a disabled provider and fails the callback gracefully', async () => {
    const google = await api().get('/api/auth/google').query({ redirect: '/dashboard' });
    expect(google.status).toBe(404);
    const slack = await api().get('/api/auth/slack');
    expect(slack.status).toBe(404);

    const cb = await api().get('/api/auth/google/callback').query({ code: 'abc', state: 'xyz' });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${env.CLIENT_URL}/login?error=oauth_failed`);
  });

  describe('with Google enabled', () => {
    const original = { flag: features.googleOAuth, id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
    let fetchMock: jest.SpiedFunction<typeof fetch>;
    let profile: Record<string, unknown>;

    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    beforeAll(() => {
      features.googleOAuth = true;
      env.GOOGLE_CLIENT_ID = 'google-client-id';
      env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    });

    afterAll(() => {
      features.googleOAuth = original.flag;
      env.GOOGLE_CLIENT_ID = original.id;
      env.GOOGLE_CLIENT_SECRET = original.secret;
    });

    beforeEach(() => {
      profile = {
        sub: 'google-sub-1',
        email: 'Grace@Test.dev',
        email_verified: true,
        name: 'Grace Hopper',
        picture: 'https://lh3.example.com/grace.png',
      };
      fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          const params = new URLSearchParams(String(init?.body ?? ''));
          if (params.get('code') !== 'good-code') return jsonResponse({ error: 'invalid_grant' }, 400);
          return jsonResponse({ access_token: 'google-access-token', id_token: 'x' });
        }
        if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
          expect(init?.headers).toMatchObject({ Authorization: 'Bearer google-access-token' });
          return jsonResponse(profile);
        }
        throw new Error(`Unexpected fetch ${url}`);
      });
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    async function startAndGetState(redirect?: string): Promise<string> {
      const start = await api().get('/api/auth/google').query(redirect ? { redirect } : {});
      expect(start.status).toBe(302);
      const location = new URL(start.headers.location as string);
      expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location.searchParams.get('client_id')).toBe('google-client-id');
      expect(location.searchParams.get('redirect_uri')).toBe(`${env.API_URL}/api/auth/google/callback`);
      expect(location.searchParams.get('scope')).toBe('openid email profile');
      return location.searchParams.get('state') ?? '';
    }

    it('reports google as available', async () => {
      const res = await api().get('/api/auth/providers');
      expect(res.body.data).toEqual({ google: true, slack: false });
    });

    it('creates a verified user on first sign-in and redirects with cookies', async () => {
      const state = await startAndGetState('/projects/42');
      expect(state.length).toBeGreaterThan(20);

      const cb = await api().get('/api/auth/google/callback').query({ code: 'good-code', state });
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toBe(`${env.CLIENT_URL}/auth/callback?redirect=${encodeURIComponent('/projects/42')}`);
      expect(getCookie(cb, ACCESS_COOKIE)).toBeDefined();
      expect(getCookie(cb, REFRESH_COOKIE)).toBeDefined();

      const me = await api().get('/api/auth/me').set('Cookie', accessCookie(cb));
      expect(me.status).toBe(200);
      expect(me.body.data).toMatchObject({
        email: 'grace@test.dev',
        name: 'Grace Hopper',
        emailVerified: true,
        hasPassword: false,
        oauthProviders: ['google'],
        avatarUrl: 'https://lh3.example.com/grace.png',
      });

      // State is single-use.
      const replay = await api().get('/api/auth/google/callback').query({ code: 'good-code', state });
      expect(replay.headers.location).toBe(`${env.CLIENT_URL}/login?error=oauth_failed`);
    });

    it('links the provider to an existing account with the same email', async () => {
      const { body } = await registerUser({ email: 'grace@test.dev' });
      const state = await startAndGetState();
      const cb = await api().get('/api/auth/google/callback').query({ code: 'good-code', state });
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toBe(`${env.CLIENT_URL}/auth/callback?redirect=${encodeURIComponent('/')}`);

      const users = await User.find({ email: body.email });
      expect(users).toHaveLength(1);
      expect(users[0]?.oauthAccounts).toEqual([
        expect.objectContaining({ provider: 'google', providerId: 'google-sub-1' }),
      ]);
      expect(users[0]?.emailVerified).toBe(true);

      const me = await api().get('/api/auth/me').set('Cookie', accessCookie(cb));
      expect(me.body.data.hasPassword).toBe(true);
      expect(me.body.data.oauthProviders).toEqual(['google']);
    });

    it('ignores external redirect targets', async () => {
      const state = await startAndGetState('https://evil.example.com/phish');
      const cb = await api().get('/api/auth/google/callback').query({ code: 'good-code', state });
      expect(cb.headers.location).toBe(`${env.CLIENT_URL}/auth/callback?redirect=${encodeURIComponent('/')}`);
    });

    it('fails on unknown state, provider error, bad code or unverified email', async () => {
      const failure = `${env.CLIENT_URL}/login?error=oauth_failed`;

      const badState = await api().get('/api/auth/google/callback').query({ code: 'good-code', state: 'nope' });
      expect(badState.headers.location).toBe(failure);

      const denied = await api().get('/api/auth/google/callback').query({ error: 'access_denied', state: 'x' });
      expect(denied.headers.location).toBe(failure);

      const state1 = await startAndGetState();
      const badCode = await api().get('/api/auth/google/callback').query({ code: 'bad-code', state: state1 });
      expect(badCode.headers.location).toBe(failure);

      profile.email_verified = false;
      const state2 = await startAndGetState();
      const unverified = await api().get('/api/auth/google/callback').query({ code: 'good-code', state: state2 });
      expect(unverified.headers.location).toBe(failure);
      expect(getCookie(unverified, ACCESS_COOKIE)).not.toMatch(/^nx_access=[^;]+;/);
      expect(await User.countDocuments({ email: 'grace@test.dev' })).toBe(0);
    });
  });
});

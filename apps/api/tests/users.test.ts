import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ERROR_CODES } from '@nexus/shared';
import mongoose from 'mongoose';
import type { Response } from 'supertest';
import { env } from '../src/config/env';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { sentEmails } from '../src/services/email';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/utils/cookies';
import { api, createTestUser, getCookie } from './helpers';

const PASSWORD = 'Password123';
const cookieValue = (setCookie: string | undefined): string => setCookie?.split(';')[0] ?? '';
const accessCookie = (res: Response) => cookieValue(getCookie(res, ACCESS_COOKIE));
const refreshCookie = (res: Response) => cookieValue(getCookie(res, REFRESH_COOKIE));

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

beforeEach(() => {
  sentEmails.length = 0;
});

describe('GET /api/users/me', () => {
  it('returns the full UserDto for the caller', async () => {
    const tu = await createTestUser({ name: 'Linus' });
    const res = await api().get('/api/users/me').set('Cookie', tu.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: tu.id,
      name: 'Linus',
      email: tu.user.email,
      emailVerified: true,
      hasPassword: true,
      oauthProviders: [],
    });
    expect(res.body.data.preferences.notifications.email).toBe(true);
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('requires authentication', async () => {
    const res = await api().get('/api/users/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates profile fields and clears optional text with empty strings', async () => {
    const tu = await createTestUser();
    const res = await api()
      .patch('/api/users/me')
      .set('Cookie', tu.cookie)
      .send({ name: '  Margaret Hamilton ', bio: 'Apollo', title: 'Engineer', timezone: 'America/New_York', availability: 'BUSY' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Margaret Hamilton',
      bio: 'Apollo',
      title: 'Engineer',
      timezone: 'America/New_York',
      availability: 'BUSY',
    });

    const cleared = await api().patch('/api/users/me').set('Cookie', tu.cookie).send({ bio: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.bio).toBeNull();
    expect(cleared.body.data.title).toBe('Engineer');

    const db = await User.findById(tu.id);
    expect(db?.name).toBe('Margaret Hamilton');
    expect(db?.bio).toBeNull();
  });

  it('validates input', async () => {
    const tu = await createTestUser();
    const badAvailability = await api().patch('/api/users/me').set('Cookie', tu.cookie).send({ availability: 'NAPPING' });
    expect(badAvailability.status).toBe(422);
    expect(badAvailability.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);

    const shortName = await api().patch('/api/users/me').set('Cookie', tu.cookie).send({ name: 'X' });
    expect(shortName.status).toBe(422);

    const longBio = await api().patch('/api/users/me').set('Cookie', tu.cookie).send({ bio: 'b'.repeat(301) });
    expect(longBio.status).toBe(422);
  });

  it('ignores fields that are not part of the profile', async () => {
    const tu = await createTestUser();
    const res = await api()
      .patch('/api/users/me')
      .set('Cookie', tu.cookie)
      .send({ email: 'hacker@test.dev', emailVerified: false, tokenVersion: 99 });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(tu.user.email);
    expect(res.body.data.emailVerified).toBe(true);
  });
});

describe('PATCH /api/users/me/preferences', () => {
  it('merges notification preferences and sets the theme', async () => {
    const tu = await createTestUser();
    const res = await api()
      .patch('/api/users/me/preferences')
      .set('Cookie', tu.cookie)
      .send({ theme: 'dark', notifications: { email: false, mentions: false } });

    expect(res.status).toBe(200);
    expect(res.body.data.preferences.theme).toBe('dark');
    expect(res.body.data.preferences.notifications).toMatchObject({
      email: false,
      mentions: false,
      inApp: true,
      taskAssigned: true,
      comments: true,
    });

    const onlyTheme = await api().patch('/api/users/me/preferences').set('Cookie', tu.cookie).send({ theme: 'light' });
    expect(onlyTheme.body.data.preferences.theme).toBe('light');
    expect(onlyTheme.body.data.preferences.notifications.email).toBe(false);
  });

  it('rejects unknown themes', async () => {
    const tu = await createTestUser();
    const res = await api().patch('/api/users/me/preferences').set('Cookie', tu.cookie).send({ theme: 'neon' });
    expect(res.status).toBe(422);
  });
});

describe('PATCH /api/users/me/password', () => {
  async function loginSession(email: string, password = PASSWORD) {
    const res = await api().post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res;
  }

  it('changes the password, keeps the current session and kills the others', async () => {
    const tu = await createTestUser();
    const current = await loginSession(tu.user.email);
    const other = await loginSession(tu.user.email);
    expect(await Session.countDocuments({ userId: tu.id })).toBe(3);

    const res = await api()
      .patch('/api/users/me/password')
      .set('Cookie', accessCookie(current))
      .send({ currentPassword: PASSWORD, newPassword: 'Brand-New-Pass1' });
    expect(res.status).toBe(204);

    // Fresh cookies for the current session.
    const newAccess = accessCookie(res);
    const newRefresh = refreshCookie(res);
    expect(newAccess).toMatch(/^nx_access=.+/);
    expect(newAccess).not.toBe(accessCookie(current));
    expect(newRefresh).toMatch(/^nx_refresh=.+/);

    const meNew = await api().get('/api/auth/me').set('Cookie', newAccess);
    expect(meNew.status).toBe(200);
    const refreshNew = await api().post('/api/auth/refresh').set('Cookie', newRefresh);
    expect(refreshNew.status).toBe(200);

    // The old token for the same session is dead (tokenVersion bumped) ...
    const meOld = await api().get('/api/auth/me').set('Cookie', accessCookie(current));
    expect(meOld.status).toBe(401);
    expect(meOld.body.error.code).toBe(ERROR_CODES.TOKEN_INVALID);

    // ... and the other sessions are gone entirely.
    expect(await Session.countDocuments({ userId: tu.id })).toBe(1);
    const otherMe = await api().get('/api/auth/me').set('Cookie', accessCookie(other));
    expect(otherMe.status).toBe(401);
    const otherRefresh = await api().post('/api/auth/refresh').set('Cookie', refreshCookie(other));
    expect(otherRefresh.status).toBe(401);
    const helperToken = await api().get('/api/auth/me').set('Cookie', tu.cookie);
    expect(helperToken.status).toBe(401);

    // Credentials changed.
    expect((await api().post('/api/auth/login').send({ email: tu.user.email, password: PASSWORD })).status).toBe(401);
    await loginSession(tu.user.email, 'Brand-New-Pass1');

    expect(sentEmails.some((e) => e.subject === 'Your NEXUS password was changed')).toBe(true);
  });

  it('returns 401 when the current password is wrong and leaves sessions intact', async () => {
    const tu = await createTestUser();
    const res = await api()
      .patch('/api/users/me/password')
      .set('Cookie', tu.cookie)
      .send({ currentPassword: 'Nope12345', newPassword: 'Brand-New-Pass1' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Current password is incorrect');
    expect(await Session.countDocuments({ userId: tu.id })).toBe(1);
    const me = await api().get('/api/auth/me').set('Cookie', tu.cookie);
    expect(me.status).toBe(200);
  });

  it('returns 400 for accounts without a password (OAuth-only)', async () => {
    const tu = await createTestUser();
    tu.user.passwordHash = null;
    await tu.user.save();
    const res = await api()
      .patch('/api/users/me/password')
      .set('Cookie', tu.cookie)
      .send({ currentPassword: 'whatever', newPassword: 'Brand-New-Pass1' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);
  });

  it('validates the new password', async () => {
    const tu = await createTestUser();
    const res = await api()
      .patch('/api/users/me/password')
      .set('Cookie', tu.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(422);
  });
});

describe('avatar upload', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpiedFunction<typeof process.cwd>;
  const avatarsDir = () => path.join(tmpDir, 'uploads', 'avatars');
  const filesOnDisk = () => (existsSync(avatarsDir()) ? readdirSync(avatarsDir()) : []);

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-uploads-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterAll(() => {
    cwdSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores a PNG on local disk, replaces it, and deletes it', async () => {
    const tu = await createTestUser();

    const first = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(first.status).toBe(200);
    const firstUrl = first.body.data.avatarUrl as string;
    expect(firstUrl.startsWith(`${env.API_URL}/uploads/avatars/${tu.id}-`)).toBe(true);
    expect(firstUrl.endsWith('.png')).toBe(true);
    expect(filesOnDisk()).toEqual([path.basename(firstUrl)]);

    const second = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', PNG, { filename: 'me2.png', contentType: 'image/png' });
    expect(second.status).toBe(200);
    const secondUrl = second.body.data.avatarUrl as string;
    expect(secondUrl).not.toBe(firstUrl);
    expect(filesOnDisk()).toEqual([path.basename(secondUrl)]);

    const me = await api().get('/api/users/me').set('Cookie', tu.cookie);
    expect(me.body.data.avatarUrl).toBe(secondUrl);

    const del = await api().delete('/api/users/me/avatar').set('Cookie', tu.cookie);
    expect(del.status).toBe(200);
    expect(del.body.data.avatarUrl).toBeNull();
    expect(filesOnDisk()).toEqual([]);

    // Deleting when there is no avatar is fine too.
    const delAgain = await api().delete('/api/users/me/avatar').set('Cookie', tu.cookie);
    expect(delAgain.status).toBe(200);
    expect(delAgain.body.data.avatarUrl).toBeNull();
  });

  it('rejects unsupported content types and mismatched bytes', async () => {
    const tu = await createTestUser();

    const text = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', Buffer.from('hello'), { filename: 'note.txt', contentType: 'text/plain' });
    expect(text.status).toBe(400);
    expect(text.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);

    const gif = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', PNG, { filename: 'a.gif', contentType: 'image/gif' });
    expect(gif.status).toBe(400);

    const spoofed = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    expect(spoofed.status).toBe(400);

    const missing = await api().post('/api/users/me/avatar').set('Cookie', tu.cookie).field('name', 'nothing');
    expect(missing.status).toBe(400);

    expect(filesOnDisk()).toEqual([]);
    const db = await User.findById(tu.id);
    expect(db?.avatarUrl).toBeNull();
  });

  it('rejects files over 2 MB', async () => {
    const tu = await createTestUser();
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const res = await api()
      .post('/api/users/me/avatar')
      .set('Cookie', tu.cookie)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(filesOnDisk()).toEqual([]);
  });

  it('requires authentication', async () => {
    const res = await api().post('/api/users/me/avatar').attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/:id', () => {
  it('returns the public profile only, for users sharing a workspace', async () => {
    const me = await createTestUser();
    const other = await createTestUser({ name: 'Public Person' });
    await api().patch('/api/users/me').set('Cookie', other.cookie).send({ bio: 'secret-ish', title: 'CTO' });

    // Not visible until the two users share a workspace
    const stranger = await api().get(`/api/users/${other.id}`).set('Cookie', me.cookie);
    expect(stranger.status).toBe(404);

    const ws = await api().post('/api/workspaces').set('Cookie', me.cookie).send({ name: 'Shared Space' });
    expect(ws.status).toBe(201);
    await WorkspaceMember.create({ workspaceId: ws.body.data.id, userId: other.id, role: 'MEMBER' });

    const res = await api().get(`/api/users/${other.id}`).set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: other.id,
      name: 'Public Person',
      email: other.user.email,
      avatarUrl: null,
      title: 'CTO',
      availability: 'AVAILABLE',
    });
    expect(res.body.data.bio).toBeUndefined();
    expect(res.body.data.preferences).toBeUndefined();
  });

  it('returns 404 for unknown or soft-deleted users and 422 for bad ids', async () => {
    const me = await createTestUser();
    const gone = await createTestUser();
    await User.updateOne({ _id: gone.id }, { deletedAt: new Date() });

    const unknown = await api().get(`/api/users/${new mongoose.Types.ObjectId().toHexString()}`).set('Cookie', me.cookie);
    expect(unknown.status).toBe(404);
    const deleted = await api().get(`/api/users/${gone.id}`).set('Cookie', me.cookie);
    expect(deleted.status).toBe(404);
    const bad = await api().get('/api/users/abc').set('Cookie', me.cookie);
    expect(bad.status).toBe(422);
  });

  it('requires authentication', async () => {
    const other = await createTestUser();
    const res = await api().get(`/api/users/${other.id}`);
    expect(res.status).toBe(401);
  });
});

import './slack.env';
import type { ChannelDto, MessageDto, SlackIntegrationDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { env, features } from '../src/config/env';
import { cache } from '../src/config/redis';
import { events } from '../src/events';
import { Activity } from '../src/models/Activity';
import { Channel } from '../src/models/Channel';
import { Integration } from '../src/models/Integration';
import { Message } from '../src/models/Message';
import { Notification } from '../src/models/Notification';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { SlackApiError, callSlack } from '../src/modules/integrations/slack/slack.client';
import { backfillChannel, notifySlack } from '../src/modules/integrations/slack/slack.jobs';
import { slackSignature } from '../src/modules/integrations/slack/slack.webhooks';
import { decrypt } from '../src/utils/encryption';
import { api, createTestUser, type TestUser } from './helpers';

// ---------- Slack API mock ----------

type Handler = (params: URLSearchParams) => unknown;
interface Call {
  method: string;
  params: URLSearchParams;
  auth: string | null;
}

const handlers = new Map<string, Handler>();
const calls: Call[] = [];
const callsTo = (method: string) => calls.filter((c) => c.method === method);
const BOT_TOKEN = 'xoxb-test-bot-token';
const TEAM = { id: 'T123', name: 'Acme Slack' };

let memberEmail = '';
let fetchSpy: jest.SpiedFunction<typeof fetch>;

function installDefaultHandlers() {
  handlers.clear();
  handlers.set('oauth.v2.access', () => ({
    ok: true,
    access_token: BOT_TOKEN,
    token_type: 'bot',
    scope: 'channels:read,chat:write',
    bot_user_id: 'UBOT',
    app_id: 'A1',
    team: TEAM,
  }));
  handlers.set('team.info', () => ({ ok: true, team: { ...TEAM, icon: { image_88: 'https://img.example/88.png' } } }));
  handlers.set('auth.revoke', () => ({ ok: true, revoked: true }));
  handlers.set('conversations.list', () => ({
    ok: true,
    channels: [
      { id: 'C1', name: 'general', is_private: false, num_members: 12 },
      { id: 'C2', name: 'eng', is_private: true, num_members: 3 },
      { id: 'C3', name: 'old', is_archived: true },
    ],
  }));
  handlers.set('conversations.join', () => ({ ok: true }));
  handlers.set('conversations.history', () => ({ ok: true, messages: [] }));
  handlers.set('users.info', (params) => {
    const id = params.get('user');
    if (id === 'U1') {
      return { ok: true, user: { id, name: 'member', real_name: 'Member M', profile: { email: memberEmail, real_name: 'Member M', image_72: 'https://img.example/u1.png' } } };
    }
    if (id === 'U2') return { ok: true, user: { id, name: 'olga', profile: { real_name: 'Outside Olga', email: 'olga@slack.example' } } };
    return { ok: false, error: 'user_not_found' };
  });
  handlers.set('chat.postMessage', (params) => ({ ok: true, ts: '1700000099.000', channel: params.get('channel') }));
}

beforeAll(() => {
  fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = url.replace('https://slack.com/api/', '');
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, params, auth: headers.Authorization ?? null });
    const handler = handlers.get(method);
    const body = handler ? handler(params) : { ok: false, error: `unmocked_${method}` };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});

afterAll(() => fetchSpy.mockRestore());

beforeEach(async () => {
  installDefaultHandlers();
  calls.length = 0;
  // Slack user lookups are cached for an hour; isolate tests from each other.
  await cache.delByPrefix('slack:user:');
});

// ---------- fixtures ----------

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

async function addMember(wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

async function fixture() {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER');
  memberEmail = member.user.email;
  return { owner, member, ws };
}

/** Runs the install redirect + OAuth callback and returns the stored integration. */
async function connect(owner: TestUser, ws: WorkspaceDto) {
  const install = await api().get(`/api/workspaces/${ws.id}/integrations/slack/install`).set('Cookie', owner.cookie);
  expect(install.status).toBe(302);
  const state = new URL(install.headers.location as string).searchParams.get('state');
  expect(state).toBeTruthy();

  const cb = await api().get(`/api/integrations/slack/callback?code=the-code&state=${state}`);
  expect(cb.status).toBe(302);
  expect(cb.headers.location).toBe(`${env.CLIENT_URL}/w/${ws.id}/settings?tab=integrations&slack=connected`);

  const integration = await Integration.findOne({ workspaceId: ws.id, provider: 'slack' }).select('+accessTokenEnc').lean();
  if (!integration) throw new Error('integration not stored');
  return integration;
}

async function sync(owner: TestUser, ws: WorkspaceDto, channels = [{ id: 'C1', name: 'general' }]) {
  const res = await api().post(`/api/workspaces/${ws.id}/integrations/slack/sync`).set('Cookie', owner.cookie).send({ channels });
  expect(res.status).toBe(200);
  return res.body.data as SlackIntegrationDto;
}

function signedEvent(body: unknown, opts: { ts?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const signature = opts.signature ?? slackSignature(env.SLACK_SIGNING_SECRET ?? '', ts, raw);
  return api()
    .post('/api/integrations/slack/events')
    .set('Content-Type', 'application/json')
    .set('X-Slack-Signature', signature)
    .set('X-Slack-Request-Timestamp', ts)
    .send(raw);
}

const messageEvent = (event: Record<string, unknown>) => ({ type: 'event_callback', team_id: TEAM.id, event: { type: 'message', channel: 'C1', ...event } });

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('waitFor timed out');
}

// ---------- tests ----------

describe('Slack integration', () => {
  it('is enabled for this test file', () => {
    expect(features.slackIntegration).toBe(true);
  });

  describe('client', () => {
    it('sends form-encoded requests with a bearer token and throws on ok:false', async () => {
      handlers.set('conversations.info', (params) => ({ ok: true, channel: { id: params.get('channel') } }));
      const res = await callSlack<{ ok: boolean; channel: { id: string } }>('conversations.info', 'tok', { channel: 'C1', blocks: [{ a: 1 }] });
      expect(res.channel.id).toBe('C1');
      const call = callsTo('conversations.info')[0];
      expect(call?.auth).toBe('Bearer tok');
      expect(call?.params.get('blocks')).toBe('[{"a":1}]');

      handlers.set('users.info', () => ({ ok: false, error: 'user_not_found' }));
      await expect(callSlack('users.info', 'tok', { user: 'U9' })).rejects.toMatchObject({
        name: 'SlackApiError',
        method: 'users.info',
        code: 'user_not_found',
      });
      await expect(callSlack('nope.method', null)).rejects.toBeInstanceOf(SlackApiError);
    });
  });

  describe('install & overview', () => {
    it('redirects to Slack with a one-time state and stores the encrypted token on callback', async () => {
      const { owner, member, ws } = await fixture();

      const before = await api().get(`/api/workspaces/${ws.id}/integrations`).set('Cookie', member.cookie);
      expect(before.status).toBe(200);
      expect(before.body.data).toEqual({ available: { slack: true }, slack: null });

      const install = await api().get(`/api/workspaces/${ws.id}/integrations/slack/install`).set('Cookie', owner.cookie);
      expect(install.status).toBe(302);
      const url = new URL(install.headers.location as string);
      expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
      expect(url.searchParams.get('client_id')).toBe('slack-client-id');
      expect(url.searchParams.get('redirect_uri')).toBe(`${env.API_URL}/api/integrations/slack/callback`);
      expect(url.searchParams.get('scope')).toContain('channels:history');
      const state = url.searchParams.get('state') ?? '';
      expect(state.length).toBeGreaterThan(20);

      const cb = await api().get(`/api/integrations/slack/callback?code=the-code&state=${state}`);
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toBe(`${env.CLIENT_URL}/w/${ws.id}/settings?tab=integrations&slack=connected`);

      const access = callsTo('oauth.v2.access')[0];
      expect(access?.params.get('code')).toBe('the-code');
      expect(access?.params.get('client_secret')).toBe('slack-client-secret');
      expect(access?.auth).toBeNull();

      const stored = await Integration.findOne({ workspaceId: ws.id }).select('+accessTokenEnc').lean();
      expect(stored).toMatchObject({ externalId: TEAM.id, externalName: TEAM.name, botUserId: 'UBOT', status: 'ACTIVE', externalIconUrl: 'https://img.example/88.png' });
      expect(stored?.accessTokenEnc).not.toContain(BOT_TOKEN);
      expect(decrypt(stored?.accessTokenEnc ?? '')).toBe(BOT_TOKEN);
      expect(String(stored?.installedBy)).toBe(owner.id);
      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'INTEGRATION_CONNECTED' })).toBe(1);

      // The state is single-use.
      const replay = await api().get(`/api/integrations/slack/callback?code=again&state=${state}`);
      expect(replay.status).toBe(302);
      expect(replay.headers.location).toBe(`${env.CLIENT_URL}/?slack=error`);

      const overview = await api().get(`/api/workspaces/${ws.id}/integrations`).set('Cookie', member.cookie);
      expect(overview.body.data.slack).toMatchObject({
        provider: 'slack',
        workspaceId: ws.id,
        teamId: TEAM.id,
        teamName: TEAM.name,
        installedBy: owner.id,
        notificationChannelId: null,
        syncedChannels: [],
        status: 'ACTIVE',
      });
      expect(overview.body.data.slack.accessTokenEnc).toBeUndefined();

      // Hidden from the public DTO: the token never leaves the server.
      const stranger = await createTestUser();
      expect((await api().get(`/api/workspaces/${ws.id}/integrations`).set('Cookie', stranger.cookie)).status).toBe(403);
    });

    it('redirects with slack=error when Slack rejects the code and requires integration:manage to install', async () => {
      const { owner, member, ws } = await fixture();
      expect((await api().get(`/api/workspaces/${ws.id}/integrations/slack/install`).set('Cookie', member.cookie)).status).toBe(403);

      handlers.set('oauth.v2.access', () => ({ ok: false, error: 'invalid_code' }));
      const install = await api().get(`/api/workspaces/${ws.id}/integrations/slack/install`).set('Cookie', owner.cookie);
      const state = new URL(install.headers.location as string).searchParams.get('state');
      const cb = await api().get(`/api/integrations/slack/callback?code=bad&state=${state}`);
      expect(cb.headers.location).toBe(`${env.CLIENT_URL}/w/${ws.id}/settings?tab=integrations&slack=error`);
      expect(await Integration.countDocuments({ workspaceId: ws.id })).toBe(0);

      const noState = await api().get('/api/integrations/slack/callback?code=x');
      expect(noState.headers.location).toBe(`${env.CLIENT_URL}/?slack=error`);
    });
  });

  describe('settings & channels', () => {
    it('updates notification settings and lists Slack channels with sync status', async () => {
      const { owner, ws } = await fixture();
      await connect(owner, ws);

      const patched = await api()
        .patch(`/api/workspaces/${ws.id}/integrations/slack`)
        .set('Cookie', owner.cookie)
        .send({ notificationChannelId: 'C9', notificationChannelName: 'nexus-alerts', notifyOn: ['TASK_ASSIGNED', 'MENTION'] });
      expect(patched.status).toBe(200);
      expect(patched.body.data).toMatchObject({ notificationChannelId: 'C9', notificationChannelName: 'nexus-alerts', notifyOn: ['TASK_ASSIGNED', 'MENTION'] });

      const invalid = await api().patch(`/api/workspaces/${ws.id}/integrations/slack`).set('Cookie', owner.cookie).send({ notifyOn: ['NOPE'] });
      expect(invalid.status).toBe(422);

      await sync(owner, ws);
      const list = await api().get(`/api/workspaces/${ws.id}/integrations/slack/channels`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([
        { id: 'C2', name: 'eng', isPrivate: true, memberCount: 3, alreadySynced: false },
        { id: 'C1', name: 'general', isPrivate: false, memberCount: 12, alreadySynced: true },
      ]);
      expect(callsTo('conversations.list')[0]?.auth).toBe(`Bearer ${BOT_TOKEN}`);

      const cleared = await api().patch(`/api/workspaces/${ws.id}/integrations/slack`).set('Cookie', owner.cookie).send({ notificationChannelId: null });
      expect(cleared.body.data).toMatchObject({ notificationChannelId: null, notificationChannelName: null });

      const fresh = await createWorkspace(owner, 'No Slack');
      expect((await api().get(`/api/workspaces/${fresh.id}/integrations/slack/channels`).set('Cookie', owner.cookie)).status).toBe(404);
    });
  });

  describe('sync & backfill', () => {
    it('joins the channel, creates a read-only mirrored channel and imports history with dedupe', async () => {
      const { owner, member, ws } = await fixture();
      await connect(owner, ws);
      handlers.set('conversations.history', () => ({
        ok: true,
        messages: [
          { type: 'message', ts: '1700000003.000100', user: 'U2', text: 'Reply with <https://nexus.dev|a link> &amp; more', thread_ts: '1700000001.000100' },
          { type: 'message', ts: '1700000002.600000', user: 'UBOT', text: 'bot echo' },
          { type: 'message', ts: '1700000002.500000', subtype: 'channel_join', user: 'U1', text: 'joined' },
          { type: 'message', ts: '1700000002.000000', user: 'U1', subtype: 'file_share', files: [{ name: 'spec.pdf' }] },
          { type: 'message', ts: '1700000001.000100', user: 'U1', text: 'First message' },
        ],
      }));

      const created: ChannelDto[] = [];
      const messages: MessageDto[] = [];
      const offs = [
        events.on('channel.created', ({ channel }) => {
          created.push(channel);
        }),
        events.on('message.created', ({ message }) => {
          messages.push(message);
        }),
      ];

      const dto = await sync(owner, ws);
      offs.forEach((off) => off());

      expect(callsTo('conversations.join')[0]?.params.get('channel')).toBe('C1');
      expect(dto.syncedChannels).toHaveLength(1);
      expect(dto.syncedChannels[0]).toMatchObject({ slackChannelId: 'C1', slackChannelName: 'general', messageCount: 2 });
      expect(dto.syncedChannels[0]?.lastSyncedAt).toBeTruthy();

      const channel = await Channel.findById(dto.syncedChannels[0]?.channelId).lean();
      expect(channel).toMatchObject({
        type: 'PUBLIC',
        name: 'general',
        slug: 'slack-general',
        source: 'slack',
        isReadOnly: true,
        isArchived: false,
        messageCount: 2,
        lastMessagePreview: 'Shared spec.pdf',
        slack: { teamId: TEAM.id, channelId: 'C1' },
      });
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ id: String(channel?._id), source: 'slack', isReadOnly: true, type: 'PUBLIC' });

      const imported = await Message.find({ channelId: channel?._id }).sort({ createdAt: 1 }).lean();
      expect(imported.map((m) => m.slackTs)).toEqual(['1700000001.000100', '1700000002.000000', '1700000003.000100']);
      expect(imported[0]).toMatchObject({ source: 'slack', body: 'First message', replyCount: 1, parentMessageId: null });
      expect(String(imported[0]?.authorId)).toBe(member.id);
      expect(imported[0]?.externalAuthor).toMatchObject({ name: 'Member M', slackUserId: 'U1', avatarUrl: 'https://img.example/u1.png' });
      expect(imported[0]?.createdAt.toISOString()).toBe(new Date(1700000001000).toISOString());
      expect(imported[1]?.body).toBe('Shared spec.pdf');
      expect(imported[2]).toMatchObject({ authorId: null, body: 'Reply with a link (https://nexus.dev) & more' });
      expect(String(imported[2]?.parentMessageId)).toBe(String(imported[0]?._id));
      expect(imported[2]?.externalAuthor?.name).toBe('Outside Olga');

      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({ source: 'slack', channelId: String(channel?._id), author: { id: member.id }, attachments: [] });
      expect(messages[2]?.author).toBeNull();
      expect(messages[2]?.externalAuthor).toEqual({ name: 'Outside Olga', avatarUrl: null });

      // users.info is cached: two distinct users → two lookups despite three messages.
      expect(callsTo('users.info')).toHaveLength(2);

      // Re-running the backfill asks Slack for newer messages only and imports nothing twice.
      const integration = await Integration.findOne({ workspaceId: ws.id }).lean();
      const again = await backfillChannel(String(integration?._id), 'C1');
      expect(again).toEqual({ imported: 0, lastTs: '1700000003.000100' });
      const history = callsTo('conversations.history');
      expect(history[history.length - 1]?.params.get('oldest')).toBe('1700000003.000100');
      expect(await Message.countDocuments({ channelId: channel?._id })).toBe(3);

      // Syncing the same channel again is a no-op; unsync archives the mirror.
      const dup = await sync(owner, ws);
      expect(dup.syncedChannels).toHaveLength(1);
      const unsync = await api().post(`/api/workspaces/${ws.id}/integrations/slack/unsync`).set('Cookie', owner.cookie).send({ slackChannelId: 'C1' });
      expect(unsync.status).toBe(200);
      expect(unsync.body.data.syncedChannels).toEqual([]);
      expect((await Channel.findById(channel?._id).lean())?.isArchived).toBe(true);
      expect((await api().post(`/api/workspaces/${ws.id}/integrations/slack/unsync`).set('Cookie', owner.cookie).send({ slackChannelId: 'C1' })).status).toBe(404);
    });

    it('tolerates private channels the bot cannot join and surfaces other join failures', async () => {
      const { owner, ws } = await fixture();
      await connect(owner, ws);
      handlers.set('conversations.join', (params) => (params.get('channel') === 'C2' ? { ok: false, error: 'method_not_supported_for_channel_type' } : { ok: false, error: 'channel_not_found' }));

      const ok = await sync(owner, ws, [{ id: 'C2', name: 'eng' }]);
      expect(ok.syncedChannels.map((c) => c.slackChannelId)).toEqual(['C2']);

      const bad = await api().post(`/api/workspaces/${ws.id}/integrations/slack/sync`).set('Cookie', owner.cookie).send({ channels: [{ id: 'C5', name: 'ghost' }] });
      expect(bad.status).toBe(400);
      expect(bad.body.error.message).toContain('channel_not_found');
    });
  });

  describe('events endpoint', () => {
    it('rejects bad or stale signatures and answers url_verification', async () => {
      await fixture();
      const bad = await signedEvent({ type: 'url_verification', challenge: 'abc' }, { signature: 'v0=deadbeef' });
      expect(bad.status).toBe(401);

      const stale = await signedEvent({ type: 'url_verification', challenge: 'abc' }, { ts: String(Math.floor(Date.now() / 1000) - 10 * 60) });
      expect(stale.status).toBe(401);

      const unsigned = await api().post('/api/integrations/slack/events').send({ type: 'url_verification', challenge: 'abc' });
      expect(unsigned.status).toBe(401);

      const ok = await signedEvent({ type: 'url_verification', challenge: 'abc' });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ challenge: 'abc' });
    });

    it('imports, edits and deletes mirrored messages from message events', async () => {
      const { owner, member, ws } = await fixture();
      await connect(owner, ws);
      const dto = await sync(owner, ws);
      const channelId = dto.syncedChannels[0]?.channelId ?? '';

      const createdEvents: MessageDto[] = [];
      const updatedEvents: MessageDto[] = [];
      const deletedEvents: unknown[] = [];
      const offs = [
        events.on('message.created', ({ message, channel, actorId }) => {
          expect(channel.id).toBe(channelId);
          expect(actorId).toBeNull();
          createdEvents.push(message);
        }),
        events.on('message.updated', ({ message }) => {
          updatedEvents.push(message);
        }),
        events.on('message.deleted', (p) => {
          deletedEvents.push(p);
        }),
      ];

      const created = await signedEvent(messageEvent({ user: 'U1', text: 'Hello from <#C1|general>', ts: '1700000010.000000' }));
      expect(created.status).toBe(200);
      const stored = await Message.findOne({ channelId, slackTs: '1700000010.000000' }).lean();
      expect(stored).toMatchObject({ body: 'Hello from #general', source: 'slack' });
      expect(String(stored?.authorId)).toBe(member.id);
      expect(createdEvents).toHaveLength(1);
      expect(createdEvents[0]).toMatchObject({ id: String(stored?._id), body: 'Hello from #general', author: { id: member.id } });
      expect((await Channel.findById(channelId).lean())?.lastMessagePreview).toBe('Hello from #general');

      // Duplicate delivery (Slack retries) is ignored.
      await signedEvent(messageEvent({ user: 'U1', text: 'Hello from <#C1|general>', ts: '1700000010.000000' }));
      expect(await Message.countDocuments({ channelId })).toBe(1);
      expect(createdEvents).toHaveLength(1);

      const edited = await signedEvent(messageEvent({ subtype: 'message_changed', message: { ts: '1700000010.000000', user: 'U1', text: 'Edited text' } }));
      expect(edited.status).toBe(200);
      const afterEdit = await Message.findById(stored?._id).lean();
      expect(afterEdit?.body).toBe('Edited text');
      expect(afterEdit?.editedAt).toBeInstanceOf(Date);
      expect(updatedEvents).toHaveLength(1);
      expect(updatedEvents[0]?.body).toBe('Edited text');

      const deleted = await signedEvent(messageEvent({ subtype: 'message_deleted', deleted_ts: '1700000010.000000' }));
      expect(deleted.status).toBe(200);
      const afterDelete = await Message.findById(stored?._id).lean();
      expect(afterDelete?.deletedAt).toBeInstanceOf(Date);
      expect(afterDelete?.body).toBe('');
      expect(deletedEvents).toEqual([{ workspaceId: ws.id, channelId, messageId: String(stored?._id), parentMessageId: null }]);

      // Events for channels that are not synced, or from the bot itself, are ignored.
      await signedEvent(messageEvent({ channel: 'C2', user: 'U1', text: 'elsewhere', ts: '1700000011.000000' }));
      await signedEvent(messageEvent({ user: 'UBOT', text: 'echo', ts: '1700000012.000000' }));
      expect(await Message.countDocuments({ channelId })).toBe(1);
      expect(createdEvents).toHaveLength(1);

      offs.forEach((off) => off());
    });
  });

  describe('outbound notifications', () => {
    it('posts Block Kit messages for matching notification types and marks them slacked', async () => {
      const { owner, member, ws } = await fixture();
      await connect(owner, ws);
      await api()
        .patch(`/api/workspaces/${ws.id}/integrations/slack`)
        .set('Cookie', owner.cookie)
        .send({ notificationChannelId: 'C9', notificationChannelName: 'alerts', notifyOn: ['TASK_ASSIGNED'] });

      const link = `/w/${ws.id}/projects/p1/board?task=t1`;
      const notification = await Notification.create({
        userId: member.id,
        workspaceId: ws.id,
        type: 'TASK_ASSIGNED',
        title: 'You were assigned WEB-1',
        body: 'Ship the thing',
        link,
      });
      const toDto = (n: typeof notification) => ({
        id: String(n._id),
        workspaceId: String(n.workspaceId),
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        actor: null,
        entity: null,
        readAt: null,
        createdAt: n.createdAt.toISOString(),
      });

      events.emit('notification.created', { notification: toDto(notification), userId: member.id });
      await waitFor(async () => Boolean((await Notification.findById(notification._id).lean())?.slackedAt));

      const post = callsTo('chat.postMessage');
      expect(post).toHaveLength(1);
      expect(post[0]?.auth).toBe(`Bearer ${BOT_TOKEN}`);
      expect(post[0]?.params.get('channel')).toBe('C9');
      expect(post[0]?.params.get('text')).toContain('You were assigned WEB-1');
      const blocks = JSON.parse(post[0]?.params.get('blocks') ?? '[]') as Array<Record<string, unknown>>;
      expect(blocks[0]).toMatchObject({ type: 'section', text: { type: 'mrkdwn', text: '*You were assigned WEB-1*\nShip the thing' } });
      expect(blocks[1]).toMatchObject({ type: 'actions' });
      expect((blocks[1]?.elements as Array<{ url: string }>)[0]?.url).toBe(`${env.CLIENT_URL}${link}`);

      // Already posted → no second post.
      expect(await notifySlack(String(notification._id))).toBe(false);
      expect(callsTo('chat.postMessage')).toHaveLength(1);

      // Types outside notifyOn and link-less notifications are never posted.
      const mention = await Notification.create({ userId: member.id, workspaceId: ws.id, type: 'MENTION', title: 'Mentioned', link });
      const noLink = await Notification.create({ userId: member.id, workspaceId: ws.id, type: 'TASK_ASSIGNED', title: 'No link', link: null });
      expect(await notifySlack(String(mention._id))).toBe(false);
      expect(await notifySlack(String(noLink._id))).toBe(false);
      events.emit('notification.created', { notification: toDto(mention), userId: member.id });
      events.emit('notification.created', { notification: toDto(noLink), userId: member.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(callsTo('chat.postMessage')).toHaveLength(1);
    });
  });

  describe('disconnect', () => {
    it('revokes the token, deletes the integration and archives mirrored channels', async () => {
      const { owner, member, ws } = await fixture();
      await connect(owner, ws);
      const dto = await sync(owner, ws);

      expect((await api().delete(`/api/workspaces/${ws.id}/integrations/slack`).set('Cookie', member.cookie)).status).toBe(403);

      const res = await api().delete(`/api/workspaces/${ws.id}/integrations/slack`).set('Cookie', owner.cookie);
      expect(res.status).toBe(204);
      expect(callsTo('auth.revoke')[0]?.auth).toBe(`Bearer ${BOT_TOKEN}`);
      expect(await Integration.countDocuments({ workspaceId: ws.id })).toBe(0);
      expect((await Channel.findById(dto.syncedChannels[0]?.channelId).lean())?.isArchived).toBe(true);
      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'INTEGRATION_DISCONNECTED' })).toBe(1);

      const overview = await api().get(`/api/workspaces/${ws.id}/integrations`).set('Cookie', owner.cookie);
      expect(overview.body.data.slack).toBeNull();
      expect((await api().delete(`/api/workspaces/${ws.id}/integrations/slack`).set('Cookie', owner.cookie)).status).toBe(404);
    });
  });
});

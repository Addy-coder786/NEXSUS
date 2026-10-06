import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { SOCKET_PATH, rooms, type ChannelDto, type ProjectDto, type WorkspaceDto, type WorkspaceRole } from '@nexus/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { Channel } from '../src/models/Channel';
import { sentEmails } from '../src/services/email';
import { initSockets, type AppServer } from '../src/sockets';
import { api, app, createTestUser, type TestUser } from './helpers';

let server: http.Server;
let io: AppServer;
let url: string;
const clients: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  io = initSockets(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.disconnect());
});

afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

function client(token?: string): Socket {
  const socket = connect(url, {
    path: SOCKET_PATH,
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  clients.push(socket);
  return socket;
}

function once<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves true if `event` arrives within `ms`, false otherwise. */
function arrives<T = unknown>(socket: Socket, event: string, ms: number, filter: (p: T) => boolean = () => true): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (p: T) => {
      if (!filter(p)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(false);
    }, ms);
    socket.on(event, handler);
  });
}

async function connected(token: string): Promise<Socket> {
  const socket = client(token);
  await once(socket, 'connect');
  return socket;
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const roomSize = async (room: string) => (await io.in(room).fetchSockets()).length;

async function createWorkspace(owner: TestUser) {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'Acme' });
  expect(res.status).toBe(201);
  const ws = res.body.data as WorkspaceDto;
  await waitFor(async () => (await Channel.exists({ workspaceId: ws.id, slug: 'general' })) !== null);
  return ws;
}

async function join(owner: TestUser, wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  const inv = await api().post(`/api/workspaces/${wsId}/invitations`).set('Cookie', owner.cookie).send({ email: user.user.email, role });
  expect(inv.status).toBe(201);
  const token = [...sentEmails].reverse().find((m) => m.to === user.user.email)?.html.match(/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('No invitation token');
  expect((await api().post(`/api/invitations/${token}/accept`).set('Cookie', user.cookie)).status).toBe(200);
  return user;
}

async function fixture() {
  const owner = await createTestUser({ name: 'Olivia Owner' });
  const ws = await createWorkspace(owner);
  const member = await join(owner, ws.id, 'MEMBER');
  const res = await api().post(`/api/workspaces/${ws.id}/projects`).set('Cookie', owner.cookie).send({ name: 'Web', key: 'WEB', memberIds: [member.id] });
  const project = res.body.data as ProjectDto;
  const general = await Channel.findOne({ workspaceId: ws.id, slug: 'general' }).lean();
  if (!general) throw new Error('general missing');
  return { owner, member, ws, project, generalId: String(general._id) };
}

describe('Realtime', () => {
  it('rejects unauthenticated and invalid connections', async () => {
    const anon = client();
    const err = await once<Error>(anon, 'connect_error');
    expect(err.message).toBe('UNAUTHORIZED');

    const bogus = client('not-a-jwt');
    expect((await once<Error>(bogus, 'connect_error')).message).toBe('UNAUTHORIZED');
  });

  it('joins user and workspace rooms and sends a presence snapshot', async () => {
    const { owner, ws } = await fixture();
    const socket = client(owner.accessToken);
    const snapshot = once<{ workspaceId: string; online: string[] }>(socket, 'presence:snapshot');
    await once(socket, 'connect');
    const snap = await snapshot;
    expect(snap.workspaceId).toBe(ws.id);
    expect(snap.online).toContain(owner.id);
    expect(await roomSize(rooms.user(owner.id))).toBe(1);
    expect(await roomSize(rooms.workspace(ws.id))).toBe(1);
  });

  it('pushes task:created to clients that joined the project room', async () => {
    const { owner, member, project } = await fixture();
    const socket = await connected(member.accessToken);
    socket.emit('project:join', project.id);
    await waitFor(async () => (await roomSize(rooms.project(project.id))) === 1);

    const received = once<{ projectId: string; task: { title: string } }>(socket, 'task:created');
    const res = await api().post(`/api/projects/${project.id}/tasks`).set('Cookie', owner.cookie).send({ title: 'Realtime task' });
    expect(res.status).toBe(201);
    const payload = await received;
    expect(payload.projectId).toBe(project.id);
    expect(payload.task.title).toBe('Realtime task');
  });

  it('refuses channel:join on private channels the user is not in, so their messages never arrive', async () => {
    const { owner, member, ws, generalId } = await fixture();
    const created = await api().post(`/api/workspaces/${ws.id}/channels`).set('Cookie', owner.cookie).send({ name: 'Secret', type: 'PRIVATE' });
    const secret = created.body.data as ChannelDto;

    const socket = await connected(member.accessToken);
    socket.emit('channel:join', secret.id);
    socket.emit('channel:join', generalId);
    await waitFor(async () => (await roomSize(rooms.channel(generalId))) === 1);
    expect(await roomSize(rooms.channel(secret.id))).toBe(0);

    const leaked = arrives(socket, 'message:new', 400, (m: { channelId: string }) => m.channelId === secret.id);
    const unreadBadge = once<{ channelId: string; unreadCount: number }>(socket, 'channel:unread');
    expect((await api().post(`/api/channels/${secret.id}/messages`).set('Cookie', owner.cookie).send({ body: 'classified' })).status).toBe(201);
    expect(await leaked).toBe(false);

    // Public channel traffic does arrive, with a "refetch" unread hint to the workspace room.
    const visible = once<{ channelId: string; body: string }>(socket, 'message:new');
    expect((await api().post(`/api/channels/${generalId}/messages`).set('Cookie', owner.cookie).send({ body: 'hello all' })).status).toBe(201);
    expect(await visible).toMatchObject({ channelId: generalId, body: 'hello all' });
    expect(await unreadBadge).toEqual({ channelId: generalId, unreadCount: -1 });
  });

  it('relays typing indicators to other channel members and notifications to the user room', async () => {
    const { owner, member, ws, generalId } = await fixture();
    const a = await connected(owner.accessToken);
    const b = await connected(member.accessToken);
    a.emit('channel:join', generalId);
    b.emit('channel:join', generalId);
    await waitFor(async () => (await roomSize(rooms.channel(generalId))) === 2);

    const typing = once<{ channelId: string; userId: string; name: string; isTyping: boolean }>(b, 'typing');
    const selfEcho = arrives(a, 'typing', 300);
    a.emit('typing:start', generalId);
    expect(await typing).toEqual({ channelId: generalId, userId: owner.id, name: 'Olivia Owner', isTyping: true });
    expect(await selfEcho).toBe(false);

    const stopped = once<{ isTyping: boolean }>(b, 'typing');
    a.emit('typing:stop', generalId);
    expect((await stopped).isTyping).toBe(false);

    // DM → exact unread count to the recipient + notification:new
    const dm = await api().post(`/api/workspaces/${ws.id}/channels/dm`).set('Cookie', owner.cookie).send({ userId: member.id });
    const dmId: string = dm.body.data.id;
    const unread = once<{ channelId: string; unreadCount: number }>(b, 'channel:unread');
    const notification = once<{ type: string; link: string }>(b, 'notification:new');
    await api().post(`/api/channels/${dmId}/messages`).set('Cookie', owner.cookie).send({ body: 'ping' });
    expect(await unread).toEqual({ channelId: dmId, unreadCount: 1 });
    expect(await notification).toMatchObject({ type: 'NEW_MESSAGE', link: `/w/${ws.id}/chat/${dmId}` });
  });
});

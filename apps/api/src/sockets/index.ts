import type http from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Server, type Socket } from 'socket.io';
import {
  PRESENCE_TTL_SEC,
  SOCKET_PATH,
  TYPING_TTL_MS,
  rooms,
  type ClientToServerEvents,
  type PresenceStatus,
  type ServerToClientEvents,
} from '@nexus/shared';
import { cache } from '../config/redis';
import { env, features } from '../config/env';
import { logger } from '../config/logger';
import { hasProjectAccess, getMemberRole } from '../middleware/authorize';
import { Channel } from '../models/Channel';
import { Project } from '../models/Project';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { ACCESS_COOKIE } from '../utils/cookies';
import { verifyAccessToken } from '../utils/tokens';

interface SocketData {
  userId: string;
  name: string;
  workspaceIds: string[];
}

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: AppServer | null = null;
/** Connections per user on this instance; presence flips offline when it reaches zero. */
const connections = new Map<string, number>();

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function authenticateSocket(socket: AppSocket): Promise<SocketData> {
  const bearer = socket.handshake.auth?.token as string | undefined;
  const token = bearer ?? parseCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
  if (!token) throw new Error('UNAUTHORIZED');
  const payload = verifyAccessToken(token);
  const [user, alive] = await Promise.all([
    User.findById(payload.sub).select('name tokenVersion deletedAt').lean(),
    Session.exists({ _id: payload.sid, revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);
  if (!user || user.deletedAt || !alive || user.tokenVersion !== payload.tv) throw new Error('UNAUTHORIZED');
  const memberships = await WorkspaceMember.find({ userId: user._id }).select('workspaceId').lean();
  return { userId: String(user._id), name: user.name, workspaceIds: memberships.map((m) => String(m.workspaceId)) };
}

// ---------- presence ----------

const presenceKey = (userId: string) => `presence:${userId}`;
const onlineKey = (workspaceId: string) => `online:${workspaceId}`;

async function setPresence(data: SocketData, status: PresenceStatus): Promise<void> {
  const lastSeenAt = new Date().toISOString();
  if (status === 'offline') await cache.del(presenceKey(data.userId));
  else await cache.set(presenceKey(data.userId), { status, lastSeenAt }, PRESENCE_TTL_SEC);

  for (const wsId of data.workspaceIds) {
    const current = (await cache.get<string[]>(onlineKey(wsId))) ?? [];
    const next = status === 'offline' ? current.filter((id) => id !== data.userId) : Array.from(new Set([...current, data.userId]));
    await cache.set(onlineKey(wsId), next, 24 * 60 * 60);
    io?.to(rooms.workspace(wsId)).emit('presence:update', { userId: data.userId, status, lastSeenAt });
  }
}

export async function getOnlineUserIds(workspaceId: string): Promise<string[]> {
  return (await cache.get<string[]>(onlineKey(workspaceId))) ?? [];
}

export async function getPresence(userId: string): Promise<{ status: PresenceStatus; lastSeenAt: string } | null> {
  return cache.get(presenceKey(userId));
}

// ---------- server ----------

export function initSockets(httpServer: http.Server): AppServer {
  io = new Server(httpServer, {
    path: SOCKET_PATH,
    cors: { origin: env.CLIENT_URL, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  if (features.redis && env.REDIS_URL) {
    const pub = new Redis(env.REDIS_URL);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('Socket.IO Redis adapter enabled');
  }

  io.use(async (socket, next) => {
    try {
      socket.data = await authenticateSocket(socket);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', async (socket) => {
    const { userId, workspaceIds } = socket.data;
    await socket.join([rooms.user(userId), ...workspaceIds.map(rooms.workspace)]);

    connections.set(userId, (connections.get(userId) ?? 0) + 1);
    if (connections.get(userId) === 1) await setPresence(socket.data, 'online');
    for (const wsId of workspaceIds) {
      socket.emit('presence:snapshot', { workspaceId: wsId, online: await getOnlineUserIds(wsId) });
    }

    socket.on('project:join', async (projectId) => {
      const project = await Project.findById(projectId).select('workspaceId memberIds').lean();
      if (!project) return;
      const role = await getMemberRole(String(project.workspaceId), userId);
      if (role && hasProjectAccess(project, role, userId)) await socket.join(rooms.project(projectId));
    });
    socket.on('project:leave', (projectId) => void socket.leave(rooms.project(projectId)));

    socket.on('channel:join', async (channelId) => {
      if (await canAccessChannel(channelId, userId)) await socket.join(rooms.channel(channelId));
    });
    socket.on('channel:leave', (channelId) => void socket.leave(rooms.channel(channelId)));

    const typingTimers = new Map<string, NodeJS.Timeout>();
    const stopTyping = (channelId: string) => {
      clearTimeout(typingTimers.get(channelId));
      typingTimers.delete(channelId);
      socket.to(rooms.channel(channelId)).emit('typing', { channelId, userId, name: socket.data.name, isTyping: false });
    };
    socket.on('typing:start', (channelId) => {
      if (!socket.rooms.has(rooms.channel(channelId))) return;
      socket.to(rooms.channel(channelId)).emit('typing', { channelId, userId, name: socket.data.name, isTyping: true });
      clearTimeout(typingTimers.get(channelId));
      typingTimers.set(channelId, setTimeout(() => stopTyping(channelId), TYPING_TTL_MS));
    });
    socket.on('typing:stop', (channelId) => stopTyping(channelId));

    socket.on('presence:ping', () => void setPresence(socket.data, 'online'));
    socket.on('presence:away', (away) => void setPresence(socket.data, away ? 'away' : 'online'));

    socket.on('disconnect', async () => {
      typingTimers.forEach((t) => clearTimeout(t));
      const left = (connections.get(userId) ?? 1) - 1;
      if (left <= 0) {
        connections.delete(userId);
        await setPresence(socket.data, 'offline');
      } else {
        connections.set(userId, left);
      }
    });
  });

  logger.info('Socket.IO initialised');
  return io;
}

/** PUBLIC channels: any workspace member. Others: listed participants. */
export async function canAccessChannel(channelId: string, userId: string): Promise<boolean> {
  const channel = await Channel.findById(channelId).select('workspaceId type memberIds').lean();
  if (!channel) return false;
  const role = await getMemberRole(String(channel.workspaceId), userId);
  if (!role) return false;
  if (channel.type === 'PUBLIC') return true;
  return channel.memberIds.some((m) => String(m) === userId);
}

/** Add a user's socket(s) to a workspace room after they join a workspace (so no reconnect is needed). */
export async function joinUserToWorkspace(userId: string, workspaceId: string): Promise<void> {
  const sockets = await io?.in(rooms.user(userId)).fetchSockets();
  for (const s of sockets ?? []) {
    await s.join(rooms.workspace(workspaceId));
    if (!s.data.workspaceIds.includes(workspaceId)) s.data.workspaceIds.push(workspaceId);
  }
}

export async function removeUserFromWorkspace(userId: string, workspaceId: string): Promise<void> {
  const sockets = await io?.in(rooms.user(userId)).fetchSockets();
  for (const s of sockets ?? []) {
    await s.leave(rooms.workspace(workspaceId));
    s.data.workspaceIds = s.data.workspaceIds.filter((id) => id !== workspaceId);
  }
}

// ---------- typed emit helpers (no-ops when sockets are not initialised, e.g. tests) ----------

type Ev = keyof ServerToClientEvents;
type Args<K extends Ev> = Parameters<ServerToClientEvents[K]>;

export const realtime = {
  toUser<K extends Ev>(userId: string, event: K, ...args: Args<K>) {
    io?.to(rooms.user(userId)).emit(event, ...args);
  },
  toUsers<K extends Ev>(userIds: string[], event: K, ...args: Args<K>) {
    if (userIds.length) io?.to(userIds.map(rooms.user)).emit(event, ...args);
  },
  toWorkspace<K extends Ev>(workspaceId: string, event: K, ...args: Args<K>) {
    io?.to(rooms.workspace(workspaceId)).emit(event, ...args);
  },
  toProject<K extends Ev>(projectId: string, event: K, ...args: Args<K>) {
    io?.to(rooms.project(projectId)).emit(event, ...args);
  },
  toChannel<K extends Ev>(channelId: string, event: K, ...args: Args<K>) {
    io?.to(rooms.channel(channelId)).emit(event, ...args);
  },
  get server() {
    return io;
  },
};

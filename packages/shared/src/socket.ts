import type { PresenceStatus, TaskStatus } from './constants';
import type { ActivityDto } from './schemas/activity';
import type { ChannelDto, MessageDto, ReactionDto } from './schemas/chat';
import type { NotificationDto } from './schemas/notification';
import type { ProjectDto } from './schemas/project';
import type { TaskDto } from './schemas/task';

/**
 * Socket.IO contract. REST performs every mutation; sockets only push the results.
 * Rooms: `user:{id}`, `workspace:{id}`, `project:{id}`, `channel:{id}`.
 * The server auto-joins a client to `user:{id}` and every `workspace:{id}` it belongs to.
 */

export interface ServerToClientEvents {
  'notification:new': (n: NotificationDto) => void;
  'notification:read': (p: { ids: string[]; all?: boolean }) => void;

  'task:created': (p: { projectId: string; task: TaskDto }) => void;
  'task:updated': (p: { projectId: string; task: TaskDto }) => void;
  'task:moved': (p: { projectId: string; taskId: string; status: TaskStatus; position: number; task: TaskDto }) => void;
  'task:deleted': (p: { projectId: string; taskId: string }) => void;
  'project:updated': (p: { project: ProjectDto }) => void;
  'project:deleted': (p: { workspaceId: string; projectId: string }) => void;
  'activity:new': (a: ActivityDto) => void;

  'channel:created': (c: ChannelDto) => void;
  'channel:updated': (c: ChannelDto) => void;
  'message:new': (m: MessageDto) => void;
  'message:updated': (m: MessageDto) => void;
  'message:deleted': (p: { channelId: string; messageId: string; parentMessageId: string | null }) => void;
  'message:reaction': (p: { channelId: string; messageId: string; reactions: ReactionDto[] }) => void;
  'channel:unread': (p: { channelId: string; unreadCount: number }) => void;
  'typing': (p: { channelId: string; userId: string; name: string; isTyping: boolean }) => void;

  'presence:update': (p: { userId: string; status: PresenceStatus; lastSeenAt: string }) => void;
  'presence:snapshot': (p: { workspaceId: string; online: string[] }) => void;

  'document:updated': (p: { documentId: string; version: number; updatedBy: string; title: string }) => void;
  'file:uploaded': (p: { workspaceId: string; projectId: string | null; taskId: string | null; fileId: string }) => void;
}

export interface ClientToServerEvents {
  'project:join': (projectId: string) => void;
  'project:leave': (projectId: string) => void;
  'channel:join': (channelId: string) => void;
  'channel:leave': (channelId: string) => void;
  'typing:start': (channelId: string) => void;
  'typing:stop': (channelId: string) => void;
  'presence:ping': () => void;
  'presence:away': (away: boolean) => void;
}

export const SOCKET_PATH = '/socket.io';

export const rooms = {
  user: (id: string) => `user:${id}` as const,
  workspace: (id: string) => `workspace:${id}` as const,
  project: (id: string) => `project:${id}` as const,
  channel: (id: string) => `channel:${id}` as const,
};

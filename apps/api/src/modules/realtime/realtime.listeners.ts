import type { ChannelDto } from '@nexus/shared';
import { logger } from '../../config/logger';
import { events, type DomainEvents } from '../../events';
import { Channel } from '../../models/Channel';
import { joinUserToWorkspace, realtime, removeUserFromWorkspace } from '../../sockets';
import { reloadChannel, unreadCountFor } from '../chat/channel.service';

/**
 * Socket fan-out. REST mutates, services emit domain events, this file pushes. Payloads are the
 * DTOs the service already built; nothing here touches the database except to resolve channel
 * participants and per-user unread counts.
 */

function on<K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => void | Promise<void>): void {
  events.on(event, async (payload) => {
    try {
      await handler(payload);
    } catch (err) {
      logger.error({ err, event }, 'Realtime listener failed');
    }
  });
}

// ---------- tasks & projects ----------

on('task.created', ({ task }) => realtime.toProject(task.projectId, 'task:created', { projectId: task.projectId, task }));
on('task.updated', ({ task }) => realtime.toProject(task.projectId, 'task:updated', { projectId: task.projectId, task }));
on('task.moved', ({ task }) =>
  realtime.toProject(task.projectId, 'task:moved', {
    projectId: task.projectId,
    taskId: task.id,
    status: task.status,
    position: task.position,
    task,
  }),
);
on('task.deleted', ({ projectId, taskId }) => realtime.toProject(projectId, 'task:deleted', { projectId, taskId }));

on('project.created', ({ project }) => realtime.toWorkspace(project.workspaceId, 'project:updated', { project }));
on('project.updated', ({ project }) => realtime.toWorkspace(project.workspaceId, 'project:updated', { project }));
on('project.deleted', ({ workspaceId, projectId }) =>
  realtime.toWorkspace(workspaceId, 'project:deleted', { workspaceId, projectId }),
);

on('activity.recorded', ({ activity }) => {
  if (activity.projectId) realtime.toProject(activity.projectId, 'activity:new', activity);
  else realtime.toWorkspace(activity.workspaceId, 'activity:new', activity);
});

// ---------- chat ----------

/**
 * PUBLIC channels go to the workspace room; PRIVATE/DM/GROUP to each participant's user room.
 * The DTO was built from the actor's perspective, so `isMember`/`unreadCount` are theirs:
 * clients should merge the shared fields and keep (or refetch) their own read state.
 */
async function pushChannel(event: 'channel:created' | 'channel:updated', channel: ChannelDto): Promise<void> {
  if (channel.type === 'PUBLIC') {
    realtime.toWorkspace(channel.workspaceId, event, channel);
    return;
  }
  const raw = await Channel.findById(channel.id).select('memberIds').lean();
  realtime.toUsers((raw?.memberIds ?? []).map(String), event, channel);
}

on('channel.created', ({ channel }) => pushChannel('channel:created', channel));
on('channel.updated', ({ channel }) => pushChannel('channel:updated', channel));

on('message.created', async ({ message, channel, actorId }) => {
  realtime.toChannel(channel.id, 'message:new', message);

  // Unread badges. PUBLIC channels can have hundreds of members, so instead of computing a count
  // per member we push `unreadCount: -1` ("refetch") to the workspace room; clients increment
  // locally or call GET /workspaces/:id/unread. DM/GROUP/PRIVATE channels get exact per-user counts.
  if (channel.type === 'PUBLIC') {
    realtime.toWorkspace(channel.workspaceId, 'channel:unread', { channelId: channel.id, unreadCount: -1 });
    return;
  }
  const raw = await reloadChannel(channel.id);
  const others = raw.memberIds.map(String).filter((id) => id !== actorId);
  await Promise.all(
    others.map(async (userId) => {
      const unreadCount = await unreadCountFor(raw, userId);
      realtime.toUser(userId, 'channel:unread', { channelId: channel.id, unreadCount });
    }),
  );
});

// Edits and reaction toggles both arrive as `message:updated`; `reactions[].reacted` in a pushed
// DTO is always false — derive it from `reactions[].userIds` on the client.
on('message.updated', ({ message }) => realtime.toChannel(message.channelId, 'message:updated', message));
on('message.deleted', ({ channelId, messageId, parentMessageId }) =>
  realtime.toChannel(channelId, 'message:deleted', { channelId, messageId, parentMessageId }),
);

// ---------- notifications ----------

on('notification.created', ({ notification, userId }) => realtime.toUser(userId, 'notification:new', notification));

// ---------- documents & files ----------

on('document.updated', ({ document }) =>
  realtime.toWorkspace(document.workspaceId, 'document:updated', {
    documentId: document.id,
    version: document.version,
    updatedBy: document.updatedBy.id,
    title: document.title,
  }),
);

on('file.uploaded', ({ file }) => {
  const payload = { workspaceId: file.workspaceId, projectId: file.projectId, taskId: file.taskId, fileId: file.id };
  if (file.projectId) realtime.toProject(file.projectId, 'file:uploaded', payload);
  else realtime.toWorkspace(file.workspaceId, 'file:uploaded', payload);
});

// ---------- membership → rooms ----------

on('member.joined', ({ workspaceId, userId }) => joinUserToWorkspace(userId, workspaceId));
on('member.removed', ({ workspaceId, userId }) => removeUserFromWorkspace(userId, workspaceId));

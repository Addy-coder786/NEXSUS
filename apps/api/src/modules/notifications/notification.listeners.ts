import type { TaskDto } from '@nexus/shared';
import { logger } from '../../config/logger';
import { events, type DomainEvents } from '../../events';
import { Channel } from '../../models/Channel';
import { Task } from '../../models/Task';
import { Workspace } from '../../models/Workspace';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { isMuted } from '../chat/channel.service';
import { loadUser } from '../workspaces/user.lookup';
import { createNotification } from './notification.service';
// Registers the `notification.deliver` and `email.send` job handlers.
import './notification.jobs';

const EXCERPT = 160;

const excerpt = (text: string): string | null => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > EXCERPT ? `${clean.slice(0, EXCERPT - 1)}…` : clean;
};

const taskLink = (task: TaskDto) => `/w/${task.workspaceId}/projects/${task.projectId}/board?task=${task.id}`;
const taskEntity = (task: TaskDto) => ({ type: 'task' as const, id: task.id });

/** Wraps a listener so one failure is logged and never leaves another recipient unnotified. */
function on<K extends keyof DomainEvents>(event: K, handler: (payload: DomainEvents[K]) => Promise<void>): void {
  events.on(event, async (payload) => {
    try {
      await handler(payload);
    } catch (err) {
      logger.error({ err, event }, 'Notification listener failed');
    }
  });
}

async function notifyAssigned(task: TaskDto, actorId: string): Promise<void> {
  if (!task.assignee || task.assignee.id === actorId) return;
  const actor = await loadUser(actorId);
  await createNotification({
    userId: task.assignee.id,
    workspaceId: task.workspaceId,
    type: 'TASK_ASSIGNED',
    title: `${actor.name} assigned you ${task.key}`,
    body: task.title,
    link: taskLink(task),
    actorId,
    entity: taskEntity(task),
  });
}

async function notifyCompleted(task: TaskDto, actorId: string): Promise<void> {
  if (task.createdBy.id === actorId) return;
  const actor = await loadUser(actorId);
  await createNotification({
    userId: task.createdBy.id,
    workspaceId: task.workspaceId,
    type: 'TASK_COMPLETED',
    title: `${actor.name} completed ${task.key}`,
    body: task.title,
    link: taskLink(task),
    actorId,
    entity: taskEntity(task),
  });
}

// ---------- tasks ----------

on('task.created', ({ task, actorId }) => notifyAssigned(task, actorId));

on('task.updated', async ({ task, actorId, changes }) => {
  const assignee = changes.find((c) => c.field === 'assigneeId');
  if (assignee && typeof assignee.to === 'string') await notifyAssigned(task, actorId);
  const status = changes.find((c) => c.field === 'status');
  if (status && status.to === 'DONE') await notifyCompleted(task, actorId);
});

on('task.moved', async ({ task, actorId, from, to }) => {
  if (to === 'DONE' && from !== 'DONE') await notifyCompleted(task, actorId);
});

on('task.due_soon', async ({ task }) => {
  if (!task.assignee) return;
  await createNotification({
    userId: task.assignee.id,
    workspaceId: task.workspaceId,
    type: 'TASK_DUE_SOON',
    title: `${task.key} is due soon`,
    body: task.title,
    link: taskLink(task),
    entity: taskEntity(task),
  });
});

on('task.overdue', async ({ task }) => {
  if (!task.assignee) return;
  await createNotification({
    userId: task.assignee.id,
    workspaceId: task.workspaceId,
    type: 'TASK_OVERDUE',
    title: `${task.key} is overdue`,
    body: task.title,
    link: taskLink(task),
    entity: taskEntity(task),
  });
});

// ---------- comments ----------

on('comment.created', async ({ comment, task, actorId }) => {
  const actor = await loadUser(actorId);
  const mentioned = new Set(comment.mentions);
  const base = { workspaceId: task.workspaceId, link: taskLink(task), actorId, body: excerpt(comment.body) };

  await Promise.all(
    [...mentioned].map((userId) =>
      createNotification({
        ...base,
        userId,
        type: 'MENTION',
        title: `${actor.name} mentioned you in ${task.key}`,
        entity: { type: 'comment', id: comment.id },
      }),
    ),
  );

  const watchers = new Set<string>([task.createdBy.id]);
  if (task.assignee) watchers.add(task.assignee.id);
  await Promise.all(
    [...watchers]
      .filter((id) => id !== actorId && !mentioned.has(id))
      .map((userId) =>
        createNotification({
          ...base,
          userId,
          type: 'COMMENT_ADDED',
          title: `${actor.name} commented on ${task.key}`,
          entity: { type: 'comment', id: comment.id },
        }),
      ),
  );
});

// ---------- chat ----------

on('message.created', async ({ message, channel, actorId }) => {
  const actorName = message.author?.name ?? message.externalAuthor?.name ?? 'Someone';
  const mentioned = new Set(message.mentions);
  const base = {
    workspaceId: channel.workspaceId,
    link: `/w/${channel.workspaceId}/chat/${channel.id}`,
    actorId,
    entity: { type: 'message' as const, id: message.id },
    body: excerpt(message.body) ?? (message.attachments.length ? 'Sent an attachment' : null),
  };
  const place = channel.type === 'DM' ? 'a direct message' : `#${channel.name}`;

  await Promise.all(
    [...mentioned].map((userId) =>
      createNotification({ ...base, userId, type: 'MENTION', title: `${actorName} mentioned you in ${place}` }),
    ),
  );

  if (channel.type !== 'DM' && channel.type !== 'GROUP') return;
  const raw = await Channel.findById(channel.id).select('memberIds').lean();
  if (!raw) return;
  const recipients = raw.memberIds.map(String).filter((id) => id !== actorId && !mentioned.has(id));
  await Promise.all(
    recipients.map(async (userId) => {
      if (await isMuted(channel.id, userId)) return;
      await createNotification({
        ...base,
        userId,
        type: 'NEW_MESSAGE',
        title: channel.type === 'DM' ? `New message from ${actorName}` : `${actorName} in ${channel.name}`,
      });
    }),
  );
});

// ---------- workspace ----------

on('member.joined', async ({ workspaceId, userId, role }) => {
  const [admins, user, workspace] = await Promise.all([
    WorkspaceMember.find({ workspaceId, role: { $in: ['OWNER', 'ADMIN'] } }).select('userId').lean(),
    loadUser(userId),
    Workspace.findById(workspaceId).select('name').lean(),
  ]);
  await Promise.all(
    admins
      .map((m) => String(m.userId))
      .filter((id) => id !== userId)
      .map((adminId) =>
        createNotification({
          userId: adminId,
          workspaceId,
          type: 'MEMBER_JOINED',
          title: `${user.name} joined ${workspace?.name ?? 'the workspace'}`,
          body: `Joined as ${role}`,
          link: `/w/${workspaceId}/members`,
          actorId: userId,
          entity: { type: 'workspace', id: workspaceId },
        }),
      ),
  );
});

// ---------- files ----------

on('file.uploaded', async ({ file, actorId }) => {
  if (!file.taskId) return;
  const task = await Task.findById(file.taskId).select('assigneeId key projectId workspaceId').lean();
  if (!task?.assigneeId || String(task.assigneeId) === actorId) return;
  const actor = await loadUser(actorId);
  await createNotification({
    userId: String(task.assigneeId),
    workspaceId: file.workspaceId,
    type: 'FILE_UPLOADED',
    title: `${actor.name} attached a file to ${task.key}`,
    body: file.name,
    link: `/w/${file.workspaceId}/projects/${String(task.projectId)}/board?task=${file.taskId}`,
    actorId,
    entity: { type: 'file', id: file.id },
  });
});

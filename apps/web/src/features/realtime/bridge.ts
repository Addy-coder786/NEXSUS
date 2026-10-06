import type { QueryClient } from '@tanstack/react-query';
import type { ActivityDto, NotificationDto, ProjectDto, ServerToClientEvents, TaskDto } from '@nexus/shared';
import type { Paged } from '@/lib/api';
import type { AppSocket } from '@/lib/socket';
import { taskKeys } from '@/features/tasks/hooks';
import { projectKeys } from '@/features/projects/keys';
import { workspaceKeys } from '@/features/workspaces/hooks';
import { activityKeys } from '@/features/activity/hooks';
import { chatKeys } from '@/features/chat/keys';
import {
  bumpChannelPreview,
  incrementChannelUnread,
  patchMessage,
  patchMessageAnywhere,
  setChannelUnread,
  upsertChannel,
  upsertMessage,
  withMyReactions,
} from '@/features/chat/cache';
import { notificationKeys } from '@/features/notifications/keys';
import { adjustUnreadCount, clearUnreadCount, patchNotifications, prependNotification } from '@/features/notifications/cache';
import { usePresenceStore } from './presence.store';
import { isChannelActive } from './activeChannels';

export interface BridgeOptions {
  queryClient: QueryClient;
  /** Current user's id, used to make `reacted` flags and unread counts relative to the viewer. */
  getCurrentUserId: () => string | null;
  /** Called for every incoming notification (the provider shows a toast). */
  onNotification?: (n: NotificationDto) => void;
}

type SocketLike = Pick<AppSocket, 'on' | 'off'>;

/** Patch (or append) a task in every cached list for its project. */
function upsertTaskInLists(queryClient: QueryClient, task: TaskDto, mode: 'patch' | 'append'): void {
  queryClient.setQueriesData<Paged<TaskDto>>({ queryKey: taskKeys.lists(task.projectId) }, (old) => {
    if (!old) return old;
    const exists = old.items.some((t) => t.id === task.id);
    if (exists) return { ...old, items: old.items.map((t) => (t.id === task.id ? { ...t, ...task } : t)) };
    if (mode === 'append') return { ...old, items: [...old.items, task], meta: { ...old.meta, total: old.meta.total + 1 } };
    return old;
  });
}

function removeTaskFromLists(queryClient: QueryClient, projectId: string, taskId: string): void {
  queryClient.setQueriesData<Paged<TaskDto>>({ queryKey: taskKeys.lists(projectId) }, (old) => {
    if (!old) return old;
    const items = old.items.filter((t) => t.id !== taskId);
    if (items.length === old.items.length) return old;
    return { ...old, items, meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } };
  });
}

function touchTaskRelated(queryClient: QueryClient, task: Pick<TaskDto, 'projectId' | 'parentTaskId'>): void {
  void queryClient.invalidateQueries({ queryKey: projectKeys.detail(task.projectId) });
  if (task.parentTaskId) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.subtasks(task.parentTaskId) });
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.parentTaskId) });
  }
}

/** Prepend an activity to first-page feeds whose filters it matches. `base` is the key prefix for the feed. */
function prependActivity(queryClient: QueryClient, base: readonly unknown[], activity: ActivityDto): void {
  for (const [key] of queryClient.getQueriesData<Paged<ActivityDto>>({ queryKey: base })) {
    const query = key[key.length - 1];
    const filters = query && typeof query === 'object' ? (query as { page?: number; type?: string }) : {};
    if ((filters.page ?? 1) !== 1) continue;
    if (filters.type && filters.type !== activity.type) continue;
    queryClient.setQueryData<Paged<ActivityDto>>(key, (old) => {
      if (!old || old.items.some((a) => a.id === activity.id)) return old;
      const items = [activity, ...old.items].slice(0, Math.max(old.meta.limit, old.items.length + 1));
      return { items, meta: { ...old.meta, total: old.meta.total + 1 } };
    });
  }
}

/**
 * Subscribes once to every server event and mirrors it into the TanStack Query cache.
 * Returns a function that removes every listener.
 */
export function attachRealtimeBridge(socket: SocketLike, options: BridgeOptions): () => void {
  const { queryClient, getCurrentUserId, onNotification } = options;
  const offs: Array<() => void> = [];
  const on = <E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) => {
    socket.on(event, handler as never);
    offs.push(() => socket.off(event, handler as never));
  };

  // --- Tasks -------------------------------------------------------------
  on('task:created', ({ task }) => {
    queryClient.setQueryData(taskKeys.detail(task.id), task);
    upsertTaskInLists(queryClient, task, 'append');
    touchTaskRelated(queryClient, task);
  });
  on('task:updated', ({ task }) => {
    queryClient.setQueryData<TaskDto>(taskKeys.detail(task.id), (old) => (old ? { ...old, ...task } : task));
    upsertTaskInLists(queryClient, task, 'patch');
    touchTaskRelated(queryClient, task);
  });
  on('task:moved', ({ task }) => {
    queryClient.setQueryData<TaskDto>(taskKeys.detail(task.id), (old) => (old ? { ...old, ...task } : task));
    upsertTaskInLists(queryClient, task, 'patch');
    void queryClient.invalidateQueries({ queryKey: projectKeys.detail(task.projectId) });
  });
  on('task:deleted', ({ projectId, taskId }) => {
    removeTaskFromLists(queryClient, projectId, taskId);
    queryClient.removeQueries({ queryKey: taskKeys.detail(taskId) });
    queryClient.removeQueries({ queryKey: taskKeys.subtasks(taskId) });
    void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
  });

  // --- Projects ----------------------------------------------------------
  on('project:updated', ({ project }) => {
    queryClient.setQueryData(projectKeys.detail(project.id), project);
    queryClient.setQueryData<ProjectDto[]>(workspaceKeys.projects(project.workspaceId), (old) => {
      if (!old) return old;
      return old.some((p) => p.id === project.id) ? old.map((p) => (p.id === project.id ? project : p)) : [...old, project];
    });
  });
  on('project:deleted', ({ workspaceId, projectId }) => {
    queryClient.setQueryData<ProjectDto[]>(workspaceKeys.projects(workspaceId), (old) =>
      old ? old.filter((p) => p.id !== projectId) : old,
    );
    queryClient.removeQueries({ queryKey: projectKeys.detail(projectId) });
    queryClient.removeQueries({ queryKey: taskKeys.lists(projectId) });
  });

  // --- Activity ----------------------------------------------------------
  on('activity:new', (activity) => {
    prependActivity(queryClient, [...workspaceKeys.all, 'activities', activity.workspaceId], activity);
    if (activity.projectId) prependActivity(queryClient, [...projectKeys.all, 'activities', activity.projectId], activity);
    if (activity.actor.id === getCurrentUserId()) void queryClient.invalidateQueries({ queryKey: activityKeys.all });
  });

  // --- Notifications -----------------------------------------------------
  on('notification:new', (n) => {
    prependNotification(queryClient, n);
    adjustUnreadCount(queryClient, n.workspaceId, 1);
    onNotification?.(n);
  });
  on('notification:read', ({ ids, all }) => {
    const readAt = new Date().toISOString();
    if (all) {
      patchNotifications(queryClient, (n) => !n.readAt, { readAt });
      clearUnreadCount(queryClient);
    } else if (ids.length > 0) {
      const set = new Set(ids);
      patchNotifications(queryClient, (n) => set.has(n.id) && !n.readAt, { readAt });
    }
    void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
  });

  // --- Chat --------------------------------------------------------------
  // Pushed channel payloads are from the actor's perspective; DM/GROUP names and membership are
  // caller-relative, so unknown ones are refetched instead of inserted.
  on('channel:created', (channel) => {
    const known = upsertChannel(queryClient, channel);
    if (!known && (channel.type === 'DM' || channel.type === 'GROUP')) {
      void queryClient.invalidateQueries({ queryKey: chatKeys.channels(channel.workspaceId) });
    }
  });
  on('channel:updated', (channel) => {
    const known = upsertChannel(queryClient, channel);
    if (!known) void queryClient.invalidateQueries({ queryKey: chatKeys.channels(channel.workspaceId) });
  });
  // PUBLIC channels get `unreadCount: -1` on the workspace room ("increment locally"); DM/GROUP/PRIVATE
  // get exact counts. Either way, a channel the user is looking at is not unread.
  on('channel:unread', ({ channelId, unreadCount }) => {
    if (isChannelActive(channelId)) return;
    if (unreadCount < 0) incrementChannelUnread(queryClient, channelId, 1);
    else setChannelUnread(queryClient, channelId, unreadCount);
  });

  on('message:new', (raw) => {
    const myId = getCurrentUserId();
    const message = { ...raw, reactions: withMyReactions(raw.reactions, myId) };
    const result = upsertMessage(queryClient, message);
    if (message.parentMessageId && (result === 'inserted' || result === 'replaced-pending')) {
      patchMessage(
        queryClient,
        { channelId: message.channelId, messageId: message.parentMessageId },
        (parent) => ({ ...parent, replyCount: parent.replyCount + 1, lastReplyAt: message.createdAt }),
      );
    }
    if (result === 'missing' && !message.parentMessageId) {
      // Nothing cached for this channel yet; a later open fetches fresh data.
      void queryClient.invalidateQueries({ queryKey: chatKeys.messages(message.channelId), refetchType: 'none' });
    }
    bumpChannelPreview(queryClient, message);
  });
  on('message:updated', (raw) => {
    const myId = getCurrentUserId();
    upsertMessage(queryClient, { ...raw, reactions: withMyReactions(raw.reactions, myId) });
  });
  on('message:deleted', ({ channelId, messageId, parentMessageId }) => {
    patchMessage(
      queryClient,
      { channelId, messageId, parentMessageId },
      { deletedAt: new Date().toISOString(), body: '', attachments: [] },
    );
  });
  on('message:reaction', ({ channelId, messageId, reactions }) => {
    const myId = getCurrentUserId();
    patchMessageAnywhere(queryClient, { channelId, messageId }, { reactions: withMyReactions(reactions, myId) });
  });

  // --- Presence ----------------------------------------------------------
  on('presence:snapshot', ({ workspaceId, online }) => usePresenceStore.getState().setSnapshot(workspaceId, online));
  on('presence:update', (p) => usePresenceStore.getState().update(p));

  // --- Documents & files (owned by another feature; we only invalidate their key prefixes) ----
  on('document:updated', ({ documentId }) => {
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['document', documentId] });
  });
  on('file:uploaded', ({ taskId }) => {
    void queryClient.invalidateQueries({ queryKey: ['files'] });
    if (taskId) void queryClient.invalidateQueries({ queryKey: [...taskKeys.all, 'files', taskId] });
  });

  return () => {
    for (const off of offs) off();
  };
}

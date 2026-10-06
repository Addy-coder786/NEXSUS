import { describe, expect, it, vi } from 'vitest';
import type { ChannelDto, TaskDto, UnreadCountDto } from '@nexus/shared';
import { attachRealtimeBridge } from '../bridge';
import { markChannelActive, unmarkChannelActive } from '../activeChannels';
import { usePresenceStore } from '../presence.store';
import { FakeSocket } from './fakeSocket';
import { chatKeys } from '@/features/chat/keys';
import { taskKeys } from '@/features/tasks/hooks';
import { projectKeys } from '@/features/projects/keys';
import { notificationKeys } from '@/features/notifications/keys';
import type { NotificationsData } from '@/features/notifications/cache';
import { makeChannel, makeNotification } from '@/features/chat/__tests__/fixtures';
import type { Paged } from '@/lib/api';
import { createTestQueryClient, makeTask } from '@/test/utils';

function seedTaskList(queryClient: ReturnType<typeof createTestQueryClient>, tasks: TaskDto[]) {
  const projectId = tasks[0]?.projectId ?? 'p';
  queryClient.setQueryData<Paged<TaskDto>>(taskKeys.list(projectId, {}), {
    items: tasks,
    meta: { page: 1, limit: 50, total: tasks.length, totalPages: 1 },
  });
  return projectId;
}

describe('realtime bridge', () => {
  it('patches the task in cached lists and detail on task:updated', () => {
    const queryClient = createTestQueryClient();
    const socket = new FakeSocket();
    const a = makeTask({ title: 'Before', status: 'TODO' });
    const b = makeTask({ projectId: a.projectId });
    const projectId = seedTaskList(queryClient, [a, b]);
    queryClient.setQueryData(taskKeys.detail(a.id), a);

    attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => null });
    socket.serverEmit('task:updated', { projectId, task: { ...a, title: 'After', status: 'IN_PROGRESS' } });

    const list = queryClient.getQueryData<Paged<TaskDto>>(taskKeys.list(projectId, {}));
    expect(list?.items.map((t) => t.title)).toEqual(['After', b.title]);
    expect(list?.items[0]?.status).toBe('IN_PROGRESS');
    expect(queryClient.getQueryData<TaskDto>(taskKeys.detail(a.id))?.title).toBe('After');
  });

  it('appends on task:created and removes on task:deleted', () => {
    const queryClient = createTestQueryClient();
    const socket = new FakeSocket();
    const a = makeTask();
    const projectId = seedTaskList(queryClient, [a]);
    queryClient.setQueryData(projectKeys.detail(projectId), { id: projectId });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => null });
    const created = makeTask({ projectId });
    socket.serverEmit('task:created', { projectId, task: created });
    expect(queryClient.getQueryData<Paged<TaskDto>>(taskKeys.list(projectId, {}))?.items).toHaveLength(2);

    socket.serverEmit('task:deleted', { projectId, taskId: a.id });
    const list = queryClient.getQueryData<Paged<TaskDto>>(taskKeys.list(projectId, {}));
    expect(list?.items.map((t) => t.id)).toEqual([created.id]);
    expect(list?.meta.total).toBe(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: projectKeys.detail(projectId) }));
  });

  it('prepends the notification, bumps the unread count and calls onNotification', () => {
    const queryClient = createTestQueryClient();
    const socket = new FakeSocket();
    const existing = makeNotification({ readAt: new Date().toISOString() });
    queryClient.setQueryData<NotificationsData>(notificationKeys.list({ limit: 10 }), {
      pages: [{ items: [existing], meta: { page: 1, limit: 10, total: 1, totalPages: 1 } }],
      pageParams: [1],
    });
    queryClient.setQueryData<UnreadCountDto>(notificationKeys.unreadCount(), { total: 2, byWorkspace: { [existing.workspaceId]: 2 } });
    const onNotification = vi.fn();

    attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => 'me', onNotification });
    const incoming = makeNotification({ workspaceId: existing.workspaceId, title: 'You were mentioned' });
    socket.serverEmit('notification:new', incoming);

    const list = queryClient.getQueryData<NotificationsData>(notificationKeys.list({ limit: 10 }));
    expect(list?.pages[0]?.items.map((n) => n.id)).toEqual([incoming.id, existing.id]);
    expect(list?.pages[0]?.meta.total).toBe(2);
    const unread = queryClient.getQueryData<UnreadCountDto>(notificationKeys.unreadCount());
    expect(unread).toEqual({ total: 3, byWorkspace: { [existing.workspaceId]: 3 } });
    expect(onNotification).toHaveBeenCalledWith(incoming);
  });

  it('increments public-channel unread on -1 pushes, sets exact counts otherwise, and ignores the open channel', () => {
    const queryClient = createTestQueryClient();
    const socket = new FakeSocket();
    const pub = makeChannel({ type: 'PUBLIC', unreadCount: 2 });
    const dm = makeChannel({ type: 'DM', workspaceId: pub.workspaceId, unreadCount: 0 });
    const open = makeChannel({ type: 'PUBLIC', workspaceId: pub.workspaceId, unreadCount: 0 });
    queryClient.setQueryData(chatKeys.channels(pub.workspaceId), [pub, dm, open]);
    markChannelActive(open.id);

    attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => 'me' });
    socket.serverEmit('channel:unread', { channelId: pub.id, unreadCount: -1 });
    socket.serverEmit('channel:unread', { channelId: dm.id, unreadCount: 4 });
    socket.serverEmit('channel:unread', { channelId: open.id, unreadCount: -1 });
    unmarkChannelActive(open.id);

    const list = queryClient.getQueryData<ChannelDto[]>(chatKeys.channels(pub.workspaceId)) ?? [];
    const counts = Object.fromEntries(list.map((c) => [c.id, c.unreadCount]));
    expect(counts).toEqual({ [pub.id]: 3, [dm.id]: 4, [open.id]: 0 });
  });

  it('mirrors presence events into the store and detaches cleanly', () => {
    const queryClient = createTestQueryClient();
    const socket = new FakeSocket();
    usePresenceStore.getState().reset();
    const detach = attachRealtimeBridge(socket.asSocket(), { queryClient, getCurrentUserId: () => null });

    socket.serverEmit('presence:snapshot', { workspaceId: 'ws', online: ['u1', 'u2'] });
    socket.serverEmit('presence:update', { userId: 'u2', status: 'away', lastSeenAt: new Date().toISOString() });
    socket.serverEmit('presence:update', { userId: 'u1', status: 'offline', lastSeenAt: new Date().toISOString() });

    const state = usePresenceStore.getState();
    expect(state.status.u2).toBe('away');
    expect(state.online.has('u2')).toBe(true);
    expect(state.online.has('u1')).toBe(false);

    detach();
    expect(socket.listenerCount('task:updated')).toBe(0);
    expect(socket.listenerCount('presence:update')).toBe(0);
  });
});

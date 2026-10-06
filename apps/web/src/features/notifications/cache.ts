import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { NotificationDto, UnreadCountDto } from '@nexus/shared';
import type { Paged } from '@/lib/api';
import { notificationKeys, type NotificationFilters } from './keys';

export type NotificationsData = InfiniteData<Paged<NotificationDto>, number>;

function filtersOf(queryKey: readonly unknown[]): NotificationFilters {
  const last = queryKey[queryKey.length - 1];
  return last && typeof last === 'object' ? (last as NotificationFilters) : {};
}

function matchesFilters(n: NotificationDto, filters: NotificationFilters): boolean {
  if (filters.workspaceId && n.workspaceId !== filters.workspaceId) return false;
  if (filters.unread && n.readAt) return false;
  return true;
}

/** Prepend a freshly received notification to every list it belongs in. */
export function prependNotification(queryClient: QueryClient, n: NotificationDto): void {
  for (const [key] of queryClient.getQueriesData<NotificationsData>({ queryKey: notificationKeys.lists() })) {
    if (!matchesFilters(n, filtersOf(key))) continue;
    queryClient.setQueryData<NotificationsData>(key, (old) => {
      if (!old) return old;
      const [first, ...rest] = old.pages;
      if (!first) return old;
      if (old.pages.some((p) => p.items.some((i) => i.id === n.id))) return old;
      return {
        ...old,
        pages: [{ ...first, items: [n, ...first.items], meta: { ...first.meta, total: first.meta.total + 1 } }, ...rest],
      };
    });
  }
}

export function patchNotifications(
  queryClient: QueryClient,
  predicate: (n: NotificationDto) => boolean,
  patch: Partial<NotificationDto>,
): void {
  queryClient.setQueriesData<NotificationsData>({ queryKey: notificationKeys.lists() }, (old) =>
    old
      ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((n) => (predicate(n) ? { ...n, ...patch } : n)) })) }
      : old,
  );
}

export function removeNotificationFromCache(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<NotificationsData>({ queryKey: notificationKeys.lists() }, (old) =>
    old
      ? {
          ...old,
          pages: old.pages.map((p) => {
            const items = p.items.filter((n) => n.id !== id);
            const removed = p.items.length - items.length;
            return { ...p, items, meta: { ...p.meta, total: Math.max(0, p.meta.total - removed) } };
          }),
        }
      : old,
  );
}

export function adjustUnreadCount(queryClient: QueryClient, workspaceId: string, delta: number): void {
  queryClient.setQueryData<UnreadCountDto>(notificationKeys.unreadCount(), (old) => {
    const base: UnreadCountDto = old ?? { total: 0, byWorkspace: {} };
    const ws = Math.max(0, (base.byWorkspace[workspaceId] ?? 0) + delta);
    return {
      total: Math.max(0, base.total + delta),
      byWorkspace: { ...base.byWorkspace, [workspaceId]: ws },
    };
  });
}

export function clearUnreadCount(queryClient: QueryClient, workspaceId?: string): void {
  queryClient.setQueryData<UnreadCountDto>(notificationKeys.unreadCount(), (old) => {
    if (!old) return old;
    if (!workspaceId) return { total: 0, byWorkspace: {} };
    const ws = old.byWorkspace[workspaceId] ?? 0;
    const byWorkspace = { ...old.byWorkspace };
    delete byWorkspace[workspaceId];
    return { total: Math.max(0, old.total - ws), byWorkspace };
  });
}

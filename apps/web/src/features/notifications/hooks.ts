import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@nexus/shared';
import { toast } from 'sonner';
import { notificationsApi } from './api';
import { notificationKeys, type NotificationFilters } from './keys';
import {
  adjustUnreadCount,
  clearUnreadCount,
  patchNotifications,
  removeNotificationFromCache,
  type NotificationsData,
} from './cache';
import { getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

export function useNotifications(filters: NotificationFilters = {}) {
  const limit = filters.limit ?? 20;
  const authed = useAuthStore((s) => s.status === 'authed');
  return useInfiniteQuery({
    queryKey: notificationKeys.list({ ...filters, limit }),
    queryFn: ({ pageParam }) =>
      notificationsApi.list({ page: pageParam, limit, unread: filters.unread, workspaceId: filters.workspaceId }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
    enabled: authed,
  });
}

export function useUnreadCount() {
  const authed = useAuthStore((s) => s.status === 'authed');
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: () => notificationsApi.unreadCount(),
    enabled: authed,
    staleTime: 60_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (n: Pick<NotificationDto, 'id' | 'workspaceId' | 'readAt'>) => notificationsApi.markRead(n.id),
    onMutate: (n) => {
      if (n.readAt) return;
      const readAt = new Date().toISOString();
      patchNotifications(queryClient, (x) => x.id === n.id, { readAt });
      adjustUnreadCount(queryClient, n.workspaceId, -1);
    },
    onError: (error, n) => {
      if (!n.readAt) {
        patchNotifications(queryClient, (x) => x.id === n.id, { readAt: null });
        adjustUnreadCount(queryClient, n.workspaceId, 1);
      }
      toast.error(getErrorMessage(error));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId?: string) => notificationsApi.markAllRead(workspaceId),
    onSuccess: (_, workspaceId) => {
      const readAt = new Date().toISOString();
      patchNotifications(queryClient, (n) => !n.readAt && (!workspaceId || n.workspaceId === workspaceId), { readAt });
      clearUnreadCount(queryClient, workspaceId);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (n: Pick<NotificationDto, 'id' | 'workspaceId' | 'readAt'>) => notificationsApi.remove(n.id),
    onMutate: async (n) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.lists() });
      const snapshots = queryClient.getQueriesData<NotificationsData>({ queryKey: notificationKeys.lists() });
      removeNotificationFromCache(queryClient, n.id);
      if (!n.readAt) adjustUnreadCount(queryClient, n.workspaceId, -1);
      return { snapshots };
    },
    onError: (error, n, context) => {
      for (const [key, data] of context?.snapshots ?? []) queryClient.setQueryData(key, data);
      if (!n.readAt) adjustUnreadCount(queryClient, n.workspaceId, 1);
      toast.error(getErrorMessage(error));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount() }),
  });
}

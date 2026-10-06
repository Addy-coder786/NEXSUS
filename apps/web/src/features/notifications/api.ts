import type { NotificationDto, UnreadCountDto } from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

export const notificationsApi = {
  list: (query: { page?: number; limit?: number; unread?: boolean; workspaceId?: string }): Promise<Paged<NotificationDto>> =>
    api.getPaged<NotificationDto>('/notifications', cleanParams({ ...query, unread: query.unread ? 'true' : undefined })),
  unreadCount: () => api.get<UnreadCountDto>('/notifications/unread-count'),
  markRead: (id: string) => api.patch<NotificationDto>(`/notifications/${id}/read`),
  markAllRead: (workspaceId?: string) =>
    api.post<{ updated: number }>('/notifications/read-all', workspaceId ? { workspaceId } : {}),
  remove: (id: string) => api.delete(`/notifications/${id}`),
};

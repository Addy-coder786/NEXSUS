import { z } from 'zod';
import type { NotificationType } from '../constants';
import { paginationQuerySchema } from './common';
import type { UserPublicDto } from './user';

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unread: z.coerce.boolean().optional(),
  workspaceId: z.string().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export interface NotificationDto {
  id: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Client route to open, e.g. /w/:ws/projects/:p/board?task=:id */
  link: string | null;
  actor: UserPublicDto | null;
  entity: { type: 'task' | 'project' | 'comment' | 'message' | 'document' | 'file' | 'workspace'; id: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCountDto {
  total: number;
  byWorkspace: Record<string, number>;
}

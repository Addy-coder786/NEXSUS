import { z } from 'zod';
import { ACTIVITY_TYPES, type ActivityType } from '../constants';
import { paginationQuerySchema } from './common';
import type { UserPublicDto } from './user';

export const activityQuerySchema = paginationQuerySchema.extend({
  type: z.enum(ACTIVITY_TYPES).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export type ActivityTargetType = 'task' | 'project' | 'workspace' | 'comment' | 'member' | 'meeting';

export interface ActivityDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  type: ActivityType;
  actor: UserPublicDto;
  target: { type: ActivityTargetType; id: string; title: string } | null;
  /** Free-form details, e.g. { field: 'priority', from: 'MEDIUM', to: 'HIGH' } */
  metadata: Record<string, unknown>;
  createdAt: string;
}

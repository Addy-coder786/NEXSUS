import { z } from 'zod';
import { objectIdSchema } from './common';
import type { UserPublicDto } from './user';

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentions: z.array(objectIdSchema).max(20).optional(),
});
export const updateCommentSchema = createCommentSchema.pick({ body: true });

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;

export interface CommentDto {
  id: string;
  taskId: string;
  author: UserPublicDto;
  body: string;
  mentions: string[];
  editedAt: string | null;
  createdAt: string;
}

import { z } from 'zod';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../constants';
import { objectIdSchema, paginationQuerySchema } from './common';
import type { LabelDto } from './project';
import type { UserPublicDto } from './user';

export const checklistItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(1).max(200),
  done: z.boolean().default(false),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10000).optional(),
  status: z.enum(TASK_STATUSES).default('TODO'),
  priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
  assigneeId: objectIdSchema.nullable().optional(),
  labelIds: z.array(objectIdSchema).max(20).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  estimateHours: z.number().min(0).max(1000).nullable().optional(),
  parentTaskId: objectIdSchema.nullable().optional(),
  checklist: z.array(checklistItemSchema).max(50).optional(),
  dependsOn: z.array(objectIdSchema).max(20).optional(),
});

export const updateTaskSchema = createTaskSchema.partial().extend({
  description: z.string().trim().max(10000).nullable().optional(),
});

export const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  /** Fractional position within the target column. Omit to append to the end. */
  position: z.number().optional(),
});

export const taskListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeId: z.union([objectIdSchema, z.literal('me'), z.literal('unassigned')]).optional(),
  labelId: objectIdSchema.optional(),
  search: z.string().trim().max(100).optional(),
  parentTaskId: z.union([objectIdSchema, z.literal('none')]).optional(),
  dueBefore: z.coerce.date().optional(),
  overdue: z.coerce.boolean().optional(),
  sort: z.enum(['position', 'createdAt', 'dueDate', 'priority', 'updatedAt']).default('position'),
  order: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type ChecklistItem = z.infer<typeof checklistItemSchema> & { id: string };

export interface TaskDto {
  id: string;
  projectId: string;
  workspaceId: string;
  number: number;
  /** e.g. "WEB-42" */
  key: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  position: number;
  assignee: UserPublicDto | null;
  createdBy: UserPublicDto;
  labels: LabelDto[];
  dueDate: string | null;
  startDate: string | null;
  estimateHours: number | null;
  parentTaskId: string | null;
  subtaskCount: number;
  subtaskDoneCount: number;
  checklist: ChecklistItem[];
  dependsOn: string[];
  commentCount: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

import { z } from 'zod';
import {
  HEX_COLOR_REGEX,
  PROJECT_KEY_REGEX,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../constants';
import { objectIdSchema } from './common';
import type { UserPublicDto } from './user';

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PROJECT_KEY_REGEX, '2-10 uppercase letters or numbers, starting with a letter')
    .optional(),
  description: z.string().trim().max(2000).optional(),
  color: z.string().regex(HEX_COLOR_REGEX).optional(),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  memberIds: z.array(objectIdSchema).max(100).optional(),
});

export const updateProjectSchema = createProjectSchema
  .omit({ key: true, memberIds: true })
  .partial()
  .extend({
    status: z.enum(PROJECT_STATUSES).optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  });

export const addProjectMembersSchema = z.object({
  userIds: z.array(objectIdSchema).min(1).max(100),
});

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(30),
  color: z.string().regex(HEX_COLOR_REGEX),
});
export const updateLabelSchema = createLabelSchema.partial();

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddProjectMembersInput = z.infer<typeof addProjectMembersSchema>;
export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;

export interface LabelDto {
  id: string;
  name: string;
  color: string;
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  startDate: string | null;
  dueDate: string | null;
  createdBy: UserPublicDto;
  members: UserPublicDto[];
  labels: LabelDto[];
  /** Keyed by TaskStatus, e.g. { TODO: 4, DONE: 10 } */
  taskCounts: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

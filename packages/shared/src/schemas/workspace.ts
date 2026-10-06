import { z } from 'zod';
import {
  WORKSPACE_ROLES,
  WORKSPACE_SLUG_REGEX,
  type InvitationStatus,
  type WorkspaceRole,
} from '../constants';
import { emailSchema } from './auth';
import { objectIdSchema } from './common';
import type { UserPublicDto } from './user';

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(WORKSPACE_SLUG_REGEX, 'Lowercase letters, numbers and hyphens only')
    .optional(),
  description: z.string().trim().max(300).optional(),
});

export const updateWorkspaceSchema = createWorkspaceSchema.partial().extend({
  logoUrl: z.string().url().nullable().optional(),
});

const ASSIGNABLE_ROLES = WORKSPACE_ROLES.filter((r) => r !== 'OWNER') as [
  WorkspaceRole,
  ...WorkspaceRole[],
];
export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES);

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema.default('MEMBER'),
});
export const updateMemberRoleSchema = z.object({ role: assignableRoleSchema });
export const transferOwnershipSchema = z.object({ userId: objectIdSchema });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  ownerId: string;
  memberCount: number;
  myRole: WorkspaceRole;
  createdAt: string;
}

export interface WorkspaceMemberDto {
  id: string;
  user: UserPublicDto;
  role: WorkspaceRole;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: InvitationStatus;
  invitedBy: UserPublicDto;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreviewDto {
  workspace: { id: string; name: string; slug: string; logoUrl: string | null };
  email: string;
  role: WorkspaceRole;
  invitedBy: { name: string };
  expiresAt: string;
  status: InvitationStatus;
}

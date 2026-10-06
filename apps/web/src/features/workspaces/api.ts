import type {
  ActivityDto,
  ActivityQuery,
  CreateWorkspaceInput,
  InvitationDto,
  InvitationPreviewDto,
  InviteMemberInput,
  ProjectDto,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
  WorkspaceDto,
  WorkspaceMemberDto,
} from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

export const workspacesApi = {
  list: () => api.get<WorkspaceDto[]>('/workspaces'),
  get: (id: string) => api.get<WorkspaceDto>(`/workspaces/${id}`),
  create: (input: CreateWorkspaceInput) => api.post<WorkspaceDto>('/workspaces', input),
  update: (id: string, input: UpdateWorkspaceInput) => api.patch<WorkspaceDto>(`/workspaces/${id}`, input),
  remove: (id: string) => api.delete(`/workspaces/${id}`),
  transfer: (id: string, userId: string) => api.post<WorkspaceDto>(`/workspaces/${id}/transfer`, { userId }),

  members: (id: string, search?: string) =>
    api.get<WorkspaceMemberDto[]>(`/workspaces/${id}/members`, cleanParams({ search })),
  updateMemberRole: (id: string, userId: string, input: UpdateMemberRoleInput) =>
    api.patch<WorkspaceMemberDto>(`/workspaces/${id}/members/${userId}`, input),
  removeMember: (id: string, userId: string) => api.delete(`/workspaces/${id}/members/${userId}`),

  invitations: (id: string) => api.get<InvitationDto[]>(`/workspaces/${id}/invitations`),
  invite: (id: string, input: InviteMemberInput) => api.post<InvitationDto>(`/workspaces/${id}/invitations`, input),
  revokeInvitation: (id: string, invitationId: string) =>
    api.delete(`/workspaces/${id}/invitations/${invitationId}`),

  activities: (id: string, query?: Partial<ActivityQuery>): Promise<Paged<ActivityDto>> =>
    api.getPaged<ActivityDto>(`/workspaces/${id}/activities`, cleanParams({ ...query })),

  projects: (id: string) => api.get<ProjectDto[]>(`/workspaces/${id}/projects`),
};

export const invitationsApi = {
  preview: (token: string) => api.get<InvitationPreviewDto>(`/invitations/${token}`),
  accept: (token: string) => api.post<WorkspaceDto>(`/invitations/${token}/accept`),
};

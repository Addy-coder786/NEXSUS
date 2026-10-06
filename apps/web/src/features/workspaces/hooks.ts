import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type {
  ActivityQuery,
  CreateWorkspaceInput,
  InviteMemberInput,
  UpdateMemberRoleInput,
  UpdateWorkspaceInput,
  WorkspaceDto,
} from '@nexus/shared';
import { invitationsApi, workspacesApi } from './api';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { projectKeys } from '@/features/projects/keys';

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => [...workspaceKeys.all, 'list'] as const,
  detail: (id: string) => [...workspaceKeys.all, 'detail', id] as const,
  members: (id: string, search?: string) => [...workspaceKeys.all, 'members', id, search ?? ''] as const,
  invitations: (id: string) => [...workspaceKeys.all, 'invitations', id] as const,
  activities: (id: string, query?: Partial<ActivityQuery>) =>
    [...workspaceKeys.all, 'activities', id, query ?? {}] as const,
  projects: (id: string) => [...workspaceKeys.all, 'projects', id] as const,
  invitation: (token: string) => ['invitation', token] as const,
};

export function useWorkspaces() {
  return useQuery({ queryKey: workspaceKeys.list(), queryFn: () => workspacesApi.list() });
}

export function useWorkspace(id: string | null | undefined) {
  return useQuery({
    queryKey: workspaceKeys.detail(id ?? ''),
    queryFn: () => workspacesApi.get(id as string),
    enabled: Boolean(id),
  });
}

/** Resolves the workspace from the `:workspaceId` route param, falling back to the last-used one. */
export function useCurrentWorkspaceId(): string | null {
  const params = useParams<{ workspaceId?: string }>();
  const stored = useWorkspaceStore((s) => s.currentWorkspaceId);
  return params.workspaceId ?? stored;
}

export function useCurrentWorkspace() {
  return useWorkspace(useCurrentWorkspaceId());
}

function upsertWorkspaceInList(list: WorkspaceDto[] | undefined, ws: WorkspaceDto): WorkspaceDto[] {
  if (!list) return [ws];
  const idx = list.findIndex((w) => w.id === ws.id);
  if (idx === -1) return [...list, ws];
  return list.map((w) => (w.id === ws.id ? ws : w));
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) => workspacesApi.create(input),
    onSuccess: (ws) => {
      queryClient.setQueryData<WorkspaceDto[]>(workspaceKeys.list(), (old) => upsertWorkspaceInList(old, ws));
      queryClient.setQueryData(workspaceKeys.detail(ws.id), ws);
    },
  });
}

export function useUpdateWorkspace(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) => workspacesApi.update(id, input),
    onSuccess: (ws) => {
      queryClient.setQueryData(workspaceKeys.detail(ws.id), ws);
      queryClient.setQueryData<WorkspaceDto[]>(workspaceKeys.list(), (old) => upsertWorkspaceInList(old, ws));
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workspacesApi.remove(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<WorkspaceDto[]>(workspaceKeys.list(), (old) => old?.filter((w) => w.id !== id));
      queryClient.removeQueries({ queryKey: workspaceKeys.detail(id) });
    },
  });
}

export function useTransferOwnership(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspacesApi.transfer(id, userId),
    onSuccess: (ws) => {
      queryClient.setQueryData(workspaceKeys.detail(ws.id), ws);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
      void queryClient.invalidateQueries({ queryKey: [...workspaceKeys.all, 'members', id] });
    },
  });
}

export function useMembers(id: string | undefined, search?: string) {
  return useQuery({
    queryKey: workspaceKeys.members(id ?? '', search),
    queryFn: () => workspacesApi.members(id as string, search),
    enabled: Boolean(id),
    placeholderData: (prev) => prev,
  });
}

export function useUpdateRole(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...input }: UpdateMemberRoleInput & { userId: string }) =>
      workspacesApi.updateMemberRole(id, userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...workspaceKeys.all, 'members', id] }),
  });
}

export function useRemoveMember(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspacesApi.removeMember(id, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...workspaceKeys.all, 'members', id] });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(id) });
    },
  });
}

export function useInvitations(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.invitations(id ?? ''),
    queryFn: () => workspacesApi.invitations(id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useInvite(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) => workspacesApi.invite(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations(id) }),
  });
}

export function useRevokeInvitation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => workspacesApi.revokeInvitation(id, invitationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations(id) }),
  });
}

export function useWorkspaceActivities(id: string | undefined, query?: Partial<ActivityQuery>) {
  return useQuery({
    queryKey: workspaceKeys.activities(id ?? '', query),
    queryFn: () => workspacesApi.activities(id as string, query),
    enabled: Boolean(id),
    placeholderData: (prev) => prev,
  });
}

export function useWorkspaceProjects(id: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.projects(id ?? ''),
    queryFn: () => workspacesApi.projects(id as string),
    enabled: Boolean(id),
  });
}

export function useInvitationPreview(token: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.invitation(token ?? ''),
    queryFn: () => invitationsApi.preview(token as string),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => invitationsApi.accept(token),
    onSuccess: (ws) => {
      queryClient.setQueryData<WorkspaceDto[]>(workspaceKeys.list(), (old) => upsertWorkspaceInList(old, ws));
      queryClient.setQueryData(workspaceKeys.detail(ws.id), ws);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
}

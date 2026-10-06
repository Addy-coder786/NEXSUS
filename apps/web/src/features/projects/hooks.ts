import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityQuery, CreateLabelInput, LabelDto, ProjectDto, UpdateLabelInput } from '@nexus/shared';
import { projectsApi, type CreateProjectBody, type UpdateProjectBody } from './api';
import { projectKeys } from './keys';
import { workspaceKeys } from '@/features/workspaces/hooks';

export { projectKeys };

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ''),
    queryFn: () => projectsApi.get(id as string),
    enabled: Boolean(id),
  });
}

function syncProject(queryClient: ReturnType<typeof useQueryClient>, project: ProjectDto): void {
  queryClient.setQueryData(projectKeys.detail(project.id), project);
  queryClient.setQueryData<ProjectDto[]>(workspaceKeys.projects(project.workspaceId), (old) => {
    if (!old) return old;
    const exists = old.some((p) => p.id === project.id);
    return exists ? old.map((p) => (p.id === project.id ? project : p)) : [...old, project];
  });
}

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectBody) => projectsApi.create(workspaceId, input),
    onSuccess: (project) => {
      syncProject(queryClient, project);
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.projects(workspaceId) });
    },
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectBody) => projectsApi.update(id, input),
    onSuccess: (project) => syncProject(queryClient, project),
  });
}

export function useDeleteProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<ProjectDto[]>(workspaceKeys.projects(workspaceId), (old) =>
        old?.filter((p) => p.id !== id),
      );
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
    },
  });
}

export function useAddProjectMembers(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => projectsApi.addMembers(id, userIds),
    onSuccess: (project) => syncProject(queryClient, project),
  });
}

export function useRemoveProjectMember(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(id, userId),
    onSuccess: (project) => {
      if (project) syncProject(queryClient, project);
      else void queryClient.invalidateQueries({ queryKey: projectKeys.detail(id) });
    },
  });
}

export function useLabels(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.labels(projectId ?? ''),
    queryFn: () => projectsApi.labels(projectId as string),
    enabled: Boolean(projectId),
  });
}

function invalidateLabels(queryClient: ReturnType<typeof useQueryClient>, projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: projectKeys.labels(projectId) });
  void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
  void queryClient.invalidateQueries({ queryKey: ['tasks'] });
}

export function useCreateLabel(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLabelInput) => projectsApi.createLabel(projectId, input),
    onSuccess: (label) => {
      queryClient.setQueryData<LabelDto[]>(projectKeys.labels(projectId), (old) => [...(old ?? []), label]);
      invalidateLabels(queryClient, projectId);
    },
  });
}

export function useUpdateLabel(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ labelId, ...input }: UpdateLabelInput & { labelId: string }) =>
      projectsApi.updateLabel(projectId, labelId, input),
    onSuccess: () => invalidateLabels(queryClient, projectId),
  });
}

export function useDeleteLabel(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => projectsApi.removeLabel(projectId, labelId),
    onSuccess: () => invalidateLabels(queryClient, projectId),
  });
}

export function useProjectActivities(projectId: string | undefined, query?: Partial<ActivityQuery>) {
  return useQuery({
    queryKey: projectKeys.activities(projectId ?? '', query),
    queryFn: () => projectsApi.activities(projectId as string, query),
    enabled: Boolean(projectId),
    placeholderData: (prev) => prev,
  });
}

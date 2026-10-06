import type { ProjectAnalyticsDto, WorkspaceAnalyticsDto } from '@nexus/shared';
import { api } from '@/lib/api';

export const analyticsApi = {
  project: (projectId: string, weeks: number) =>
    api.get<ProjectAnalyticsDto>(`/projects/${projectId}/analytics`, { weeks }),
  workspace: (workspaceId: string, weeks: number) =>
    api.get<WorkspaceAnalyticsDto>(`/workspaces/${workspaceId}/analytics`, { weeks }),
};

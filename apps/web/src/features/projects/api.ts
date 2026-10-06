import type {
  ActivityDto,
  ActivityQuery,
  CreateLabelInput,
  CreateProjectInput,
  LabelDto,
  ProjectDto,
  UpdateLabelInput,
  UpdateProjectInput,
} from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

/** Wire format: dates travel as ISO strings (the API coerces them). */
export type CreateProjectBody = Omit<CreateProjectInput, 'startDate' | 'dueDate'> & {
  startDate?: string;
  dueDate?: string;
};
export type UpdateProjectBody = Omit<UpdateProjectInput, 'startDate' | 'dueDate'> & {
  startDate?: string | null;
  dueDate?: string | null;
};

export const projectsApi = {
  create: (workspaceId: string, input: CreateProjectBody) =>
    api.post<ProjectDto>(`/workspaces/${workspaceId}/projects`, input),
  get: (id: string) => api.get<ProjectDto>(`/projects/${id}`),
  update: (id: string, input: UpdateProjectBody) => api.patch<ProjectDto>(`/projects/${id}`, input),
  remove: (id: string) => api.delete(`/projects/${id}`),
  addMembers: (id: string, userIds: string[]) => api.post<ProjectDto>(`/projects/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => api.delete<ProjectDto>(`/projects/${id}/members/${userId}`),

  labels: (id: string) => api.get<LabelDto[]>(`/projects/${id}/labels`),
  createLabel: (id: string, input: CreateLabelInput) => api.post<LabelDto>(`/projects/${id}/labels`, input),
  updateLabel: (id: string, labelId: string, input: UpdateLabelInput) =>
    api.patch<LabelDto>(`/projects/${id}/labels/${labelId}`, input),
  removeLabel: (id: string, labelId: string) => api.delete(`/projects/${id}/labels/${labelId}`),

  activities: (id: string, query?: Partial<ActivityQuery>): Promise<Paged<ActivityDto>> =>
    api.getPaged<ActivityDto>(`/projects/${id}/activities`, cleanParams({ ...query })),
};

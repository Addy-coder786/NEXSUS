import type { CreateMeetingInput, MeetingDetailDto, MeetingDto, TaskDto } from '@nexus/shared';
import { api, cleanParams } from '@/lib/api';

export const meetingsApi = {
  list: (workspaceId: string, params: { projectId?: string; page?: number } = {}) =>
    api.getPaged<MeetingDto>(
      `/meetings/workspaces/${workspaceId}`,
      cleanParams({ limit: 50, ...params }),
    ),
  get: (id: string) => api.get<MeetingDetailDto>(`/meetings/${id}`),
  create: (workspaceId: string, input: CreateMeetingInput) =>
    api.post<MeetingDto>(`/meetings/workspaces/${workspaceId}`, input),
  analyze: (id: string) => api.post<MeetingDto>(`/meetings/${id}/analyze`),
  convert: (id: string, input: { actionItemIds: string[]; projectId: string }) =>
    api.post<TaskDto[]>(`/meetings/${id}/convert`, input),
  delete: (id: string) => api.delete(`/meetings/${id}`),
};

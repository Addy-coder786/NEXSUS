import type {
  AiConversationDetailDto,
  AiConversationDto,
  AiScope,
  AiStatusDto,
  CommitGeneratedTasksInput,
  CreateConversationInput,
  DocumentSummaryResultDto,
  GenerateTasksInput,
  GenerateTasksResultDto,
  ProjectInsightDto,
  TaskDto,
  WorkspaceDigestDto,
} from '@nexus/shared';
import { api, cleanParams } from '@/lib/api';

export interface ConversationFilters {
  scope?: AiScope;
  scopeId?: string;
}

export const aiApi = {
  status: () => api.get<AiStatusDto>('/ai/status'),

  conversations: (workspaceId: string, filters: ConversationFilters = {}) =>
    api.getPaged<AiConversationDto>(
      `/ai/workspaces/${workspaceId}/conversations`,
      cleanParams({ limit: 50, ...filters }),
    ),
  createConversation: (workspaceId: string, input: Partial<CreateConversationInput>) =>
    api.post<AiConversationDto>(`/ai/workspaces/${workspaceId}/conversations`, input),
  conversation: (id: string) => api.get<AiConversationDetailDto>(`/ai/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    api.patch<AiConversationDto>(`/ai/conversations/${id}`, { title }),
  deleteConversation: (id: string) => api.delete(`/ai/conversations/${id}`),

  generateTasks: (projectId: string, input: Partial<GenerateTasksInput>) =>
    // Generation runs at high effort and can take a while.
    api.post<GenerateTasksResultDto>(`/ai/projects/${projectId}/generate-tasks`, input, {
      timeout: 180_000,
    }),
  commitTasks: (projectId: string, input: CommitGeneratedTasksInput) =>
    api.post<TaskDto[]>(`/ai/projects/${projectId}/commit-tasks`, input),

  summarize: (documentId: string, length: 'short' | 'detailed') =>
    api.post<DocumentSummaryResultDto>(
      `/ai/documents/${documentId}/summarize`,
      { length },
      { timeout: 120_000 },
    ),
  insights: (projectId: string, refresh = false) =>
    api.get<ProjectInsightDto>(
      `/ai/projects/${projectId}/insights`,
      refresh ? { refresh: 'true' } : undefined,
    ),
  digest: (workspaceId: string, days = 7) =>
    api.get<WorkspaceDigestDto>(`/ai/workspaces/${workspaceId}/digest`, { days }),
  reindex: (workspaceId: string) =>
    api.post<{ queued: boolean }>(`/ai/workspaces/${workspaceId}/reindex`),
};

import type {
  CreateDocumentInput,
  DocumentDto,
  DocumentListQuery,
  DocumentSummaryDto,
  DocumentVersionDto,
  RichContent,
  UpdateDocumentInput,
  UserPublicDto,
} from '@nexus/shared';
import { api, cleanParams, type Paged } from '@/lib/api';

/** Filters the UI sends; everything else defaults server-side. */
export type DocumentFilters = Partial<Pick<DocumentListQuery, 'projectId' | 'archived' | 'search' | 'sort' | 'page' | 'limit'>>;

export interface DocumentVersionDetail {
  version: number;
  title: string;
  content: RichContent;
  savedBy: UserPublicDto;
  createdAt: string;
}

export const documentsApi = {
  list: (workspaceId: string, filters: DocumentFilters = {}): Promise<Paged<DocumentSummaryDto>> =>
    api.getPaged<DocumentSummaryDto>(`/workspaces/${workspaceId}/documents`, cleanParams({ ...filters })),
  create: (workspaceId: string, input: CreateDocumentInput) =>
    api.post<DocumentDto>(`/workspaces/${workspaceId}/documents`, input),
  get: (id: string) => api.get<DocumentDto>(`/documents/${id}`),
  update: (id: string, input: UpdateDocumentInput) => api.patch<DocumentDto>(`/documents/${id}`, input),
  remove: (id: string) => api.delete(`/documents/${id}`),
  duplicate: (id: string) => api.post<DocumentDto>(`/documents/${id}/duplicate`),
  versions: (id: string) => api.get<DocumentVersionDto[]>(`/documents/${id}/versions`),
  version: (id: string, version: number) => api.get<DocumentVersionDetail>(`/documents/${id}/versions/${version}`),
  restoreVersion: (id: string, version: number) =>
    api.post<DocumentDto>(`/documents/${id}/versions/${version}/restore`),
};

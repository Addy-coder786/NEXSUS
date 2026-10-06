import type { SearchResultsDto, SearchType } from '@nexus/shared';
import { api, cleanParams } from '@/lib/api';

export interface SearchParams {
  q: string;
  types?: readonly SearchType[];
  projectId?: string;
  limit?: number;
}

export const searchApi = {
  search: (workspaceId: string, { q, types, projectId, limit }: SearchParams) =>
    api.get<SearchResultsDto>(
      `/workspaces/${workspaceId}/search`,
      cleanParams({ q, types: types?.join(','), projectId, limit }),
    ),
};

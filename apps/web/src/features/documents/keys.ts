import type { DocumentFilters } from './api';

/** Prefix `['documents']` is invalidated by the realtime layer on `document:updated`. */
export const documentKeys = {
  all: ['documents'] as const,
  lists: (workspaceId: string) => [...documentKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, filters: DocumentFilters) => [...documentKeys.lists(workspaceId), filters] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
  versions: (id: string) => [...documentKeys.all, 'versions', id] as const,
  version: (id: string, version: number) => [...documentKeys.all, 'version', id, version] as const,
};

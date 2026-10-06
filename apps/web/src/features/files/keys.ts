import type { FileFilters } from './api';

export const fileKeys = {
  all: ['files'] as const,
  lists: (workspaceId: string) => [...fileKeys.all, 'list', workspaceId] as const,
  list: (workspaceId: string, filters: FileFilters) => [...fileKeys.lists(workspaceId), filters] as const,
  detail: (id: string) => [...fileKeys.all, 'detail', id] as const,
  task: (taskId: string) => [...fileKeys.all, 'task', taskId] as const,
  usage: (workspaceId: string) => [...fileKeys.all, 'usage', workspaceId] as const,
};

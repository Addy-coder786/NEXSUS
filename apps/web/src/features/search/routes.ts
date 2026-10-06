import type {
  DocumentSummaryDto,
  FileDto,
  MessageSearchHit,
  ProjectDto,
  SearchResultsDto,
  SearchType,
  TaskDto,
  UserPublicDto,
} from '@nexus/shared';

export type SearchItem =
  | { type: 'tasks'; item: TaskDto }
  | { type: 'projects'; item: ProjectDto }
  | { type: 'documents'; item: DocumentSummaryDto }
  | { type: 'messages'; item: MessageSearchHit }
  | { type: 'files'; item: FileDto }
  | { type: 'users'; item: UserPublicDto };

export const SEARCH_TYPE_LABELS: Record<SearchType, string> = {
  tasks: 'Tasks',
  projects: 'Projects',
  documents: 'Documents',
  messages: 'Messages',
  files: 'Files',
  users: 'People',
};

/** Route for a search hit. */
export function resultHref(workspaceId: string, hit: SearchItem): string {
  const base = `/w/${workspaceId}`;
  switch (hit.type) {
    case 'tasks':
      return `${base}/projects/${hit.item.projectId}/board?task=${hit.item.id}`;
    case 'projects':
      return `${base}/projects/${hit.item.id}/board`;
    case 'documents':
      return `${base}/docs/${hit.item.id}`;
    case 'messages':
      return `${base}/chat/${hit.item.channelId}`;
    case 'files':
      return `${base}/files?file=${hit.item.id}`;
    case 'users':
      return `${base}/members`;
  }
}

export function resultId(hit: SearchItem): string {
  return `${hit.type}:${hit.item.id}`;
}

/** Flattens a results DTO into grouped, ordered hits. */
export function groupResults(results: SearchResultsDto | undefined, order: readonly SearchType[]): { type: SearchType; items: SearchItem[] }[] {
  if (!results) return [];
  const groups: { type: SearchType; items: SearchItem[] }[] = [];
  for (const type of order) {
    let items: SearchItem[] = [];
    switch (type) {
      case 'tasks':
        items = results.tasks.map((item) => ({ type, item }));
        break;
      case 'projects':
        items = results.projects.map((item) => ({ type, item }));
        break;
      case 'documents':
        items = results.documents.map((item) => ({ type, item }));
        break;
      case 'messages':
        items = results.messages.map((item) => ({ type, item }));
        break;
      case 'files':
        items = results.files.map((item) => ({ type, item }));
        break;
      case 'users':
        items = results.users.map((item) => ({ type, item }));
        break;
    }
    if (items.length) groups.push({ type, items });
  }
  return groups;
}

import { z } from 'zod';
import { SEARCH_TYPES, type SearchType } from '../constants';
import type { DocumentSummaryDto } from './document';
import type { FileDto } from './file';
import type { ProjectDto } from './project';
import type { TaskDto } from './task';
import type { UserPublicDto } from './user';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? (v.split(',').filter((t) => (SEARCH_TYPES as readonly string[]).includes(t)) as SearchType[]) : [...SEARCH_TYPES])),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(25).default(5),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface MessageSearchHit {
  id: string;
  channelId: string;
  channelName: string;
  author: UserPublicDto | null;
  snippet: string;
  createdAt: string;
}

export interface SearchResultsDto {
  query: string;
  tasks: TaskDto[];
  projects: ProjectDto[];
  documents: DocumentSummaryDto[];
  messages: MessageSearchHit[];
  files: FileDto[];
  users: UserPublicDto[];
  counts: Record<SearchType, number>;
}

import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from './common';
import type { UserPublicDto } from './user';

/** Tiptap/ProseMirror JSON document. Validated structurally only; the editor owns the schema. */
export const richContentSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough();
export type RichContent = z.infer<typeof richContentSchema>;

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).default('Untitled'),
  projectId: objectIdSchema.nullable().optional(),
  content: richContentSchema.optional(),
  icon: z.string().max(8).nullable().optional(),
});
export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: richContentSchema.optional(),
  /** Plain-text projection of content for search; computed by the client editor. */
  contentText: z.string().max(200_000).optional(),
  icon: z.string().max(8).nullable().optional(),
  isArchived: z.boolean().optional(),
  /** Version the client last loaded. Server returns 409 if the document moved on. */
  baseVersion: z.number().int().min(0).optional(),
});
export const documentListQuerySchema = paginationQuerySchema.extend({
  projectId: z.union([objectIdSchema, z.literal('none')]).optional(),
  archived: z.coerce.boolean().optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['updatedAt', 'createdAt', 'title']).default('updatedAt'),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export interface DocumentSummaryDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  icon: string | null;
  excerpt: string;
  isArchived: boolean;
  version: number;
  createdBy: UserPublicDto;
  updatedBy: UserPublicDto;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentDto extends DocumentSummaryDto {
  content: RichContent;
}
export interface DocumentVersionDto {
  id: string;
  version: number;
  savedBy: UserPublicDto;
  title: string;
  createdAt: string;
}

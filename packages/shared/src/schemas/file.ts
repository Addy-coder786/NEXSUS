import { z } from 'zod';
import type { FileKind } from '../constants';
import { objectIdSchema, paginationQuerySchema } from './common';
import type { UserPublicDto } from './user';

/** Multipart form fields accompanying the `file` part. */
export const uploadFileFieldsSchema = z.object({
  projectId: objectIdSchema.optional(),
  taskId: objectIdSchema.optional(),
  channelId: objectIdSchema.optional(),
  documentId: objectIdSchema.optional(),
});
export const fileListQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
  taskId: objectIdSchema.optional(),
  channelId: objectIdSchema.optional(),
  kind: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['createdAt', 'name', 'size']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export const updateFileSchema = z.object({ name: z.string().trim().min(1).max(255) });

export type UploadFileFields = z.infer<typeof uploadFileFieldsSchema>;
export type FileListQuery = z.infer<typeof fileListQuerySchema>;

export interface FileDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  channelId: string | null;
  documentId: string | null;
  name: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  uploadedBy: UserPublicDto;
  createdAt: string;
}

export interface StorageUsageDto {
  usedBytes: number;
  limitBytes: number;
  fileCount: number;
}

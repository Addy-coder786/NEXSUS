import type { Types } from 'mongoose';
import type { FileDto, UserPublicDto } from '@nexus/shared';
import type { IFile } from '../../models/File';
import { loadUserMap } from '../workspaces/user.lookup';

export type FileLean = IFile & { _id: Types.ObjectId };

export function toFileDto(file: FileLean, uploadedBy: UserPublicDto): FileDto {
  return {
    id: String(file._id),
    workspaceId: String(file.workspaceId),
    projectId: file.projectId ? String(file.projectId) : null,
    taskId: file.taskId ? String(file.taskId) : null,
    channelId: file.channelId ? String(file.channelId) : null,
    documentId: file.documentId ? String(file.documentId) : null,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    kind: file.kind,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl ?? null,
    width: file.width ?? null,
    height: file.height ?? null,
    uploadedBy,
    createdAt: file.createdAt.toISOString(),
  };
}

export async function buildFileDtos(files: FileLean[]): Promise<FileDto[]> {
  if (files.length === 0) return [];
  const users = await loadUserMap(files.map((f) => f.uploadedBy));
  return files.map((f) => toFileDto(f, users.get(f.uploadedBy)));
}

export async function buildFileDto(file: FileLean): Promise<FileDto> {
  const [dto] = await buildFileDtos([file]);
  if (!dto) throw new Error('File DTO could not be built');
  return dto;
}

import path from 'node:path';
import { Types, type FilterQuery } from 'mongoose';
import {
  ERROR_CODES,
  FILE_KINDS,
  hasPermission,
  type FileDto,
  type FileListQuery,
  type PaginationMeta,
  type StorageUsageDto,
  type UploadFileFields,
  type WorkspaceRole,
} from '@nexus/shared';
import { env } from '../../config/env';
import { events } from '../../events';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { Channel } from '../../models/Channel';
import { DocumentModel } from '../../models/Document';
import { FileModel, fileKindFromMime, type IFile } from '../../models/File';
import { Message } from '../../models/Message';
import { Project } from '../../models/Project';
import { Task, type TaskLean } from '../../models/Task';
import { recordActivity } from '../../services/activity.service';
import * as storage from '../../services/storage';
import { canAccessChannel } from '../../sockets';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { buildFileDto, buildFileDtos, type FileLean } from './file.dto';
import { sanitizeFilename, validateIncomingFile, type IncomingFile } from './file.validation';

export type { FileLean } from './file.dto';

// ---------- loading & access ----------

export async function loadFileById(id: string): Promise<FileLean> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('File');
  const file = await FileModel.findOne({ _id: id, deletedAt: null }).lean();
  if (!file) throw ApiError.notFound('File');
  return file;
}

/** Project-scoped files are only visible to users who can access the project. */
export async function assertFileAccess(file: FileLean, role: WorkspaceRole, userId: string): Promise<void> {
  if (!file.projectId || canSeeAllProjects(role)) return;
  const project = await Project.findById(file.projectId).select('memberIds').lean();
  if (!project || !hasProjectAccess(project, role, userId)) {
    throw ApiError.forbidden('You are not a member of this project');
  }
}

async function accessibleProjectIds(
  workspaceId: string,
  role: WorkspaceRole,
  userId: string,
): Promise<Types.ObjectId[] | null> {
  if (canSeeAllProjects(role)) return null;
  const projects = await Project.find({ workspaceId, memberIds: new Types.ObjectId(userId) }).select('_id').lean();
  return projects.map((p) => p._id);
}

// ---------- quota ----------

export async function getUsage(workspaceId: string, limitBytes = env.STORAGE_LIMIT_BYTES): Promise<StorageUsageDto> {
  const [row] = await FileModel.aggregate<{ usedBytes: number; fileCount: number }>([
    { $match: { workspaceId: new Types.ObjectId(workspaceId), deletedAt: null } },
    { $group: { _id: null, usedBytes: { $sum: '$size' }, fileCount: { $sum: 1 } } },
  ]);
  return { usedBytes: row?.usedBytes ?? 0, fileCount: row?.fileCount ?? 0, limitBytes };
}

// ---------- upload ----------

export interface UploadOptions {
  /** Overrides env.STORAGE_LIMIT_BYTES (tests). */
  limitBytes?: number;
}

interface ResolvedScope {
  projectId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  channelId: Types.ObjectId | null;
  documentId: Types.ObjectId | null;
}

async function resolveScope(
  workspaceId: string,
  role: WorkspaceRole,
  userId: string,
  fields: UploadFileFields,
): Promise<ResolvedScope> {
  const scope: ResolvedScope = { projectId: null, taskId: null, channelId: null, documentId: null };

  let task: TaskLean | null = null;
  if (fields.taskId) {
    task = await Task.findOne({ _id: fields.taskId, workspaceId }).lean();
    if (!task) throw ApiError.badRequest('Task not found in this workspace');
    scope.taskId = task._id;
    scope.projectId = task.projectId;
  }

  if (fields.projectId) {
    if (task && String(task.projectId) !== fields.projectId) {
      throw ApiError.badRequest('Task does not belong to the given project');
    }
    scope.projectId = new Types.ObjectId(fields.projectId);
  }

  if (scope.projectId) {
    const project = await Project.findOne({ _id: scope.projectId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.badRequest('Project not found in this workspace');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
  }

  if (fields.channelId) {
    const channel = await Channel.findOne({ _id: fields.channelId, workspaceId }).select('_id').lean();
    if (!channel) throw ApiError.badRequest('Channel not found in this workspace');
    if (!(await canAccessChannel(fields.channelId, userId))) throw ApiError.forbidden('You cannot access this channel');
    scope.channelId = channel._id;
  }

  if (fields.documentId) {
    const doc = await DocumentModel.findOne({ _id: fields.documentId, workspaceId }).select('projectId').lean();
    if (!doc) throw ApiError.badRequest('Document not found in this workspace');
    if (doc.projectId && !canSeeAllProjects(role)) {
      const project = await Project.findById(doc.projectId).select('memberIds').lean();
      if (!project || !hasProjectAccess(project, role, userId)) {
        throw ApiError.forbidden('You are not a member of this project');
      }
    }
    scope.documentId = doc._id;
  }

  return scope;
}

export async function uploadFile(
  workspaceId: string,
  actorId: string,
  role: WorkspaceRole,
  incoming: IncomingFile,
  fields: UploadFileFields,
  options: UploadOptions = {},
): Promise<FileDto> {
  validateIncomingFile(incoming);
  const scope = await resolveScope(workspaceId, role, actorId, fields);

  const limitBytes = options.limitBytes ?? env.STORAGE_LIMIT_BYTES;
  const usage = await getUsage(workspaceId, limitBytes);
  if (usage.usedBytes + incoming.size > limitBytes) {
    throw new ApiError(413, ERROR_CODES.BAD_REQUEST, 'Workspace storage quota exceeded', {
      usedBytes: usage.usedBytes,
      limitBytes,
    });
  }

  const name = sanitizeFilename(incoming.originalname);
  const stored = await storage.uploadFile(incoming.buffer, { workspaceId, filename: name, mimeType: incoming.mimetype });

  const file = await FileModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    ...scope,
    uploadedBy: new Types.ObjectId(actorId),
    name,
    mimeType: incoming.mimetype,
    size: incoming.size,
    kind: fileKindFromMime(incoming.mimetype),
    url: stored.url,
    thumbnailUrl: stored.thumbnailUrl ?? null,
    width: stored.width ?? null,
    height: stored.height ?? null,
    storageKey: stored.storageKey,
    provider: stored.provider,
  });

  const dto = await buildFileDto(file.toObject());
  events.emit('file.uploaded', { file: dto, actorId });
  await recordActivity({
    workspaceId,
    projectId: scope.projectId,
    actorId,
    type: 'FILE_UPLOADED',
    metadata: {
      fileId: dto.id,
      name: dto.name,
      kind: dto.kind,
      size: dto.size,
      taskId: dto.taskId,
      channelId: dto.channelId,
      documentId: dto.documentId,
    },
  });
  return dto;
}

// ---------- list ----------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listFiles(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  query: FileListQuery,
): Promise<{ items: FileDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<IFile> = { workspaceId: new Types.ObjectId(workspaceId), deletedAt: null };
  const and: FilterQuery<IFile>[] = [];

  if (query.taskId) filter.taskId = new Types.ObjectId(query.taskId);
  if (query.channelId) filter.channelId = new Types.ObjectId(query.channelId);
  if (query.kind && (FILE_KINDS as readonly string[]).includes(query.kind)) filter.kind = query.kind;
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), 'i');

  if (query.projectId) {
    const project = await Project.findOne({ _id: query.projectId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.notFound('Project');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    filter.projectId = project._id;
  } else {
    const accessible = await accessibleProjectIds(workspaceId, role, userId);
    if (accessible) and.push({ $or: [{ projectId: null }, { projectId: { $in: accessible } }] });
  }
  if (and.length) filter.$and = and;

  const direction = query.order === 'asc' ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [query.sort]: direction, _id: 1 };
  const { page, limit } = query;
  const [total, files] = await Promise.all([
    FileModel.countDocuments(filter),
    FileModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { items: await buildFileDtos(files), meta: paginationMeta(page, limit, total) };
}

export async function listTaskFiles(taskId: Types.ObjectId): Promise<FileDto[]> {
  const files = await FileModel.find({ taskId, deletedAt: null }).sort({ createdAt: -1, _id: 1 }).lean();
  return buildFileDtos(files);
}

export async function getFile(file: FileLean): Promise<FileDto> {
  return buildFileDto(file);
}

// ---------- rename / delete ----------

export function canManageFile(file: FileLean, userId: string, role: WorkspaceRole): boolean {
  return String(file.uploadedBy) === userId || hasPermission(role, 'file:delete');
}

/** Renames the file, always keeping the original extension. */
export async function renameFile(file: FileLean, actorId: string, role: WorkspaceRole, name: string): Promise<FileDto> {
  if (!canManageFile(file, actorId, role)) throw ApiError.forbidden('Only the uploader or a manager can rename this file');

  const ext = path.extname(file.name);
  let next = sanitizeFilename(name);
  if (ext) {
    const stem = path.extname(next) ? next.slice(0, -path.extname(next).length) : next;
    next = `${stem || 'file'}${ext}`.slice(0, 255);
  }

  const updated = await FileModel.findOneAndUpdate({ _id: file._id }, { $set: { name: next } }, { new: true }).lean();
  if (!updated) throw ApiError.notFound('File');
  return buildFileDto(updated);
}

/** Soft-deletes the file, unlinks it from its message and removes the stored object best-effort. */
export async function deleteFile(file: FileLean, actorId: string, role: WorkspaceRole): Promise<void> {
  if (!canManageFile(file, actorId, role)) throw ApiError.forbidden('Only the uploader or a manager can delete this file');

  await FileModel.updateOne({ _id: file._id }, { $set: { deletedAt: new Date() } });
  if (file.messageId) {
    await Message.updateOne({ _id: file.messageId }, { $pull: { attachmentIds: file._id } });
  }
  await storage.deleteFile(file.storageKey, file.provider);

  await recordActivity({
    workspaceId: file.workspaceId,
    projectId: file.projectId,
    actorId,
    type: 'FILE_DELETED',
    metadata: { fileId: String(file._id), name: file.name, kind: file.kind, taskId: file.taskId ? String(file.taskId) : null },
  });
}

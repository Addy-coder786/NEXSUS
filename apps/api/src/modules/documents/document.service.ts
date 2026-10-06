import { Types, type FilterQuery } from 'mongoose';
import {
  ERROR_CODES,
  hasPermission,
  type CreateDocumentInput,
  type DocumentDto,
  type DocumentListQuery,
  type DocumentSummaryDto,
  type DocumentVersionDto,
  type PaginationMeta,
  type RichContent,
  type WorkspaceRole,
} from '@nexus/shared';
import { cache } from '../../config/redis';
import { events } from '../../events';
import { enqueue } from '../../jobs';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { DocumentModel, EMPTY_DOC, type IDocument } from '../../models/Document';
import { DocumentVersion, type IDocumentVersion } from '../../models/DocumentVersion';
import { FileModel } from '../../models/File';
import { Project } from '../../models/Project';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { loadUserMap, type UserMap } from '../workspaces/user.lookup';
import { excerptFromText, richContentToText } from './document.text';
import './document.jobs';

export type DocumentLean = IDocument & { _id: Types.ObjectId };
type VersionLean = IDocumentVersion & { _id: Types.ObjectId };

/** DOCUMENT_UPDATED is recorded at most once per this window per document and user. */
const UPDATE_ACTIVITY_DEBOUNCE_SEC = 10 * 60;

// ---------- DTOs ----------

export function toDocumentSummaryDto(doc: DocumentLean, users: UserMap): DocumentSummaryDto {
  return {
    id: String(doc._id),
    workspaceId: String(doc.workspaceId),
    projectId: doc.projectId ? String(doc.projectId) : null,
    title: doc.title,
    icon: doc.icon ?? null,
    excerpt: excerptFromText(doc.contentText ?? ''),
    isArchived: doc.isArchived,
    version: doc.version,
    createdBy: users.get(doc.createdBy),
    updatedBy: users.get(doc.updatedBy),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toDocumentDto(doc: DocumentLean, users: UserMap): DocumentDto {
  return { ...toDocumentSummaryDto(doc, users), content: doc.content ?? EMPTY_DOC };
}

export async function buildDocumentSummaries(docs: DocumentLean[]): Promise<DocumentSummaryDto[]> {
  if (docs.length === 0) return [];
  const users = await loadUserMap(docs.flatMap((d) => [d.createdBy, d.updatedBy]));
  return docs.map((d) => toDocumentSummaryDto(d, users));
}

export async function buildDocumentDto(doc: DocumentLean): Promise<DocumentDto> {
  const users = await loadUserMap([doc.createdBy, doc.updatedBy]);
  return toDocumentDto(doc, users);
}

function toVersionDto(v: VersionLean, users: UserMap): DocumentVersionDto {
  return {
    id: String(v._id),
    version: v.version,
    savedBy: users.get(v.savedBy),
    title: v.title,
    createdAt: v.createdAt.toISOString(),
  };
}

// ---------- loading & access ----------

export async function loadDocumentById(id: string): Promise<DocumentLean> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Document');
  const doc = await DocumentModel.findById(id).lean();
  if (!doc) throw ApiError.notFound('Document');
  return doc;
}

async function reloadDocument(id: Types.ObjectId): Promise<DocumentLean> {
  const doc = await DocumentModel.findById(id).lean();
  if (!doc) throw ApiError.notFound('Document');
  return doc;
}

/** Project-scoped documents are only visible to users who can access the project. */
export async function assertDocumentAccess(doc: DocumentLean, role: WorkspaceRole, userId: string): Promise<void> {
  if (!doc.projectId || canSeeAllProjects(role)) return;
  const project = await Project.findById(doc.projectId).select('memberIds').lean();
  if (!project || !hasProjectAccess(project, role, userId)) {
    throw ApiError.forbidden('You are not a member of this project');
  }
}

/** Validates a project id for a new/duplicated document: same workspace and accessible. */
async function resolveProjectId(
  workspaceId: string,
  projectId: string | null | undefined,
  role: WorkspaceRole,
  userId: string,
): Promise<Types.ObjectId | null> {
  if (!projectId) return null;
  const project = await Project.findOne({ _id: projectId, workspaceId }).select('memberIds').lean();
  if (!project) throw ApiError.badRequest('Project not found in this workspace');
  if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
  return project._id;
}

/** Project ids a restricted role (MEMBER/VIEWER) can see; null when the role sees everything. */
export async function accessibleProjectIds(
  workspaceId: string,
  role: WorkspaceRole,
  userId: string,
): Promise<Types.ObjectId[] | null> {
  if (canSeeAllProjects(role)) return null;
  const projects = await Project.find({ workspaceId, memberIds: new Types.ObjectId(userId) }).select('_id').lean();
  return projects.map((p) => p._id);
}

// ---------- list ----------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listDocuments(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  query: DocumentListQuery,
): Promise<{ items: DocumentSummaryDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<IDocument> = {
    workspaceId: new Types.ObjectId(workspaceId),
    isArchived: query.archived ?? false,
  };

  if (query.projectId === 'none') {
    filter.projectId = null;
  } else if (query.projectId) {
    const project = await Project.findOne({ _id: query.projectId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.notFound('Project');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    filter.projectId = project._id;
  } else {
    const accessible = await accessibleProjectIds(workspaceId, role, userId);
    if (accessible) filter.$or = [{ projectId: null }, { projectId: { $in: accessible } }];
  }

  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    filter.$and = [{ $or: [{ title: regex }, { contentText: regex }] }];
  }

  const sort: Record<string, 1 | -1> =
    query.sort === 'title' ? { title: 1, _id: 1 } : { [query.sort]: -1, _id: 1 };
  const { page, limit } = query;
  const [total, docs] = await Promise.all([
    DocumentModel.countDocuments(filter),
    DocumentModel.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return { items: await buildDocumentSummaries(docs), meta: paginationMeta(page, limit, total) };
}

// ---------- create ----------

export async function createDocument(
  workspaceId: string,
  actorId: string,
  role: WorkspaceRole,
  input: CreateDocumentInput,
): Promise<DocumentDto> {
  const projectId = await resolveProjectId(workspaceId, input.projectId, role, actorId);
  const content = input.content ?? EMPTY_DOC;

  const doc = await DocumentModel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    projectId,
    title: input.title,
    icon: input.icon ?? null,
    content,
    contentText: richContentToText(content),
    version: 1,
    createdBy: new Types.ObjectId(actorId),
    updatedBy: new Types.ObjectId(actorId),
  });

  await enqueue('document.snapshot', { documentId: String(doc._id), version: doc.version });
  await recordActivity({
    workspaceId,
    projectId,
    actorId,
    type: 'DOCUMENT_CREATED',
    metadata: { documentId: String(doc._id), title: doc.title },
  });

  return buildDocumentDto(doc.toObject());
}

// ---------- update ----------

export interface UpdateDocumentFields {
  title?: string;
  content?: RichContent;
  contentText?: string;
  icon?: string | null;
  isArchived?: boolean;
  baseVersion?: number;
}

function conflict(currentVersion: number): ApiError {
  return new ApiError(409, ERROR_CODES.CONFLICT, 'Document was modified', { currentVersion });
}

/** Applies the change as a new version; the snapshot job stores the previous content. */
async function commitNewVersion(
  doc: DocumentLean,
  actorId: string,
  $set: Record<string, unknown>,
  contentChanged: boolean,
): Promise<DocumentLean> {
  const updated = await DocumentModel.findOneAndUpdate(
    { _id: doc._id, version: doc.version },
    { $set: { ...$set, updatedBy: new Types.ObjectId(actorId) }, $inc: { version: 1 } },
    { new: true },
  ).lean();
  if (!updated) {
    const current = await reloadDocument(doc._id);
    throw conflict(current.version);
  }

  if (contentChanged) {
    await enqueue('document.snapshot', { documentId: String(updated._id), version: updated.version });
  }

  const summary = await buildDocumentSummaries([updated]);
  if (summary[0]) events.emit('document.updated', { document: summary[0], actorId });
  return updated;
}

async function recordUpdateDebounced(doc: DocumentLean, actorId: string, fields: string[]): Promise<void> {
  const key = `doc:activity:${String(doc._id)}:${actorId}`;
  if (await cache.get<boolean>(key)) return;
  await cache.set(key, true, UPDATE_ACTIVITY_DEBOUNCE_SEC);
  await recordActivity({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    actorId,
    type: 'DOCUMENT_UPDATED',
    metadata: { documentId: String(doc._id), title: doc.title, fields },
  });
}

export async function updateDocument(
  doc: DocumentLean,
  actorId: string,
  input: UpdateDocumentFields,
): Promise<DocumentDto> {
  if (input.baseVersion !== undefined && input.baseVersion < doc.version) throw conflict(doc.version);

  const $set: Record<string, unknown> = {};
  const fields: string[] = [];

  if (input.title !== undefined && input.title !== doc.title) {
    $set.title = input.title;
    fields.push('title');
  }
  if (input.icon !== undefined && input.icon !== (doc.icon ?? null)) {
    $set.icon = input.icon;
    fields.push('icon');
  }
  if (input.isArchived !== undefined && input.isArchived !== doc.isArchived) {
    $set.isArchived = input.isArchived;
    fields.push('isArchived');
  }
  const contentChanged = input.content !== undefined;
  if (input.content !== undefined) {
    $set.content = input.content;
    $set.contentText = input.contentText ?? richContentToText(input.content);
    fields.push('content');
  } else if (input.contentText !== undefined && input.contentText !== doc.contentText) {
    $set.contentText = input.contentText;
  }

  if (Object.keys($set).length === 0) return buildDocumentDto(doc);

  const updated = await commitNewVersion(doc, actorId, $set, contentChanged);
  if (fields.length) await recordUpdateDebounced(updated, actorId, fields);
  return buildDocumentDto(updated);
}

// ---------- delete ----------

export function canDeleteDocument(doc: DocumentLean, userId: string, role: WorkspaceRole): boolean {
  return hasPermission(role, 'document:delete') || String(doc.createdBy) === userId;
}

export async function deleteDocument(doc: DocumentLean, actorId: string, role: WorkspaceRole): Promise<void> {
  if (!canDeleteDocument(doc, actorId, role)) {
    throw ApiError.forbidden('Only the creator or a manager can delete this document');
  }
  await Promise.all([
    DocumentVersion.deleteMany({ documentId: doc._id }),
    FileModel.updateMany({ documentId: doc._id }, { $set: { documentId: null } }),
  ]);
  await DocumentModel.deleteOne({ _id: doc._id });
  await cache.delByPrefix(`doc:activity:${String(doc._id)}:`);

  await recordActivity({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    actorId,
    type: 'DOCUMENT_DELETED',
    metadata: { documentId: String(doc._id), title: doc.title },
  });
}

// ---------- versions ----------

export async function listVersions(doc: DocumentLean): Promise<DocumentVersionDto[]> {
  const versions = await DocumentVersion.find({ documentId: doc._id })
    .select('-content')
    .sort({ version: -1 })
    .lean();
  const users = await loadUserMap(versions.map((v) => v.savedBy));
  return versions.map((v) => toVersionDto(v, users));
}

export interface DocumentVersionDetail {
  version: number;
  title: string;
  content: RichContent;
  savedBy: DocumentVersionDto['savedBy'];
  createdAt: string;
}

async function loadVersion(doc: DocumentLean, version: number): Promise<VersionLean> {
  const found = await DocumentVersion.findOne({ documentId: doc._id, version }).lean();
  if (!found) throw ApiError.notFound('Document version');
  return found;
}

export async function getVersion(doc: DocumentLean, version: number): Promise<DocumentVersionDetail> {
  const v = await loadVersion(doc, version);
  const users = await loadUserMap([v.savedBy]);
  return {
    version: v.version,
    title: v.title,
    content: v.content,
    savedBy: users.get(v.savedBy),
    createdAt: v.createdAt.toISOString(),
  };
}

export async function restoreVersion(doc: DocumentLean, version: number, actorId: string): Promise<DocumentDto> {
  const v = await loadVersion(doc, version);
  const updated = await commitNewVersion(
    doc,
    actorId,
    { title: v.title, content: v.content, contentText: richContentToText(v.content) },
    true,
  );
  await recordUpdateDebounced(updated, actorId, ['restore']);
  return buildDocumentDto(updated);
}

// ---------- duplicate ----------

export async function duplicateDocument(doc: DocumentLean, actorId: string): Promise<DocumentDto> {
  const title = `${doc.title} (copy)`.slice(0, 200);
  const copy = await DocumentModel.create({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    title,
    icon: doc.icon ?? null,
    content: doc.content ?? EMPTY_DOC,
    contentText: doc.contentText ?? '',
    version: 1,
    createdBy: new Types.ObjectId(actorId),
    updatedBy: new Types.ObjectId(actorId),
  });

  await enqueue('document.snapshot', { documentId: String(copy._id), version: copy.version });
  await recordActivity({
    workspaceId: doc.workspaceId,
    projectId: doc.projectId,
    actorId,
    type: 'DOCUMENT_CREATED',
    metadata: { documentId: String(copy._id), title, duplicatedFrom: String(doc._id) },
  });
  return buildDocumentDto(copy.toObject());
}

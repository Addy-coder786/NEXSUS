import { Types, type FilterQuery, type Model } from 'mongoose';
import type {
  DocumentSummaryDto,
  FileDto,
  MessageSearchHit,
  ProjectDto,
  SearchQuery,
  SearchResultsDto,
  SearchType,
  TaskDto,
  UserPublicDto,
  WorkspaceRole,
} from '@nexus/shared';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { Channel } from '../../models/Channel';
import { DocumentModel, type IDocument } from '../../models/Document';
import { FileModel, type IFile } from '../../models/File';
import { Message, type IMessage } from '../../models/Message';
import { Project, type IProject, type ProjectLean } from '../../models/Project';
import { Task, type ITask, type TaskLean } from '../../models/Task';
import { USER_PUBLIC_FIELDS, User, toUserPublicDto, type IUser } from '../../models/User';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { ApiError } from '../../utils/ApiError';
import { buildDocumentSummaries, type DocumentLean } from '../documents/document.service';
import { buildFileDtos, type FileLean } from '../files/file.dto';
import { buildProjectDtos } from '../projects/project.service';
import { buildTaskDtos } from '../tasks/task.service';
import { loadUserMap } from '../workspaces/user.lookup';

/** `counts` are capped here so a broad query never scans the whole collection. */
export const COUNT_CAP = 100;
const TEXT_MIN_LENGTH = 3;
const SNIPPET_LENGTH = 160;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Visibility {
  workspaceId: Types.ObjectId;
  /** null when the caller sees every project */
  projectIds: Types.ObjectId[] | null;
  /** Explicit project filter from the query (already access-checked). */
  projectFilter: Types.ObjectId | null;
}

/**
 * Runs `$text` first (for queries long enough to be useful), falling back to a case-insensitive
 * regex on `regexFields` when the text search yields nothing. Returns matches plus a capped count.
 */
async function findWithFallback<T>(
  model: Model<T>,
  base: FilterQuery<T>,
  q: string,
  regexFields: string[],
  limit: number,
  sort: Record<string, 1 | -1>,
): Promise<{ items: (T & { _id: Types.ObjectId })[]; count: number }> {
  type Row = T & { _id: Types.ObjectId };
  if (q.length >= TEXT_MIN_LENGTH) {
    const textFilter: FilterQuery<T> = { ...base, $text: { $search: q } };
    const items = (await model
      .find(textFilter, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean()) as unknown as Row[];
    if (items.length) {
      const count = await model.countDocuments(textFilter, { limit: COUNT_CAP });
      return { items, count };
    }
  }
  const regex = new RegExp(escapeRegex(q), 'i');
  const regexFilter: FilterQuery<T> = {
    ...base,
    $or: regexFields.map((f) => ({ [f]: regex })),
  } as FilterQuery<T>;
  const [items, count] = await Promise.all([
    model.find(regexFilter).sort(sort).limit(limit).lean() as unknown as Promise<Row[]>,
    model.countDocuments(regexFilter, { limit: COUNT_CAP }),
  ]);
  return { items, count };
}

function projectScope<T extends { projectId?: unknown }>(vis: Visibility, allowUnscoped: boolean): FilterQuery<T> {
  if (vis.projectFilter) return { projectId: vis.projectFilter } as FilterQuery<T>;
  if (!vis.projectIds) return {};
  const scoped: FilterQuery<T>[] = [{ projectId: { $in: vis.projectIds } } as FilterQuery<T>];
  if (allowUnscoped) scoped.push({ projectId: null } as FilterQuery<T>);
  return { $or: scoped } as FilterQuery<T>;
}

// ---------- per type ----------

async function searchTasks(vis: Visibility, q: string, limit: number): Promise<{ items: TaskDto[]; count: number }> {
  const base: FilterQuery<ITask> = { workspaceId: vis.workspaceId, ...projectScope<ITask>(vis, false) };
  const { items, count } = await findWithFallback(Task, base, q, ['title', 'key'], limit, { updatedAt: -1, _id: 1 });
  if (!items.length) return { items: [], count };

  const projectIds = [...new Set(items.map((t) => String(t.projectId)))];
  const projects = await Project.find({ _id: { $in: projectIds } }).lean();
  const byProject = new Map(projects.map((p) => [String(p._id), p]));

  const dtos = new Map<string, TaskDto>();
  await Promise.all(
    projects.map(async (project) => {
      const group = items.filter((t) => String(t.projectId) === String(project._id)) as TaskLean[];
      for (const dto of await buildTaskDtos(group, project)) dtos.set(dto.id, dto);
    }),
  );
  const ordered = items.flatMap((t) => (byProject.has(String(t.projectId)) ? [dtos.get(String(t._id))] : []));
  return { items: ordered.filter((d): d is TaskDto => Boolean(d)), count };
}

async function searchProjects(vis: Visibility, q: string, limit: number): Promise<{ items: ProjectDto[]; count: number }> {
  const base: FilterQuery<IProject> = { workspaceId: vis.workspaceId };
  if (vis.projectFilter) base._id = vis.projectFilter;
  else if (vis.projectIds) base._id = { $in: vis.projectIds };
  // Projects have no text index: regex on name and key.
  const regex = new RegExp(escapeRegex(q), 'i');
  const filter: FilterQuery<IProject> = { ...base, $or: [{ name: regex }, { key: regex }] };
  const [items, count] = await Promise.all([
    Project.find(filter).sort({ updatedAt: -1, _id: 1 }).limit(limit).lean(),
    Project.countDocuments(filter, { limit: COUNT_CAP }),
  ]);
  return { items: await buildProjectDtos(items as ProjectLean[]), count };
}

async function searchDocuments(vis: Visibility, q: string, limit: number): Promise<{ items: DocumentSummaryDto[]; count: number }> {
  const base: FilterQuery<IDocument> = { workspaceId: vis.workspaceId, isArchived: false, ...projectScope<IDocument>(vis, true) };
  const { items, count } = await findWithFallback(DocumentModel, base, q, ['title'], limit, { updatedAt: -1, _id: 1 });
  return { items: await buildDocumentSummaries(items as DocumentLean[]), count };
}

async function searchFiles(vis: Visibility, q: string, limit: number): Promise<{ items: FileDto[]; count: number }> {
  const base: FilterQuery<IFile> = { workspaceId: vis.workspaceId, deletedAt: null, ...projectScope<IFile>(vis, true) };
  const { items, count } = await findWithFallback(FileModel, base, q, ['name'], limit, { createdAt: -1, _id: 1 });
  return { items: await buildFileDtos(items as FileLean[]), count };
}

/** 160 characters around the first match of `q` (case-insensitive). */
export function makeSnippet(body: string, q: string, length = SNIPPET_LENGTH): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text.length <= length) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return `${text.slice(0, length - 1)}…`;
  let start = Math.max(0, idx - Math.floor((length - q.length) / 2));
  start = Math.min(start, Math.max(0, text.length - length));
  const end = Math.min(text.length, start + length);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function externalAuthorDto(author: NonNullable<IMessage['externalAuthor']>): UserPublicDto {
  return {
    id: author.slackUserId ? `slack:${author.slackUserId}` : 'external',
    name: author.name,
    email: '',
    avatarUrl: author.avatarUrl ?? null,
    title: null,
    availability: 'OFFLINE',
  };
}

async function searchMessages(
  vis: Visibility,
  userId: string,
  q: string,
  limit: number,
): Promise<{ items: MessageSearchHit[]; count: number }> {
  const channelFilter: FilterQuery<{ workspaceId: unknown; type: string; memberIds: unknown; projectId: unknown }> = {
    workspaceId: vis.workspaceId,
    $or: [{ type: 'PUBLIC' }, { memberIds: new Types.ObjectId(userId) }],
  };
  if (vis.projectFilter) channelFilter.projectId = vis.projectFilter;
  const channels = await Channel.find(channelFilter).select('name').lean();
  if (!channels.length) return { items: [], count: 0 };
  const channelNames = new Map(channels.map((c) => [String(c._id), c.name]));

  const base: FilterQuery<IMessage> = { workspaceId: vis.workspaceId, channelId: { $in: channels.map((c) => c._id) }, deletedAt: null };
  const { items, count } = await findWithFallback(Message, base, q, ['body'], limit, { createdAt: -1, _id: 1 });
  if (!items.length) return { items: [], count };

  const users = await loadUserMap(items.map((m) => m.authorId));
  return {
    items: items.map((m) => ({
      id: String(m._id),
      channelId: String(m.channelId),
      channelName: channelNames.get(String(m.channelId)) ?? '',
      author: m.authorId ? users.get(m.authorId) : m.externalAuthor ? externalAuthorDto(m.externalAuthor) : null,
      snippet: makeSnippet(m.body, q),
      createdAt: m.createdAt.toISOString(),
    })),
    count,
  };
}

async function searchUsers(vis: Visibility, q: string, limit: number): Promise<{ items: UserPublicDto[]; count: number }> {
  const memberIds = await WorkspaceMember.distinct('userId', { workspaceId: vis.workspaceId });
  if (!memberIds.length) return { items: [], count: 0 };
  const base: FilterQuery<IUser> = { _id: { $in: memberIds }, deletedAt: null };
  const { items, count } = await findWithFallback(User, base, q, ['name', 'email'], limit, { name: 1, _id: 1 });
  const rows = await User.find({ _id: { $in: items.map((u) => u._id) } })
    .select(USER_PUBLIC_FIELDS)
    .lean();
  const byId = new Map(rows.map((u) => [String(u._id), toUserPublicDto(u)]));
  return { items: items.flatMap((u) => byId.get(String(u._id)) ?? []), count };
}

// ---------- entry point ----------

export async function search(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  query: SearchQuery,
): Promise<SearchResultsDto> {
  const wsId = new Types.ObjectId(workspaceId);
  const q = query.q.trim();
  const limit = query.limit;

  let projectFilter: Types.ObjectId | null = null;
  if (query.projectId) {
    if (!Types.ObjectId.isValid(query.projectId)) throw ApiError.notFound('Project');
    const project = await Project.findOne({ _id: query.projectId, workspaceId: wsId }).select('memberIds').lean();
    if (!project) throw ApiError.notFound('Project');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    projectFilter = project._id;
  }

  let projectIds: Types.ObjectId[] | null = null;
  if (!canSeeAllProjects(role)) {
    const projects = await Project.find({ workspaceId: wsId, memberIds: new Types.ObjectId(userId) }).select('_id').lean();
    projectIds = projects.map((p) => p._id);
  }
  const vis: Visibility = { workspaceId: wsId, projectIds, projectFilter };
  const wants = new Set<SearchType>(query.types);
  const empty = { items: [], count: 0 };

  const [tasks, projects, documents, messages, files, users] = await Promise.all([
    wants.has('tasks') ? searchTasks(vis, q, limit) : { ...empty, items: [] as TaskDto[] },
    wants.has('projects') ? searchProjects(vis, q, limit) : { ...empty, items: [] as ProjectDto[] },
    wants.has('documents') ? searchDocuments(vis, q, limit) : { ...empty, items: [] as DocumentSummaryDto[] },
    wants.has('messages') ? searchMessages(vis, userId, q, limit) : { ...empty, items: [] as MessageSearchHit[] },
    wants.has('files') ? searchFiles(vis, q, limit) : { ...empty, items: [] as FileDto[] },
    wants.has('users') ? searchUsers(vis, q, limit) : { ...empty, items: [] as UserPublicDto[] },
  ]);

  return {
    query: q,
    tasks: tasks.items,
    projects: projects.items,
    documents: documents.items,
    messages: messages.items,
    files: files.items,
    users: users.items,
    counts: {
      tasks: Math.min(tasks.count, COUNT_CAP),
      projects: Math.min(projects.count, COUNT_CAP),
      documents: Math.min(documents.count, COUNT_CAP),
      messages: Math.min(messages.count, COUNT_CAP),
      files: Math.min(files.count, COUNT_CAP),
      users: Math.min(users.count, COUNT_CAP),
    },
  };
}

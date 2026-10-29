import type Anthropic from '@anthropic-ai/sdk';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type AiScope,
  type AiSourceDto,
  type UserPublicDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { Activity, type IActivity } from '../../models/Activity';
import { Comment } from '../../models/Comment';
import { CHUNK_SOURCE_TYPES } from '../../models/Chunk';
import { DocumentModel, type IDocument } from '../../models/Document';
import { Project, type ProjectLean } from '../../models/Project';
import { Task, type ITask, type TaskLean } from '../../models/Task';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { getProjectAnalytics, getWorkspaceAnalytics } from '../analytics/analytics.service';
import { accessibleProjectIds, assertDocumentAccess } from '../documents/document.service';
import { retrieve, toSourceDto } from '../rag/rag.service';
import { loadUserMap } from '../workspaces/user.lookup';
import { links } from './links';

/**
 * The assistant's tools. Every tool runs with the caller's visibility (project membership,
 * channel access) and returns compact JSON. Entities a tool surfaces are reported as sources.
 */

export interface ToolContext {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  scope: AiScope;
  /** projectId (project scope) or documentId (document scope) */
  scopeId: string | null;
}

export interface ToolOutcome {
  result: unknown;
  /** Short human description shown in the UI */
  label: string;
  resultCount: number | null;
  sources: AiSourceDto[];
}

const DOCUMENT_CHAR_LIMIT = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const nullable = (type: string | Record<string, unknown>, description: string) => ({
  anyOf: [typeof type === 'string' ? { type } : type, { type: 'null' }],
  description,
});

const objectSchema = (properties: Record<string, Record<string, unknown>>) => ({
  type: 'object' as const,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

// Strict tools (schema-valid arguments). eager_input_streaming is left off on purpose: inputs
// are tiny, and with it on the API would stop validating them against the strict schema.
export const ASSISTANT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_workspace',
    description:
      'Semantic and keyword search across the workspace: tasks, documents, chat messages, meeting notes and text files. ' +
      'Use it first for open questions ("what did we decide about X", "where is Y discussed").',
    strict: true,
    input_schema: objectSchema({
      query: { type: 'string', description: 'What to look for, in natural language or keywords' },
      sourceTypes: nullable({ type: 'array', items: { type: 'string', enum: [...CHUNK_SOURCE_TYPES] } }, 'Restrict to these source types, or null for all'),
      projectId: nullable('string', 'Restrict to one project id, or null'),
    }),
  },
  {
    name: 'list_tasks',
    description:
      'List tasks with filters. Use for questions about status, assignments, deadlines and overdue work. ' +
      'assignee is "me" for the current user or a person\'s name.',
    strict: true,
    input_schema: objectSchema({
      projectId: nullable('string', 'Project id, or null for every project the user can see'),
      status: nullable({ type: 'string', enum: [...TASK_STATUSES] }, 'Task status filter'),
      assignee: nullable('string', '"me", a member name, or null'),
      overdue: nullable('boolean', 'Only open tasks past their due date'),
      dueWithinDays: nullable('integer', 'Only open tasks due within this many days'),
      priority: nullable({ type: 'string', enum: [...TASK_PRIORITIES] }, 'Priority filter'),
      limit: nullable('integer', 'Maximum results (default 20, at most 50)'),
    }),
  },
  {
    name: 'get_task',
    description: 'Full details of one task by key (e.g. "WEB-12") or id, with its latest comments and dependencies.',
    strict: true,
    input_schema: objectSchema({ keyOrId: { type: 'string', description: 'Task key like WEB-12, or a task id' } }),
  },
  {
    name: 'get_project_overview',
    description: 'Project details, progress, health score with reasons, velocity and workload. Find the project by id, name or key.',
    strict: true,
    input_schema: objectSchema({
      projectId: nullable('string', 'Project id, or null'),
      name: nullable('string', 'Project name or key, used when the id is unknown'),
    }),
  },
  {
    name: 'get_workload',
    description: 'Per-member open, in-progress and overdue task counts for the workspace or one project.',
    strict: true,
    input_schema: objectSchema({ projectId: nullable('string', 'Project id, or null for the whole workspace') }),
  },
  {
    name: 'recent_activity',
    description: 'Recent activity feed (task changes, comments, documents, members) for the workspace or one project.',
    strict: true,
    input_schema: objectSchema({
      projectId: nullable('string', 'Project id, or null for the workspace'),
      sinceDays: nullable('integer', 'Look back this many days (default 7, at most 30)'),
    }),
  },
  {
    name: 'get_document',
    description: 'The plain text of a document, by id or title. Long documents are truncated.',
    strict: true,
    input_schema: objectSchema({
      documentId: nullable('string', 'Document id, or null'),
      title: nullable('string', 'Document title, used when the id is unknown'),
    }),
  },
];

// ---------- input validation (tolerant parsers never reach a handler unchecked) ----------

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'invalid id');
const inputs = {
  search_workspace: z.object({
    query: z.string().min(1).max(500),
    sourceTypes: z.array(z.enum(CHUNK_SOURCE_TYPES)).nullable(),
    projectId: objectId.nullable(),
  }),
  list_tasks: z.object({
    projectId: objectId.nullable(),
    status: z.enum(TASK_STATUSES).nullable(),
    assignee: z.string().max(100).nullable(),
    overdue: z.boolean().nullable(),
    dueWithinDays: z.number().int().min(0).max(365).nullable(),
    priority: z.enum(TASK_PRIORITIES).nullable(),
    limit: z.number().int().min(1).max(50).nullable(),
  }),
  get_task: z.object({ keyOrId: z.string().min(1).max(64) }),
  get_project_overview: z.object({ projectId: objectId.nullable(), name: z.string().max(100).nullable() }),
  get_workload: z.object({ projectId: objectId.nullable() }),
  recent_activity: z.object({ projectId: objectId.nullable(), sinceDays: z.number().int().min(1).max(30).nullable() }),
  get_document: z.object({ documentId: objectId.nullable(), title: z.string().max(200).nullable() }),
};
type ToolName = keyof typeof inputs;

export class ToolInputError extends Error {}

// ---------- helpers ----------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Projects the caller can see. */
async function visibleProjects(ctx: ToolContext): Promise<ProjectLean[]> {
  const filter: FilterQuery<ProjectLean> = { workspaceId: new Types.ObjectId(ctx.workspaceId) };
  if (!canSeeAllProjects(ctx.role)) filter.memberIds = new Types.ObjectId(ctx.userId);
  return Project.find(filter).lean();
}

/** Loads a project the caller may access, or null. */
async function accessibleProject(ctx: ToolContext, projectId: string): Promise<ProjectLean | null> {
  const project = await Project.findOne({ _id: projectId, workspaceId: ctx.workspaceId }).lean();
  return project && hasProjectAccess(project, ctx.role, ctx.userId) ? project : null;
}

/** Tools default to the conversation's project when it is project-scoped. */
function scopedProjectId(ctx: ToolContext, explicit: string | null): string | null {
  return explicit ?? (ctx.scope === 'project' ? ctx.scopeId : null);
}

async function workspaceMembers(workspaceId: string): Promise<UserPublicDto[]> {
  const members = await WorkspaceMember.find({ workspaceId }).select('userId').lean();
  const users = await loadUserMap(members.map((m) => m.userId));
  return members.map((m) => users.get(m.userId));
}

function taskSource(ctx: ToolContext, t: Pick<TaskLean, '_id' | 'projectId' | 'key' | 'title' | 'status'>): AiSourceDto {
  return {
    type: 'task',
    id: String(t._id),
    title: `${t.key} ${t.title}`,
    link: links.task(ctx.workspaceId, String(t.projectId), String(t._id)),
    snippet: t.status,
  };
}

function projectSource(ctx: ToolContext, p: ProjectLean): AiSourceDto {
  return { type: 'project', id: String(p._id), title: p.name, link: links.project(ctx.workspaceId, String(p._id)), snippet: p.description };
}

const notFound = (what: string): ToolOutcome => ({
  result: { error: `${what} not found or not accessible` },
  label: `Looked for ${what.toLowerCase()}`,
  resultCount: 0,
  sources: [],
});

// ---------- handlers ----------

async function searchWorkspace(ctx: ToolContext, input: z.infer<typeof inputs.search_workspace>): Promise<ToolOutcome> {
  const items = await retrieve({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    role: ctx.role,
    query: input.query,
    projectId: scopedProjectId(ctx, input.projectId),
    sourceTypes: input.sourceTypes ?? undefined,
    limit: 8,
  });
  return {
    result: items.map((i) => ({ type: i.sourceType, id: i.sourceId, title: i.title, text: i.text })),
    label: `Searched the workspace for “${input.query}”`,
    resultCount: items.length,
    sources: items.map(toSourceDto),
  };
}

async function listTasks(ctx: ToolContext, input: z.infer<typeof inputs.list_tasks>): Promise<ToolOutcome> {
  const projectId = scopedProjectId(ctx, input.projectId);
  let projects: ProjectLean[];
  if (projectId) {
    const project = await accessibleProject(ctx, projectId);
    if (!project) return notFound('Project');
    projects = [project];
  } else {
    projects = await visibleProjects(ctx);
  }
  const byId = new Map(projects.map((p) => [String(p._id), p]));
  const filter: FilterQuery<ITask> = { projectId: { $in: projects.map((p) => p._id) } };
  const and: FilterQuery<ITask>[] = [];
  const now = new Date();

  if (input.status) filter.status = input.status;
  if (input.priority) filter.priority = input.priority;
  if (input.overdue) and.push({ dueDate: { $ne: null, $lt: now }, status: { $ne: 'DONE' } });
  if (input.dueWithinDays !== null) {
    and.push({ dueDate: { $ne: null, $gte: now, $lte: new Date(now.getTime() + input.dueWithinDays * DAY_MS) }, status: { $ne: 'DONE' } });
  }
  if (input.assignee) {
    if (input.assignee.toLowerCase() === 'me') {
      filter.assigneeId = new Types.ObjectId(ctx.userId);
    } else {
      const needle = input.assignee.toLowerCase();
      const matches = (await workspaceMembers(ctx.workspaceId)).filter((u) => u.name.toLowerCase().includes(needle));
      if (!matches.length) {
        return { result: { tasks: [], note: `No workspace member matches “${input.assignee}”` }, label: `Listed tasks for ${input.assignee}`, resultCount: 0, sources: [] };
      }
      filter.assigneeId = { $in: matches.map((u) => new Types.ObjectId(u.id)) };
    }
  }
  if (and.length) filter.$and = and;

  const limit = input.limit ?? 20;
  const [total, tasks] = await Promise.all([
    Task.countDocuments(filter),
    Task.find(filter).sort({ dueDate: 1, updatedAt: -1 }).limit(limit).lean(),
  ]);
  const users = await loadUserMap(tasks.map((t) => t.assigneeId));
  return {
    result: {
      total,
      tasks: tasks.map((t) => ({
        id: String(t._id),
        key: t.key,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assignee: users.getOrNull(t.assigneeId)?.name ?? null,
        dueDate: iso(t.dueDate),
        project: byId.get(String(t.projectId))?.name ?? null,
      })),
    },
    label: 'Listed tasks',
    resultCount: total,
    sources: tasks.slice(0, 8).map((t) => taskSource(ctx, t)),
  };
}

async function getTask(ctx: ToolContext, input: z.infer<typeof inputs.get_task>): Promise<ToolOutcome> {
  const keyOrId = input.keyOrId.trim();
  const task = Types.ObjectId.isValid(keyOrId)
    ? await Task.findOne({ _id: keyOrId, workspaceId: ctx.workspaceId }).lean()
    : await Task.findOne({ key: keyOrId.toUpperCase(), workspaceId: ctx.workspaceId }).lean();
  if (!task) return notFound('Task');
  const project = await accessibleProject(ctx, String(task.projectId));
  if (!project) return notFound('Task');

  const [comments, deps, subtasks] = await Promise.all([
    Comment.find({ taskId: task._id }).sort({ createdAt: -1 }).limit(10).lean(),
    Task.find({ _id: { $in: task.dependsOn } }).select('key title status projectId').lean(),
    Task.find({ parentTaskId: task._id }).select('key title status').lean(),
  ]);
  const users = await loadUserMap([task.assigneeId, task.createdBy, ...comments.map((c) => c.authorId)]);
  return {
    result: {
      id: String(task._id),
      key: task.key,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      project: project.name,
      assignee: users.getOrNull(task.assigneeId)?.name ?? null,
      createdBy: users.get(task.createdBy).name,
      dueDate: iso(task.dueDate),
      estimateHours: task.estimateHours,
      checklist: task.checklist.map((c) => ({ text: c.text, done: c.done })),
      dependsOn: deps.map((d) => ({ key: d.key, title: d.title, status: d.status })),
      subtasks: subtasks.map((s) => ({ key: s.key, title: s.title, status: s.status })),
      comments: comments.reverse().map((c) => ({ author: users.get(c.authorId).name, body: c.body.slice(0, 1000), at: iso(c.createdAt) })),
      updatedAt: iso(task.updatedAt),
    },
    label: `Opened ${task.key}`,
    resultCount: 1,
    sources: [taskSource(ctx, task)],
  };
}

async function findProject(ctx: ToolContext, projectId: string | null, name: string | null): Promise<ProjectLean | null> {
  const id = scopedProjectId(ctx, projectId);
  if (id) return accessibleProject(ctx, id);
  if (!name) return null;
  const regex = new RegExp(`^${escapeRegex(name.trim())}$`, 'i');
  const projects = await visibleProjects(ctx);
  return projects.find((p) => regex.test(p.name) || regex.test(p.key)) ??
    projects.find((p) => p.name.toLowerCase().includes(name.trim().toLowerCase())) ??
    null;
}

async function getProjectOverview(ctx: ToolContext, input: z.infer<typeof inputs.get_project_overview>): Promise<ToolOutcome> {
  const project = await findProject(ctx, input.projectId, input.name);
  if (!project) return notFound('Project');
  const analytics = await getProjectAnalytics(project, 4);
  return {
    result: {
      id: String(project._id),
      name: project.name,
      key: project.key,
      description: project.description,
      status: project.status,
      dueDate: iso(project.dueDate),
      memberCount: project.memberIds.length,
      summary: analytics.summary,
      health: analytics.health,
      velocity: analytics.velocity,
      avgCycleTimeDays: analytics.avgCycleTimeDays,
      workload: analytics.workload.map((w) => ({ name: w.user.name, open: w.open, inProgress: w.inProgress, overdue: w.overdue })),
    },
    label: `Reviewed project ${project.name}`,
    resultCount: 1,
    sources: [projectSource(ctx, project)],
  };
}

async function getWorkload(ctx: ToolContext, input: z.infer<typeof inputs.get_workload>): Promise<ToolOutcome> {
  const projectId = scopedProjectId(ctx, input.projectId);
  let rows;
  let label = 'Checked team workload';
  const sources: AiSourceDto[] = [];
  if (projectId) {
    const project = await accessibleProject(ctx, projectId);
    if (!project) return notFound('Project');
    rows = (await getProjectAnalytics(project, 4)).workload;
    label = `Checked workload on ${project.name}`;
    sources.push(projectSource(ctx, project));
  } else {
    rows = (await getWorkspaceAnalytics(ctx.workspaceId, ctx.userId, ctx.role, 4)).workload;
  }
  return {
    result: rows.map((w) => ({ name: w.user.name, open: w.open, inProgress: w.inProgress, overdue: w.overdue, completedLast7Days: w.completedLast7Days })),
    label,
    resultCount: rows.length,
    sources,
  };
}

async function recentActivity(ctx: ToolContext, input: z.infer<typeof inputs.recent_activity>): Promise<ToolOutcome> {
  const days = input.sinceDays ?? 7;
  const filter: FilterQuery<IActivity> = {
    workspaceId: new Types.ObjectId(ctx.workspaceId),
    createdAt: { $gte: new Date(Date.now() - days * DAY_MS) },
  };
  const projectId = scopedProjectId(ctx, input.projectId);
  if (projectId) {
    const project = await accessibleProject(ctx, projectId);
    if (!project) return notFound('Project');
    filter.projectId = project._id;
  } else if (!canSeeAllProjects(ctx.role)) {
    const projects = await visibleProjects(ctx);
    filter.$or = [{ projectId: null }, { projectId: { $in: projects.map((p) => p._id) } }];
  }
  const rows = await Activity.find(filter).sort({ createdAt: -1 }).limit(50).lean();
  const users = await loadUserMap(rows.map((r) => r.actorId));
  return {
    result: rows.map((r) => ({
      type: r.type,
      actor: users.get(r.actorId).name,
      target: r.target ? `${r.target.type}: ${r.target.title}` : null,
      details: r.metadata,
      at: r.createdAt.toISOString(),
    })),
    label: `Read the last ${days} days of activity`,
    resultCount: rows.length,
    sources: [],
  };
}

async function visibleDocumentScope(ctx: ToolContext): Promise<FilterQuery<IDocument>> {
  const ids = await accessibleProjectIds(ctx.workspaceId, ctx.role, ctx.userId);
  return ids ? { $or: [{ projectId: null }, { projectId: { $in: ids } }] } : {};
}

async function getDocument(ctx: ToolContext, input: z.infer<typeof inputs.get_document>): Promise<ToolOutcome> {
  const id = input.documentId ?? (ctx.scope === 'document' && !input.title ? ctx.scopeId : null);
  const ws = new Types.ObjectId(ctx.workspaceId);
  const doc = id
    ? await DocumentModel.findOne({ _id: id, workspaceId: ws }).lean()
    : input.title
      ? await DocumentModel.findOne({
          workspaceId: ws,
          isArchived: false,
          title: new RegExp(escapeRegex(input.title.trim()), 'i'),
          // Only documents the caller can open, so an inaccessible match never shadows a visible one.
          ...(await visibleDocumentScope(ctx)),
        })
          .sort({ updatedAt: -1 })
          .lean()
      : null;
  if (!doc) return notFound('Document');
  try {
    await assertDocumentAccess(doc, ctx.role, ctx.userId);
  } catch {
    return notFound('Document');
  }
  const truncated = doc.contentText.length > DOCUMENT_CHAR_LIMIT;
  return {
    result: {
      id: String(doc._id),
      title: doc.title,
      updatedAt: iso(doc.updatedAt),
      text: doc.contentText.slice(0, DOCUMENT_CHAR_LIMIT),
      ...(truncated ? { note: `Truncated to the first ${DOCUMENT_CHAR_LIMIT} characters of ${doc.contentText.length}` } : {}),
    },
    label: `Read “${doc.title}”`,
    resultCount: 1,
    sources: [{ type: 'document', id: String(doc._id), title: doc.title, link: links.document(ctx.workspaceId, String(doc._id)), snippet: null }],
  };
}

const handlers: { [K in ToolName]: (ctx: ToolContext, input: z.infer<(typeof inputs)[K]>) => Promise<ToolOutcome> } = {
  search_workspace: searchWorkspace,
  list_tasks: listTasks,
  get_task: getTask,
  get_project_overview: getProjectOverview,
  get_workload: getWorkload,
  recent_activity: recentActivity,
  get_document: getDocument,
};

function isToolName(name: string): name is ToolName {
  return name in handlers;
}

/** Validates the model's input and runs the tool. Throws ToolInputError for bad input. */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!isToolName(name)) throw new ToolInputError(`Unknown tool: ${name}`);
  const parsed = inputs[name].safeParse(rawInput);
  if (!parsed.success) throw new ToolInputError(`Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const handler = handlers[name] as (ctx: ToolContext, input: unknown) => Promise<ToolOutcome>;
  return handler(ctx, parsed.data);
}

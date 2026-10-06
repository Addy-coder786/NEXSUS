import { randomUUID } from 'node:crypto';
import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  ROLE_RANK,
  TASK_PRIORITIES,
  type CreateTaskInput,
  type MoveTaskInput,
  type PaginationMeta,
  type TaskDto,
  type TaskListQuery,
  type TaskStatus,
  type UpdateTaskInput,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { Comment } from '../../models/Comment';
import { nextSequence, taskCounterKey } from '../../models/Counter';
import { toLabelDto, type ProjectLean } from '../../models/Project';
import { POSITION_GAP, Task, toTaskDto, type IChecklistItem, type ITask, type TaskLean } from '../../models/Task';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { loadUserMap } from '../workspaces/user.lookup';

// ---------- DTO building ----------

type SubtaskRow = { _id: Types.ObjectId; total: number; done: number };
type CommentRow = { _id: Types.ObjectId; count: number };

export async function buildTaskDtos(tasks: TaskLean[], project: ProjectLean): Promise<TaskDto[]> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t._id);

  const [users, subtaskRows, commentRows] = await Promise.all([
    loadUserMap(tasks.flatMap((t) => [t.createdBy, t.assigneeId])),
    Task.aggregate<SubtaskRow>([
      { $match: { parentTaskId: { $in: ids } } },
      {
        $group: {
          _id: '$parentTaskId',
          total: { $sum: 1 },
          done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
        },
      },
    ]),
    Comment.aggregate<CommentRow>([
      { $match: { taskId: { $in: ids } } },
      { $group: { _id: '$taskId', count: { $sum: 1 } } },
    ]),
  ]);

  const subtasks = new Map(subtaskRows.map((r) => [String(r._id), r]));
  const comments = new Map(commentRows.map((r) => [String(r._id), r.count]));
  const labels = new Map(project.labels.map((l) => [String(l._id), toLabelDto(l)]));

  return tasks.map((t) => {
    const id = String(t._id);
    const sub = subtasks.get(id);
    return toTaskDto(t, {
      assignee: users.getOrNull(t.assigneeId),
      createdBy: users.get(t.createdBy),
      labels: t.labelIds.flatMap((lid) => {
        const label = labels.get(String(lid));
        return label ? [label] : [];
      }),
      subtaskCount: sub?.total ?? 0,
      subtaskDoneCount: sub?.done ?? 0,
      commentCount: comments.get(id) ?? 0,
    });
  });
}

export async function buildTaskDto(task: TaskLean, project: ProjectLean): Promise<TaskDto> {
  const [dto] = await buildTaskDtos([task], project);
  if (!dto) throw ApiError.internal();
  return dto;
}

async function reloadTask(taskId: Types.ObjectId): Promise<TaskLean> {
  const task = await Task.findById(taskId).lean();
  if (!task) throw ApiError.notFound('Task');
  return task;
}

// ---------- validation helpers ----------

function assertAssignee(project: ProjectLean, assigneeId: string | null | undefined): void {
  if (!assigneeId) return;
  if (!project.memberIds.some((m) => String(m) === assigneeId)) {
    throw ApiError.badRequest('Assignee must be a member of the project');
  }
}

function assertLabels(project: ProjectLean, labelIds: string[] | undefined): Types.ObjectId[] | undefined {
  if (labelIds === undefined) return undefined;
  const known = new Set(project.labels.map((l) => String(l._id)));
  const unique = [...new Set(labelIds)];
  for (const id of unique) {
    if (!known.has(id)) throw ApiError.badRequest('Unknown label for this project');
  }
  return unique.map((id) => new Types.ObjectId(id));
}

/** Validates a parent: same project, not itself, not a subtask (one level only). */
async function resolveParent(
  project: ProjectLean,
  parentTaskId: string | null | undefined,
  self?: TaskLean,
): Promise<Types.ObjectId | null | undefined> {
  if (parentTaskId === undefined) return undefined;
  if (parentTaskId === null) return null;
  if (self && String(self._id) === parentTaskId) {
    throw ApiError.badRequest('A task cannot be its own parent');
  }
  const parent = await Task.findOne({ _id: parentTaskId, projectId: project._id })
    .select('parentTaskId')
    .lean();
  if (!parent) throw ApiError.badRequest('Parent task must belong to the same project');
  if (parent.parentTaskId) throw ApiError.badRequest('Subtasks cannot be nested');
  if (self) {
    const hasChildren = await Task.exists({ parentTaskId: self._id });
    if (hasChildren) throw ApiError.badRequest('A task with subtasks cannot become a subtask');
  }
  return parent._id;
}

/** Validates dependencies: same project, no self-dependency, no direct cycle. */
async function resolveDependsOn(
  project: ProjectLean,
  dependsOn: string[] | undefined,
  self?: TaskLean,
): Promise<Types.ObjectId[] | undefined> {
  if (dependsOn === undefined) return undefined;
  const unique = [...new Set(dependsOn)];
  if (unique.length === 0) return [];
  if (self && unique.includes(String(self._id))) {
    throw ApiError.badRequest('A task cannot depend on itself');
  }
  const deps = await Task.find({ _id: { $in: unique }, projectId: project._id })
    .select('dependsOn')
    .lean();
  if (deps.length !== unique.length) {
    throw ApiError.badRequest('Dependencies must be tasks in the same project');
  }
  if (self) {
    const selfId = String(self._id);
    for (const dep of deps) {
      if (dep.dependsOn.some((d) => String(d) === selfId)) {
        throw ApiError.badRequest(`Dependency cycle: task ${String(dep._id)} already depends on this task`);
      }
    }
  }
  return deps.map((d) => d._id);
}

function normalizeChecklist(
  items: CreateTaskInput['checklist'],
): IChecklistItem[] | undefined {
  if (items === undefined) return undefined;
  return items.map((i) => ({ id: i.id ?? randomUUID(), text: i.text, done: i.done }));
}

/** `max(position in column) + 1024`. */
export async function nextPosition(projectId: Types.ObjectId, status: TaskStatus): Promise<number> {
  const last = await Task.findOne({ projectId, status })
    .sort({ position: -1 })
    .select('position')
    .lean();
  return (last?.position ?? 0) + POSITION_GAP;
}

// ---------- create ----------

export async function createTask(
  project: ProjectLean,
  actorId: string,
  input: CreateTaskInput,
): Promise<TaskDto> {
  assertAssignee(project, input.assigneeId);
  const labelIds = assertLabels(project, input.labelIds) ?? [];
  const parentTaskId = (await resolveParent(project, input.parentTaskId)) ?? null;
  const dependsOn = (await resolveDependsOn(project, input.dependsOn)) ?? [];

  const number = await nextSequence(taskCounterKey(project._id));
  const position = await nextPosition(project._id, input.status);

  const task = await Task.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    number,
    key: `${project.key}-${number}`,
    title: input.title,
    description: input.description ?? null,
    status: input.status,
    priority: input.priority,
    position,
    assigneeId: input.assigneeId ? new Types.ObjectId(input.assigneeId) : null,
    createdBy: new Types.ObjectId(actorId),
    labelIds,
    dueDate: input.dueDate ?? null,
    startDate: input.startDate ?? null,
    estimateHours: input.estimateHours ?? null,
    parentTaskId,
    checklist: normalizeChecklist(input.checklist) ?? [],
    dependsOn,
    completedAt: input.status === 'DONE' ? new Date() : null,
  });

  const target = { type: 'task' as const, id: task._id, title: task.title };
  const base = { workspaceId: project.workspaceId, projectId: project._id, actorId, target };

  await recordActivity({ ...base, type: 'TASK_CREATED', metadata: { key: task.key, status: task.status } });
  if (task.assigneeId) {
    await recordActivity({
      ...base,
      type: 'TASK_ASSIGNED',
      metadata: { key: task.key, from: null, to: String(task.assigneeId) },
    });
  }
  if (task.status === 'DONE') {
    await recordActivity({ ...base, type: 'TASK_COMPLETED', metadata: { key: task.key } });
  }

  const dto = await buildTaskDto(task.toObject(), project);
  events.emit('task.created', { task: dto, actorId });
  return dto;
}

// ---------- list ----------

const PRIORITY_RANK = [...TASK_PRIORITIES];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildTaskFilter(
  project: ProjectLean,
  userId: string,
  query: TaskListQuery,
): FilterQuery<ITask> {
  const filter: FilterQuery<ITask> = { projectId: project._id };
  const and: FilterQuery<ITask>[] = [];

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.labelId) filter.labelIds = new Types.ObjectId(query.labelId);

  if (query.assigneeId === 'me') filter.assigneeId = new Types.ObjectId(userId);
  else if (query.assigneeId === 'unassigned') filter.assigneeId = null;
  else if (query.assigneeId) filter.assigneeId = new Types.ObjectId(query.assigneeId);

  if (query.parentTaskId === 'none') filter.parentTaskId = null;
  else if (query.parentTaskId) filter.parentTaskId = new Types.ObjectId(query.parentTaskId);

  if (query.dueBefore) and.push({ dueDate: { $ne: null, $lt: query.dueBefore } });
  if (query.overdue) and.push({ dueDate: { $ne: null, $lt: new Date() }, status: { $ne: 'DONE' } });

  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    and.push({ $or: [{ title: regex }, { description: regex }, { key: regex }] });
  }

  if (and.length) filter.$and = and;
  return filter;
}

export async function listTasks(
  project: ProjectLean,
  userId: string,
  query: TaskListQuery,
): Promise<{ items: TaskDto[]; meta: PaginationMeta }> {
  const filter = buildTaskFilter(project, userId, query);
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const direction = query.order === 'desc' ? -1 : 1;

  const total = await Task.countDocuments(filter);

  let tasks: TaskLean[];
  if (query.sort === 'priority') {
    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $addFields: { _priorityRank: { $indexOfArray: [PRIORITY_RANK, '$priority'] } } },
      // PRIORITY_RANK is LOW..URGENT, so `desc` (URGENT first) is a descending rank sort.
      { $sort: { _priorityRank: direction, position: 1, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { _priorityRank: 0 } },
    ];
    tasks = await Task.aggregate<TaskLean>(pipeline);
  } else {
    const sort: Record<string, 1 | -1> = { [query.sort]: direction, _id: 1 };
    tasks = await Task.find(filter).sort(sort).skip(skip).limit(limit).lean();
  }

  return { items: await buildTaskDtos(tasks, project), meta: paginationMeta(page, limit, total) };
}

export async function listSubtasks(task: TaskLean, project: ProjectLean): Promise<TaskDto[]> {
  const subtasks = await Task.find({ projectId: project._id, parentTaskId: task._id })
    .sort({ position: 1, createdAt: 1 })
    .lean();
  return buildTaskDtos(subtasks, project);
}

// ---------- update ----------

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

const dateValue = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const idValue = (id: Types.ObjectId | null | undefined) => (id ? String(id) : null);
const sameIds = (a: Types.ObjectId[], b: Types.ObjectId[]) =>
  a.length === b.length && a.every((x, i) => String(x) === String(b[i]));

export async function updateTask(
  task: TaskLean,
  project: ProjectLean,
  actorId: string,
  input: UpdateTaskInput,
): Promise<TaskDto> {
  assertAssignee(project, input.assigneeId);
  const labelIds = assertLabels(project, input.labelIds);
  const parentTaskId = await resolveParent(project, input.parentTaskId, task);
  const dependsOn = await resolveDependsOn(project, input.dependsOn, task);
  const checklist = normalizeChecklist(input.checklist);

  const $set: Record<string, unknown> = {};
  const changes: FieldChange[] = [];
  const change = (field: string, from: unknown, to: unknown) => changes.push({ field, from, to });

  if (input.title !== undefined && input.title !== task.title) {
    $set.title = input.title;
    change('title', task.title, input.title);
  }
  if (input.description !== undefined && input.description !== task.description) {
    $set.description = input.description;
    change('description', null, null);
  }
  if (input.status !== undefined && input.status !== task.status) {
    $set.status = input.status;
    change('status', task.status, input.status);
    if (input.status === 'DONE') $set.completedAt = new Date();
    else if (task.status === 'DONE') $set.completedAt = null;
    $set.position = await nextPosition(project._id, input.status);
  }
  if (input.priority !== undefined && input.priority !== task.priority) {
    $set.priority = input.priority;
    change('priority', task.priority, input.priority);
  }
  if (input.assigneeId !== undefined && input.assigneeId !== idValue(task.assigneeId)) {
    $set.assigneeId = input.assigneeId ? new Types.ObjectId(input.assigneeId) : null;
    change('assigneeId', idValue(task.assigneeId), input.assigneeId);
  }
  if (input.dueDate !== undefined && dateValue(input.dueDate) !== dateValue(task.dueDate)) {
    $set.dueDate = input.dueDate;
    change('dueDate', dateValue(task.dueDate), dateValue(input.dueDate));
  }
  if (input.startDate !== undefined && dateValue(input.startDate) !== dateValue(task.startDate)) {
    $set.startDate = input.startDate;
    change('startDate', dateValue(task.startDate), dateValue(input.startDate));
  }
  if (input.estimateHours !== undefined && input.estimateHours !== task.estimateHours) {
    $set.estimateHours = input.estimateHours;
    change('estimateHours', task.estimateHours, input.estimateHours);
  }
  if (labelIds !== undefined && !sameIds(labelIds, task.labelIds)) {
    $set.labelIds = labelIds;
    change('labels', task.labelIds.map(String), labelIds.map(String));
  }
  if (parentTaskId !== undefined && idValue(parentTaskId) !== idValue(task.parentTaskId)) {
    $set.parentTaskId = parentTaskId;
    change('parentTaskId', idValue(task.parentTaskId), idValue(parentTaskId));
  }
  if (dependsOn !== undefined && !sameIds(dependsOn, task.dependsOn)) {
    $set.dependsOn = dependsOn;
    change('dependsOn', task.dependsOn.map(String), dependsOn.map(String));
  }
  if (checklist !== undefined) {
    $set.checklist = checklist;
  }

  if (Object.keys($set).length === 0) return buildTaskDto(task, project);

  await Task.updateOne({ _id: task._id }, { $set });
  const updated = await reloadTask(task._id);

  const target = { type: 'task' as const, id: task._id, title: updated.title };
  const base = { workspaceId: project.workspaceId, projectId: project._id, actorId, target };

  if (changes.length) {
    await recordActivity({ ...base, type: 'TASK_UPDATED', metadata: { key: updated.key, changes } });
  }
  const assigneeChange = changes.find((c) => c.field === 'assigneeId');
  if (assigneeChange) {
    await recordActivity({
      ...base,
      type: 'TASK_ASSIGNED',
      metadata: { key: updated.key, from: assigneeChange.from, to: assigneeChange.to },
    });
  }
  const statusChange = changes.find((c) => c.field === 'status');
  if (statusChange && statusChange.to === 'DONE') {
    await recordActivity({ ...base, type: 'TASK_COMPLETED', metadata: { key: updated.key } });
  }

  const dto = await buildTaskDto(updated, project);
  events.emit('task.updated', { task: dto, actorId, changes });
  return dto;
}

// ---------- move ----------

export async function moveTask(
  task: TaskLean,
  project: ProjectLean,
  actorId: string,
  input: MoveTaskInput,
): Promise<TaskDto> {
  const position = input.position ?? (await nextPosition(project._id, input.status));
  const $set: Record<string, unknown> = { status: input.status, position };
  if (input.status === 'DONE' && task.status !== 'DONE') $set.completedAt = new Date();
  if (input.status !== 'DONE' && task.status === 'DONE') $set.completedAt = null;

  await Task.updateOne({ _id: task._id }, { $set });
  const updated = await reloadTask(task._id);

  const target = { type: 'task' as const, id: task._id, title: updated.title };
  const base = { workspaceId: project.workspaceId, projectId: project._id, actorId, target };

  await recordActivity({
    ...base,
    type: 'TASK_MOVED',
    metadata: { key: updated.key, from: task.status, to: input.status, position },
  });
  if (input.status === 'DONE' && task.status !== 'DONE') {
    await recordActivity({ ...base, type: 'TASK_COMPLETED', metadata: { key: updated.key } });
  }
  const dto = await buildTaskDto(updated, project);
  events.emit('task.moved', { task: dto, actorId, from: task.status, to: input.status });
  return dto;
}

// ---------- delete ----------

export function canDeleteTask(task: TaskLean, userId: string, role: WorkspaceRole): boolean {
  if (ROLE_RANK[role] >= ROLE_RANK.MANAGER) return true;
  if (String(task.createdBy) === userId) return true;
  return task.assigneeId !== null && String(task.assigneeId) === userId;
}

/** Deletes the task, its subtasks and all their comments; drops it from other tasks' dependencies. */
export async function deleteTask(
  task: TaskLean,
  project: ProjectLean,
  actorId: string,
  role: WorkspaceRole,
): Promise<void> {
  if (!canDeleteTask(task, actorId, role)) {
    throw ApiError.forbidden('Only the creator, the assignee or a manager can delete this task');
  }

  const subtasks = await Task.find({ parentTaskId: task._id }).select('_id').lean();
  const ids = [task._id, ...subtasks.map((s) => s._id)];

  await Promise.all([
    Comment.deleteMany({ taskId: { $in: ids } }),
    Task.updateMany({ projectId: project._id, dependsOn: { $in: ids } }, { $pull: { dependsOn: { $in: ids } } }),
  ]);
  await Task.deleteMany({ _id: { $in: ids } });

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'TASK_DELETED',
    target: { type: 'task', id: task._id, title: task.title },
    metadata: { key: task.key, subtasksDeleted: subtasks.length },
  });
  events.emit('task.deleted', {
    workspaceId: String(project.workspaceId),
    projectId: String(project._id),
    taskId: String(task._id),
    actorId,
  });
}

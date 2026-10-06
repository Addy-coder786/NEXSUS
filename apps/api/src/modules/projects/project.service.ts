import { Types } from 'mongoose';
import {
  type AddProjectMembersInput,
  type CreateLabelInput,
  type CreateProjectInput,
  type LabelDto,
  type ProjectDto,
  type UpdateLabelInput,
  type UpdateProjectInput,
  type WorkspaceRole,
} from '@nexus/shared';
import { events, type FieldChange } from '../../events';
import { canSeeAllProjects } from '../../middleware/authorize';
import { Comment } from '../../models/Comment';
import {
  DEFAULT_PROJECT_COLOR,
  Project,
  toLabelDto,
  toProjectDto,
  type ProjectLean,
} from '../../models/Project';
import { Task } from '../../models/Task';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { loadUserMap } from '../workspaces/user.lookup';
import { assertWorkspaceMembers } from '../workspaces/workspace.service';

// ---------- key generation ----------

const KEY_MAX = 10;

/** Uppercase initials of the words in `name`; falls back to the first letters of the name. */
export function keyFromName(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let key = words
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .replace(/^[0-9]+/, '')
    .slice(0, KEY_MAX);

  if (key.length < 2) {
    key = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^[0-9]+/, '')
      .slice(0, 3);
  }
  if (key.length < 2) key = 'PRJ';
  return key;
}

/** Appends digits until the key is unique within the workspace. */
export async function uniqueProjectKey(workspaceId: Types.ObjectId | string, base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await Project.exists({ workspaceId, key: candidate })) {
    const suffix = String(n);
    candidate = `${base.slice(0, KEY_MAX - suffix.length)}${suffix}`;
    n += 1;
  }
  return candidate;
}

// ---------- DTO building ----------

type TaskCountRow = { _id: { projectId: Types.ObjectId; status: string }; count: number };

async function taskCountsByProject(projectIds: Types.ObjectId[]): Promise<Map<string, Record<string, number>>> {
  const result = new Map<string, Record<string, number>>();
  if (projectIds.length === 0) return result;

  const rows = await Task.aggregate<TaskCountRow>([
    { $match: { projectId: { $in: projectIds } } },
    { $group: { _id: { projectId: '$projectId', status: '$status' }, count: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    const key = String(row._id.projectId);
    const counts = result.get(key) ?? {};
    counts[row._id.status] = row.count;
    result.set(key, counts);
  }
  return result;
}

export async function buildProjectDtos(projects: ProjectLean[]): Promise<ProjectDto[]> {
  if (projects.length === 0) return [];
  const userRefs = projects.flatMap((p) => [p.createdBy, ...p.memberIds]);
  const [users, counts] = await Promise.all([
    loadUserMap(userRefs),
    taskCountsByProject(projects.map((p) => p._id)),
  ]);
  return projects.map((p) =>
    toProjectDto(
      p,
      users.get(p.createdBy),
      p.memberIds.map((id) => users.get(id)),
      counts.get(String(p._id)) ?? {},
    ),
  );
}

export async function buildProjectDto(project: ProjectLean): Promise<ProjectDto> {
  const [dto] = await buildProjectDtos([project]);
  if (!dto) throw ApiError.internal();
  return dto;
}

async function reloadProject(projectId: Types.ObjectId | string): Promise<ProjectLean> {
  const project = await Project.findById(projectId).lean();
  if (!project) throw ApiError.notFound('Project');
  return project;
}

// ---------- projects ----------

export async function createProject(
  workspaceId: string,
  actorId: string,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  let key: string;
  if (input.key) {
    if (await Project.exists({ workspaceId, key: input.key })) {
      throw ApiError.conflict('Project key already in use');
    }
    key = input.key;
  } else {
    key = await uniqueProjectKey(workspaceId, keyFromName(input.name));
  }

  const extraMembers = (input.memberIds ?? []).filter((id) => id !== actorId);
  await assertWorkspaceMembers(workspaceId, extraMembers);
  const memberIds = [actorId, ...new Set(extraMembers)].map((id) => new Types.ObjectId(id));

  const project = await Project.create({
    workspaceId: new Types.ObjectId(workspaceId),
    name: input.name,
    key,
    description: input.description ?? null,
    color: input.color ?? DEFAULT_PROJECT_COLOR,
    startDate: input.startDate ?? null,
    dueDate: input.dueDate ?? null,
    createdBy: new Types.ObjectId(actorId),
    memberIds,
    labels: [],
  });

  await recordActivity({
    workspaceId,
    projectId: project._id,
    actorId,
    type: 'PROJECT_CREATED',
    target: { type: 'project', id: project._id, title: project.name },
    metadata: { key },
  });

  const dto = await buildProjectDto(project.toObject());
  events.emit('project.created', { project: dto, actorId });
  return dto;
}

export async function listProjects(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<ProjectDto[]> {
  const filter: Record<string, unknown> = { workspaceId };
  if (!canSeeAllProjects(role)) filter.memberIds = new Types.ObjectId(userId);
  const projects = await Project.find(filter).sort({ createdAt: 1 }).lean();
  return buildProjectDtos(projects);
}

export async function updateProject(
  project: ProjectLean,
  actorId: string,
  input: UpdateProjectInput,
): Promise<ProjectDto> {
  const $set: Record<string, unknown> = {};
  const fields: string[] = [];
  const changes: FieldChange[] = [];
  const serialize = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));
  const consider = (field: string, next: unknown, current: unknown) => {
    if (next === undefined) return;
    const a = next instanceof Date ? next.getTime() : next;
    const b = current instanceof Date ? current.getTime() : current;
    if (a === b) return;
    $set[field] = next;
    fields.push(field);
    changes.push({ field, from: serialize(current), to: serialize(next) });
  };

  consider('name', input.name, project.name);
  consider('description', input.description, project.description);
  consider('color', input.color, project.color);
  consider('status', input.status, project.status);
  consider('startDate', input.startDate, project.startDate);
  consider('dueDate', input.dueDate, project.dueDate);

  if (fields.length === 0) return buildProjectDto(project);

  await Project.updateOne({ _id: project._id }, { $set });
  const updated = await reloadProject(project._id);

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'PROJECT_UPDATED',
    target: { type: 'project', id: project._id, title: updated.name },
    metadata: { fields },
  });
  const dto = await buildProjectDto(updated);
  events.emit('project.updated', { project: dto, actorId, changes });
  return dto;
}

export async function deleteProject(project: ProjectLean, actorId: string): Promise<void> {
  await Promise.all([
    Comment.deleteMany({ projectId: project._id }),
    Task.deleteMany({ projectId: project._id }),
  ]);
  await Project.deleteOne({ _id: project._id });

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'PROJECT_DELETED',
    target: { type: 'project', id: project._id, title: project.name },
    metadata: { key: project.key },
  });
  events.emit('project.deleted', { workspaceId: String(project.workspaceId), projectId: String(project._id), actorId });
}

// ---------- members ----------

export async function addProjectMembers(
  project: ProjectLean,
  actorId: string,
  input: AddProjectMembersInput,
): Promise<ProjectDto> {
  const existing = new Set(project.memberIds.map((m) => String(m)));
  const toAdd = [...new Set(input.userIds)].filter((id) => !existing.has(id));
  if (toAdd.length === 0) return buildProjectDto(project);

  await assertWorkspaceMembers(project.workspaceId, toAdd);
  await Project.updateOne(
    { _id: project._id },
    { $addToSet: { memberIds: { $each: toAdd.map((id) => new Types.ObjectId(id)) } } },
  );

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'PROJECT_MEMBER_ADDED',
    target: { type: 'project', id: project._id, title: project.name },
    metadata: { userIds: toAdd },
  });
  return buildProjectDto(await reloadProject(project._id));
}

export async function removeProjectMember(
  project: ProjectLean,
  actorId: string,
  userId: string,
): Promise<ProjectDto> {
  if (!project.memberIds.some((m) => String(m) === userId)) throw ApiError.notFound('Project member');

  const userObjectId = new Types.ObjectId(userId);
  await Promise.all([
    Project.updateOne({ _id: project._id }, { $pull: { memberIds: userObjectId } }),
    Task.updateMany({ projectId: project._id, assigneeId: userObjectId }, { $set: { assigneeId: null } }),
  ]);

  await recordActivity({
    workspaceId: project.workspaceId,
    projectId: project._id,
    actorId,
    type: 'PROJECT_MEMBER_REMOVED',
    target: { type: 'project', id: project._id, title: project.name },
    metadata: { userIds: [userId] },
  });
  return buildProjectDto(await reloadProject(project._id));
}

// ---------- labels ----------

export function listLabels(project: ProjectLean): LabelDto[] {
  return project.labels.map(toLabelDto);
}

export async function createLabel(project: ProjectLean, input: CreateLabelInput): Promise<LabelDto> {
  const duplicate = project.labels.some((l) => l.name.toLowerCase() === input.name.toLowerCase());
  if (duplicate) throw ApiError.conflict('A label with this name already exists');

  const label = { _id: new Types.ObjectId(), name: input.name, color: input.color };
  await Project.updateOne({ _id: project._id }, { $push: { labels: label } });
  return toLabelDto(label);
}

export async function updateLabel(
  project: ProjectLean,
  labelId: string,
  input: UpdateLabelInput,
): Promise<LabelDto> {
  const label = project.labels.find((l) => String(l._id) === labelId);
  if (!label) throw ApiError.notFound('Label');

  if (input.name !== undefined) {
    const duplicate = project.labels.some(
      (l) => String(l._id) !== labelId && l.name.toLowerCase() === input.name?.toLowerCase(),
    );
    if (duplicate) throw ApiError.conflict('A label with this name already exists');
  }

  const $set: Record<string, unknown> = {};
  if (input.name !== undefined) $set['labels.$.name'] = input.name;
  if (input.color !== undefined) $set['labels.$.color'] = input.color;
  if (Object.keys($set).length) {
    await Project.updateOne({ _id: project._id, 'labels._id': label._id }, { $set });
  }
  return toLabelDto({
    _id: label._id,
    name: input.name ?? label.name,
    color: input.color ?? label.color,
  });
}

/** Removes the label from the project and from every task that carries it. */
export async function deleteLabel(project: ProjectLean, labelId: string): Promise<void> {
  const label = project.labels.find((l) => String(l._id) === labelId);
  if (!label) throw ApiError.notFound('Label');

  await Promise.all([
    Project.updateOne({ _id: project._id }, { $pull: { labels: { _id: label._id } } }),
    Task.updateMany({ projectId: project._id }, { $pull: { labelIds: label._id } }),
  ]);
}

import { Types } from 'mongoose';
import {
  ROLE_RANK,
  canAssignRole,
  hasPermission,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type WorkspaceDto,
  type WorkspaceMemberDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { invalidateMembership } from '../../middleware/authorize';
import { Activity } from '../../models/Activity';
import { Comment } from '../../models/Comment';
import { Invitation } from '../../models/Invitation';
import { Project } from '../../models/Project';
import { Task } from '../../models/Task';
import { User } from '../../models/User';
import { Workspace, toWorkspaceDto, type WorkspaceLean } from '../../models/Workspace';
import { WorkspaceMember, toWorkspaceMemberDto } from '../../models/WorkspaceMember';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { loadUserMap } from './user.lookup';

// ---------- slug helpers ----------

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

/** Returns `base`, or `base-2`, `base-3`, ... until the slug is free. */
export async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await Workspace.exists({ slug: candidate })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

// ---------- read helpers ----------

export async function findWorkspaceOrThrow(workspaceId: string): Promise<WorkspaceLean> {
  const ws = await Workspace.findById(workspaceId).lean();
  if (!ws) throw ApiError.notFound('Workspace');
  return ws;
}

export async function countMembers(workspaceId: Types.ObjectId | string): Promise<number> {
  return WorkspaceMember.countDocuments({ workspaceId });
}

export async function workspaceDtoFor(ws: WorkspaceLean, role: WorkspaceRole): Promise<WorkspaceDto> {
  return toWorkspaceDto(ws, role, await countMembers(ws._id));
}

// ---------- workspaces ----------

export async function createWorkspace(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceDto> {
  let slug: string;
  if (input.slug) {
    if (await Workspace.exists({ slug: input.slug })) throw ApiError.conflict('Slug already in use');
    slug = input.slug;
  } else {
    slug = await uniqueSlug(slugify(input.name));
  }

  const ws = await Workspace.create({
    name: input.name,
    slug,
    description: input.description ?? null,
    ownerId: new Types.ObjectId(userId),
  });
  await WorkspaceMember.create({ workspaceId: ws._id, userId: ws.ownerId, role: 'OWNER' });

  await recordActivity({
    workspaceId: ws._id,
    actorId: userId,
    type: 'WORKSPACE_CREATED',
    target: { type: 'workspace', id: ws._id, title: ws.name },
  });

  events.emit('workspace.created', { workspaceId: String(ws._id), ownerId: userId, name: ws.name });
  return toWorkspaceDto(ws.toObject(), 'OWNER', 1);
}

export async function listWorkspaces(userId: string): Promise<WorkspaceDto[]> {
  const memberships = await WorkspaceMember.find({ userId }).lean();
  if (memberships.length === 0) return [];

  const ids = memberships.map((m) => m.workspaceId);
  const [workspaces, counts] = await Promise.all([
    Workspace.find({ _id: { $in: ids } })
      .sort({ createdAt: 1 })
      .lean(),
    WorkspaceMember.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { workspaceId: { $in: ids } } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]),
  ]);

  const roleByWs = new Map(memberships.map((m) => [String(m.workspaceId), m.role]));
  const countByWs = new Map(counts.map((c) => [String(c._id), c.count]));

  return workspaces.map((ws) =>
    toWorkspaceDto(ws, roleByWs.get(String(ws._id)) ?? 'VIEWER', countByWs.get(String(ws._id)) ?? 0),
  );
}

export async function getWorkspace(workspaceId: string, role: WorkspaceRole): Promise<WorkspaceDto> {
  const ws = await findWorkspaceOrThrow(workspaceId);
  return workspaceDtoFor(ws, role);
}

export async function updateWorkspace(
  workspaceId: string,
  actorId: string,
  role: WorkspaceRole,
  input: UpdateWorkspaceInput,
): Promise<WorkspaceDto> {
  const ws = await Workspace.findById(workspaceId);
  if (!ws) throw ApiError.notFound('Workspace');

  const changes: string[] = [];
  if (input.name !== undefined && input.name !== ws.name) {
    ws.name = input.name;
    changes.push('name');
  }
  if (input.slug !== undefined && input.slug !== ws.slug) {
    const taken = await Workspace.exists({ slug: input.slug, _id: { $ne: ws._id } });
    if (taken) throw ApiError.conflict('Slug already in use');
    ws.slug = input.slug;
    changes.push('slug');
  }
  if (input.description !== undefined && input.description !== ws.description) {
    ws.description = input.description;
    changes.push('description');
  }
  if (input.logoUrl !== undefined && input.logoUrl !== ws.logoUrl) {
    ws.logoUrl = input.logoUrl;
    changes.push('logoUrl');
  }

  if (changes.length) {
    await ws.save();
    await recordActivity({
      workspaceId: ws._id,
      actorId,
      type: 'WORKSPACE_UPDATED',
      target: { type: 'workspace', id: ws._id, title: ws.name },
      metadata: { fields: changes },
    });
  }
  return workspaceDtoFor(ws.toObject(), role);
}

/** Removes the workspace and everything inside it. */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  const ws = await Workspace.findById(workspaceId).lean();
  if (!ws) throw ApiError.notFound('Workspace');

  await Promise.all([
    Comment.deleteMany({ workspaceId: ws._id }),
    Task.deleteMany({ workspaceId: ws._id }),
    Project.deleteMany({ workspaceId: ws._id }),
    Activity.deleteMany({ workspaceId: ws._id }),
    Invitation.deleteMany({ workspaceId: ws._id }),
    WorkspaceMember.deleteMany({ workspaceId: ws._id }),
  ]);
  await Workspace.deleteOne({ _id: ws._id });
  await invalidateMembership(workspaceId);
}

export async function transferOwnership(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
): Promise<WorkspaceDto> {
  const ws = await Workspace.findById(workspaceId);
  if (!ws) throw ApiError.notFound('Workspace');
  if (targetUserId === actorId) throw ApiError.badRequest('You already own this workspace');

  const target = await WorkspaceMember.findOne({ workspaceId: ws._id, userId: targetUserId });
  if (!target) throw ApiError.notFound('Member');
  const previousRole = target.role;

  await Promise.all([
    WorkspaceMember.updateOne({ _id: target._id }, { role: 'OWNER' }),
    WorkspaceMember.updateOne({ workspaceId: ws._id, userId: actorId }, { role: 'ADMIN' }),
  ]);
  ws.ownerId = target.userId;
  await ws.save();

  await invalidateMembership(workspaceId, actorId);
  await invalidateMembership(workspaceId, targetUserId);

  const users = await loadUserMap([targetUserId]);
  await recordActivity({
    workspaceId: ws._id,
    actorId,
    type: 'MEMBER_ROLE_CHANGED',
    target: { type: 'member', id: targetUserId, title: users.get(targetUserId).name },
    metadata: { userId: targetUserId, from: previousRole, to: 'OWNER', transfer: true },
  });

  return workspaceDtoFor(ws.toObject(), 'ADMIN');
}

// ---------- members ----------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listMembers(workspaceId: string, search?: string): Promise<WorkspaceMemberDto[]> {
  const filter: { workspaceId: string; userId?: { $in: Types.ObjectId[] } } = { workspaceId };

  if (search && search.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i');
    const matches = await User.find({ $or: [{ name: regex }, { email: regex }] })
      .select('_id')
      .lean();
    filter.userId = { $in: matches.map((u) => u._id) };
  }

  const members = await WorkspaceMember.find(filter).sort({ createdAt: 1 }).lean();
  const users = await loadUserMap(members.map((m) => m.userId));
  return members
    .map((m) => toWorkspaceMemberDto(m, users.get(m.userId)))
    .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.user.name.localeCompare(b.user.name));
}

export async function updateMemberRole(
  workspaceId: string,
  actorId: string,
  actorRole: WorkspaceRole,
  targetUserId: string,
  newRole: WorkspaceRole,
): Promise<WorkspaceMemberDto> {
  const target = await WorkspaceMember.findOne({ workspaceId, userId: targetUserId });
  if (!target) throw ApiError.notFound('Member');

  if (target.role === 'OWNER') throw ApiError.forbidden('The owner role can only change via transfer');
  if (!canAssignRole(actorRole, newRole)) throw ApiError.forbidden('You cannot assign this role');
  if (ROLE_RANK[actorRole] <= ROLE_RANK[target.role]) {
    throw ApiError.forbidden('You cannot change the role of a member with an equal or higher role');
  }

  const previousRole = target.role;
  if (previousRole !== newRole) {
    target.role = newRole;
    await target.save();
    await invalidateMembership(workspaceId, targetUserId);
  }

  const users = await loadUserMap([targetUserId]);
  const user = users.get(targetUserId);

  if (previousRole !== newRole) {
    await recordActivity({
      workspaceId,
      actorId,
      type: 'MEMBER_ROLE_CHANGED',
      target: { type: 'member', id: targetUserId, title: user.name },
      metadata: { userId: targetUserId, from: previousRole, to: newRole },
    });
  }
  return toWorkspaceMemberDto(target.toObject(), user);
}

/** Removes a member (or lets a non-owner leave). Cleans up project memberships and assignments. */
export async function removeMember(
  workspaceId: string,
  actorId: string,
  actorRole: WorkspaceRole,
  targetUserId: string,
): Promise<void> {
  const target = await WorkspaceMember.findOne({ workspaceId, userId: targetUserId }).lean();
  if (!target) throw ApiError.notFound('Member');

  const isSelf = targetUserId === actorId;
  if (isSelf) {
    if (target.role === 'OWNER') {
      throw ApiError.forbidden('The owner cannot leave; transfer ownership first');
    }
  } else {
    if (!hasPermission(actorRole, 'member:manage')) throw ApiError.forbidden();
    if (ROLE_RANK[actorRole] <= ROLE_RANK[target.role]) {
      throw ApiError.forbidden('You cannot remove a member with an equal or higher role');
    }
  }

  const userObjectId = new Types.ObjectId(targetUserId);
  await Promise.all([
    WorkspaceMember.deleteOne({ _id: target._id }),
    Project.updateMany({ workspaceId }, { $pull: { memberIds: userObjectId } }),
    Task.updateMany({ workspaceId, assigneeId: userObjectId }, { $set: { assigneeId: null } }),
  ]);
  await invalidateMembership(workspaceId, targetUserId);

  const users = await loadUserMap([targetUserId]);
  await recordActivity({
    workspaceId,
    actorId,
    type: 'MEMBER_REMOVED',
    target: { type: 'member', id: targetUserId, title: users.get(targetUserId).name },
    metadata: { userId: targetUserId, role: target.role, left: isSelf },
  });
  events.emit('member.removed', { workspaceId, userId: targetUserId, actorId });
}

/** Ensures every id in `userIds` is a member of the workspace. */
export async function assertWorkspaceMembers(
  workspaceId: Types.ObjectId | string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  const count = await WorkspaceMember.countDocuments({ workspaceId, userId: { $in: unique } });
  if (count !== unique.length) {
    throw ApiError.badRequest('All users must be members of the workspace');
  }
}

/** Filters `userIds` down to those who are members of the workspace. */
export async function filterWorkspaceMembers(
  workspaceId: Types.ObjectId | string,
  userIds: string[],
): Promise<string[]> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return [];
  const members = await WorkspaceMember.find({ workspaceId, userId: { $in: unique } })
    .select('userId')
    .lean();
  return members.map((m) => String(m.userId));
}

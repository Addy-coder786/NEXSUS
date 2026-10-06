import type { Request, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { ROLE_RANK, hasPermission, type Permission, type WorkspaceRole } from '@nexus/shared';
import { cache } from '../config/redis';
import { Comment, type CommentLean } from '../models/Comment';
import { Project, type ProjectLean } from '../models/Project';
import { Task, type TaskLean } from '../models/Task';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import { ApiError } from '../utils/ApiError';
import type { AuthUser } from './authenticate';

export interface WorkspaceContext {
  id: string;
  role: WorkspaceRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      workspace?: WorkspaceContext;
      project?: ProjectLean;
      task?: TaskLean;
      comment?: CommentLean;
    }
  }
}

const MEMBERSHIP_TTL_SEC = 60;
const membershipKey = (workspaceId: string, userId: string) => `member:${workspaceId}:${userId}`;

/** Role of `userId` in `workspaceId`, or null when not a member. Positive hits are cached 60 s. */
export async function getMemberRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const key = membershipKey(workspaceId, userId);
  const hit = await cache.get<{ role: WorkspaceRole }>(key);
  if (hit) return hit.role;

  const member = await WorkspaceMember.findOne({ workspaceId, userId }).select('role').lean();
  if (!member) return null;
  await cache.set(key, { role: member.role }, MEMBERSHIP_TTL_SEC);
  return member.role;
}

/** Drop cached membership for one user, or for every member of the workspace. */
export async function invalidateMembership(workspaceId: string, userId?: string): Promise<void> {
  if (userId) await cache.del(membershipKey(workspaceId, userId));
  else await cache.delByPrefix(`member:${workspaceId}:`);
}

export type WorkspaceSource = 'workspaceParam' | 'project' | 'task' | 'comment';

export interface AuthorizeOptions {
  /** Where the workspace id comes from. Defaults to the `:id` route param. */
  from?: WorkspaceSource;
}

function paramId(req: Request): string {
  const id = req.params.id;
  if (!id || !Types.ObjectId.isValid(id)) throw ApiError.notFound();
  return id;
}

async function resolveWorkspaceId(req: Request, from: WorkspaceSource): Promise<string> {
  const id = paramId(req);

  if (from === 'workspaceParam') return id;

  if (from === 'project') {
    const project = await Project.findById(id).lean();
    if (!project) throw ApiError.notFound('Project');
    req.project = project;
    return String(project.workspaceId);
  }

  if (from === 'task') {
    const task = await Task.findById(id).lean();
    if (!task) throw ApiError.notFound('Task');
    const project = await Project.findById(task.projectId).lean();
    if (!project) throw ApiError.notFound('Project');
    req.task = task;
    req.project = project;
    return String(task.workspaceId);
  }

  const comment = await Comment.findById(id).lean();
  if (!comment) throw ApiError.notFound('Comment');
  const [task, project] = await Promise.all([
    Task.findById(comment.taskId).lean(),
    Project.findById(comment.projectId).lean(),
  ]);
  if (!task) throw ApiError.notFound('Task');
  if (!project) throw ApiError.notFound('Project');
  req.comment = comment;
  req.task = task;
  req.project = project;
  return String(comment.workspaceId);
}

/**
 * Resolves the workspace for the current route, verifies the caller is a member and (unless
 * `permission` is 'member') holds the given permission. Attaches `req.workspace` and, depending
 * on `from`, the loaded `req.project` / `req.task` / `req.comment`.
 */
export function requireWorkspacePermission(
  permission: Permission | 'member',
  options: AuthorizeOptions = {},
): RequestHandler {
  const from = options.from ?? 'workspaceParam';
  return async (req, _res, next) => {
    try {
      const user = getAuthUser(req);
      const workspaceId = await resolveWorkspaceId(req, from);
      const role = await getMemberRole(workspaceId, user.id);

      if (!role) {
        if (from === 'workspaceParam') {
          const exists = await Workspace.exists({ _id: workspaceId });
          if (!exists) throw ApiError.notFound('Workspace');
        }
        throw ApiError.forbidden('You are not a member of this workspace');
      }
      if (permission !== 'member' && !hasPermission(role, permission)) {
        throw ApiError.forbidden();
      }
      req.workspace = { id: workspaceId, role };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** True when the role sees every project in the workspace (MANAGER and above). */
export function canSeeAllProjects(role: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.MANAGER;
}

/** Whether `userId` with `role` may access `project` (member of it, or MANAGER+). */
export function hasProjectAccess(
  project: Pick<ProjectLean, 'memberIds'>,
  role: WorkspaceRole,
  userId: string,
): boolean {
  if (canSeeAllProjects(role)) return true;
  return project.memberIds.some((m) => String(m) === userId);
}

/** VIEWER/MEMBER must be members of the loaded project; MANAGER+ see every project. */
export const requireProjectAccess: RequestHandler = (req, _res, next) => {
  try {
    const user = getAuthUser(req);
    const { role } = getWorkspaceContext(req);
    const project = getProjectContext(req);
    if (!hasProjectAccess(project, role, user.id)) {
      throw ApiError.forbidden('You are not a member of this project');
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Typed accessors for request context populated by earlier middleware.

export function getAuthUser(req: Request): AuthUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export function getWorkspaceContext(req: Request): WorkspaceContext {
  if (!req.workspace) throw ApiError.internal('Workspace context missing');
  return req.workspace;
}

export function getProjectContext(req: Request): ProjectLean {
  if (!req.project) throw ApiError.internal('Project context missing');
  return req.project;
}

export function getTaskContext(req: Request): TaskLean {
  if (!req.task) throw ApiError.internal('Task context missing');
  return req.task;
}

export function getCommentContext(req: Request): CommentLean {
  if (!req.comment) throw ApiError.internal('Comment context missing');
  return req.comment;
}

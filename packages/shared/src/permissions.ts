import type { WorkspaceRole } from './constants';

export const PERMISSIONS = {
  'workspace:delete': ['OWNER'],
  'workspace:update': ['OWNER', 'ADMIN'],
  'workspace:transfer': ['OWNER'],
  'member:manage': ['OWNER', 'ADMIN'],
  'member:invite': ['OWNER', 'ADMIN'],
  'project:create': ['OWNER', 'ADMIN', 'MANAGER'],
  'project:update': ['OWNER', 'ADMIN', 'MANAGER'],
  'project:delete': ['OWNER', 'ADMIN', 'MANAGER'],
  'project:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'task:create': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'task:update': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'task:delete': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'task:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'comment:create': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'activity:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'channel:create': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'channel:manage': ['OWNER', 'ADMIN', 'MANAGER'],
  'message:send': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'document:create': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'document:update': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'document:delete': ['OWNER', 'ADMIN', 'MANAGER'],
  'document:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'file:upload': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'file:delete': ['OWNER', 'ADMIN', 'MANAGER'],
  'file:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'analytics:view': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'integration:manage': ['OWNER', 'ADMIN'],
  /** Ask the assistant, read summaries and insights (read-only for VIEWER). */
  'ai:use': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  /** Generate task drafts and analyse meetings. Committing tasks still needs task:create. */
  'ai:generate': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'meeting:create': ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'],
  'meeting:delete': ['OWNER', 'ADMIN', 'MANAGER'],
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1,
};

export function hasPermission(
  role: WorkspaceRole | null | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly WorkspaceRole[]).includes(role);
}

/** Can `actor` assign or change someone to `target` role? Only strictly lower roles, never OWNER. */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === 'OWNER') return false;
  return ROLE_RANK[actor] > ROLE_RANK[target] && hasPermission(actor, 'member:manage');
}

import { hasPermission, canAssignRole, type Permission, type WorkspaceRole } from '@nexus/shared';
import { useCurrentWorkspace } from '@/features/workspaces/hooks';

export { hasPermission, canAssignRole };

/** Current user's role in the workspace from the route (undefined while loading). */
export function useMyRole(): WorkspaceRole | undefined {
  const { data } = useCurrentWorkspace();
  return data?.myRole;
}

/** True when the current workspace role grants `permission`. */
export function useCan(permission: Permission): boolean {
  const role = useMyRole();
  return hasPermission(role, permission);
}

/** Predicates bound to the current role, convenient for several checks in one component. */
export function usePermissions(): {
  role: WorkspaceRole | undefined;
  can: (permission: Permission) => boolean;
  canAssign: (target: WorkspaceRole) => boolean;
} {
  const role = useMyRole();
  return {
    role,
    can: (permission) => hasPermission(role, permission),
    canAssign: (target) => (role ? canAssignRole(role, target) : false),
  };
}

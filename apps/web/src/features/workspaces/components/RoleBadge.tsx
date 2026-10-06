import type { WorkspaceRole } from '@nexus/shared';
import { Badge } from '@/components/ui/badge';
import { humanize } from '@/lib/utils';

const variantByRole: Record<WorkspaceRole, 'default' | 'secondary' | 'outline' | 'success' | 'warning'> = {
  OWNER: 'default',
  ADMIN: 'warning',
  MANAGER: 'success',
  MEMBER: 'secondary',
  VIEWER: 'outline',
};

export function RoleBadge({ role, className }: { role: WorkspaceRole; className?: string }) {
  return (
    <Badge variant={variantByRole[role]} className={className}>
      {humanize(role)}
    </Badge>
  );
}

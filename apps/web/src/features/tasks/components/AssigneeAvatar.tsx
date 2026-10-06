import type { UserPublicDto } from '@nexus/shared';
import { UserAvatar } from '@/components/common/UserAvatar';

export function AssigneeAvatar({ assignee, size = 'sm' }: { assignee: UserPublicDto | null; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <span title={assignee ? `Assigned to ${assignee.name}` : 'Unassigned'} className="inline-flex">
      <UserAvatar user={assignee} size={size} />
      <span className="sr-only">{assignee ? `Assigned to ${assignee.name}` : 'Unassigned'}</span>
    </span>
  );
}

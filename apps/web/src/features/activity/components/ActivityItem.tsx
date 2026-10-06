import { Link } from 'react-router-dom';
import type { ActivityDto } from '@nexus/shared';
import { describeActivity } from '../sentences';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { truncate } from '@/lib/utils';

function targetHref(a: ActivityDto): string | null {
  if (!a.target) return null;
  const base = `/w/${a.workspaceId}`;
  switch (a.target.type) {
    case 'task':
      return a.projectId ? `${base}/projects/${a.projectId}/tasks/${a.target.id}` : null;
    case 'project':
      return `${base}/projects/${a.target.id}`;
    case 'comment':
      return a.projectId ? `${base}/projects/${a.projectId}` : null;
    case 'workspace':
      return base;
    default:
      return null;
  }
}

export function ActivityItem({ activity }: { activity: ActivityDto }) {
  const sentence = describeActivity(activity);
  const href = targetHref(activity);
  return (
    <li className="flex gap-3 py-2.5">
      <UserAvatar user={activity.actor} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5">
          <span className="font-medium">{activity.actor.name}</span> {sentence.verb}
          {sentence.target ? (
            <>
              {' '}
              {href ? (
                <Link to={href} className="font-medium text-foreground hover:underline">
                  {sentence.target}
                </Link>
              ) : (
                <span className="font-medium">{sentence.target}</span>
              )}
            </>
          ) : null}
        </p>
        {sentence.suffix ? (
          <p className="mt-0.5 border-l-2 pl-2 text-[13px] text-muted-foreground">{truncate(sentence.suffix, 160)}</p>
        ) : null}
        <time
          dateTime={activity.createdAt}
          title={formatDateTime(activity.createdAt)}
          className="mt-0.5 block text-xs text-muted-foreground"
        >
          {formatRelative(activity.createdAt)}
        </time>
      </div>
    </li>
  );
}

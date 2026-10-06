import { memo, type ComponentType, type MouseEvent } from 'react';
import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCircle2,
  FileText,
  FileUp,
  FolderKanban,
  MessageCircle,
  MessageSquare,
  Sparkles,
  UserPlus,
  UserRoundCheck,
  X,
} from 'lucide-react';
import type { NotificationDto, NotificationType } from '@nexus/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const iconByType: Record<NotificationType, { Icon: ComponentType<{ className?: string }>; className: string }> = {
  TASK_ASSIGNED: { Icon: UserRoundCheck, className: 'bg-primary/10 text-primary' },
  TASK_COMPLETED: { Icon: CheckCircle2, className: 'bg-success/15 text-success' },
  TASK_DUE_SOON: { Icon: CalendarClock, className: 'bg-warning/25 text-foreground' },
  TASK_OVERDUE: { Icon: CalendarClock, className: 'bg-destructive/10 text-destructive' },
  MENTION: { Icon: AtSign, className: 'bg-warning/25 text-foreground' },
  COMMENT_ADDED: { Icon: MessageCircle, className: 'bg-primary/10 text-primary' },
  NEW_MESSAGE: { Icon: MessageSquare, className: 'bg-primary/10 text-primary' },
  PROJECT_UPDATED: { Icon: FolderKanban, className: 'bg-secondary text-secondary-foreground' },
  FILE_UPLOADED: { Icon: FileUp, className: 'bg-secondary text-secondary-foreground' },
  DOCUMENT_SHARED: { Icon: FileText, className: 'bg-secondary text-secondary-foreground' },
  MEMBER_JOINED: { Icon: UserPlus, className: 'bg-success/15 text-success' },
  AI_TASK_CREATED: { Icon: Sparkles, className: 'bg-primary/10 text-primary' },
};

export interface NotificationItemProps {
  notification: NotificationDto;
  onOpen: (n: NotificationDto) => void;
  onDelete?: (n: NotificationDto) => void;
  compact?: boolean;
}

export const NotificationItem = memo(function NotificationItem({ notification: n, onOpen, onDelete, compact }: NotificationItemProps) {
  const meta = iconByType[n.type] ?? { Icon: Bell, className: 'bg-muted text-muted-foreground' };
  const unread = !n.readAt;
  const onDeleteClick = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete?.(n);
  };
  return (
    <li
      data-testid="notification-item"
      data-unread={unread || undefined}
      className={cn('group relative flex gap-3 rounded-md transition-colors hover:bg-accent', compact ? 'px-2 py-2' : 'px-3 py-2.5', unread && 'bg-primary/[0.04]')}
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        aria-label={`${unread ? 'Unread: ' : ''}${n.title}`}
      >
        <span className="relative mt-0.5 shrink-0">
          {n.actor ? (
            <UserAvatar user={n.actor} size={compact ? 'sm' : 'md'} />
          ) : (
            <span className={cn('flex items-center justify-center rounded-full', compact ? 'size-6' : 'size-7', meta.className)}>
              <meta.Icon className="size-3.5" />
            </span>
          )}
          {n.actor ? (
            <span className={cn('absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full ring-2 ring-background', meta.className)}>
              <meta.Icon className="size-2.5" />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] leading-5', unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
          {n.body ? <span className={cn('block text-[13px] text-muted-foreground', compact ? 'line-clamp-1' : 'line-clamp-2')}>{n.body}</span> : null}
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="mt-0.5 block text-2xs text-muted-foreground">
            {formatRelative(n.createdAt)}
          </time>
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-center gap-1 pt-1.5">
        {unread ? <span aria-label="Unread" role="img" className="size-2 rounded-full bg-primary" /> : null}
        {onDelete ? (
          <button
            type="button"
            onClick={onDeleteClick}
            aria-label="Delete notification"
            className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </span>
    </li>
  );
});

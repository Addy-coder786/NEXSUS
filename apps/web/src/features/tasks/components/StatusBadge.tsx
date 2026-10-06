import type { TaskStatus } from '@nexus/shared';
import { STATUS_LABELS } from '../constants';
import { cn } from '@/lib/utils';

export const STATUS_DOT: Record<TaskStatus, string> = {
  BACKLOG: 'bg-muted-foreground/50',
  TODO: 'bg-foreground/60',
  IN_PROGRESS: 'bg-primary',
  REVIEW: 'bg-warning',
  DONE: 'bg-success',
};

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span className={cn('size-2 rounded-full', STATUS_DOT[status])} aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

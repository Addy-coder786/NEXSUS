import { CalendarDays } from 'lucide-react';
import { formatDateTime, formatDueDate, isOverdue } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DueDateBadge({
  dueDate,
  completedAt,
  className,
}: {
  dueDate: string | null;
  completedAt: string | null;
  className?: string;
}) {
  if (!dueDate) return null;
  const overdue = isOverdue(dueDate, completedAt);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
        className,
      )}
      title={`Due ${formatDateTime(dueDate)}`}
      data-overdue={overdue ? 'true' : undefined}
    >
      <CalendarDays className="size-3" aria-hidden />
      <time dateTime={dueDate}>{formatDueDate(dueDate)}</time>
      {overdue ? <span className="sr-only">(overdue)</span> : null}
    </span>
  );
}

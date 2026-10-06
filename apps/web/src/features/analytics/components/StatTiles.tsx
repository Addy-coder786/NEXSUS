import type { TaskSummaryStats } from '@nexus/shared';
import { CalendarClock, CircleAlert, CircleCheck, ListChecks, Target, UserX } from 'lucide-react';
import { formatCompact } from './chart-theme';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface Tile {
  key: string;
  label: string;
  value: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Status tone when the number itself is a problem (never a series colour). */
  tone?: 'warning' | 'danger';
  hint?: string;
}

export function StatTiles({ summary, className }: { summary: TaskSummaryStats | undefined; className?: string }) {
  if (!summary) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6', className)} aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  const tiles: Tile[] = [
    { key: 'total', label: 'Total tasks', value: summary.total, icon: ListChecks },
    { key: 'progress', label: 'Progress', value: summary.progressPercent, suffix: '%', icon: Target, hint: `${summary.byStatus.DONE} done` },
    {
      key: 'overdue',
      label: 'Overdue',
      value: summary.overdue,
      icon: CircleAlert,
      tone: summary.overdue > 0 ? 'danger' : undefined,
    },
    { key: 'due7', label: 'Due next 7 days', value: summary.dueNext7Days, icon: CalendarClock },
    { key: 'done7', label: 'Completed last 7 days', value: summary.completedLast7Days, icon: CircleCheck, hint: `${summary.createdLast7Days} created` },
    {
      key: 'unassigned',
      label: 'Unassigned',
      value: summary.unassigned,
      icon: UserX,
      tone: summary.total > 0 && summary.unassigned / Math.max(1, summary.total - summary.byStatus.DONE) > 0.25 ? 'warning' : undefined,
    },
  ];
  return (
    <dl className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6', className)}>
      {tiles.map((t) => (
        <div key={t.key} data-testid={`stat-${t.key}`} className="flex flex-col gap-1 rounded-lg border bg-card p-3.5 shadow-sm">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <t.icon className={cn('size-3.5 shrink-0', t.tone === 'danger' && 'text-destructive', t.tone === 'warning' && 'text-warning')} aria-hidden />
            {t.label}
          </dt>
          <dd className="text-2xl font-semibold leading-none tracking-tight">
            {formatCompact(t.value)}
            {t.suffix ? <span className="text-base text-muted-foreground">{t.suffix}</span> : null}
          </dd>
          {t.key === 'progress' ? (
            <Progress value={t.value} size="sm" className="mt-1" aria-label="Overall progress" />
          ) : t.hint ? (
            <span className="text-2xs text-muted-foreground">{t.hint}</span>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

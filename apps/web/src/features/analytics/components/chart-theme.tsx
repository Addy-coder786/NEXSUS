import type { ReactNode } from 'react';
import type { TaskPriority, TaskStatus } from '@nexus/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Chart colours are CSS variables (see index.css) so dark mode swaps them. Series
 * identity is fixed per entity and never re-assigned by rank.
 */
export const SERIES = {
  created: 'var(--chart-1)',
  completed: 'var(--chart-2)',
  single: 'var(--chart-1)',
} as const;

/** Ordinal blue ramp for ordered categories (status progression, priority). */
export const ORDINAL = ['var(--chart-ord-1)', 'var(--chart-ord-2)', 'var(--chart-ord-3)', 'var(--chart-ord-4)', 'var(--chart-ord-5)'] as const;

export const STATUS_ORDER: readonly TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
export const PRIORITY_ORDER: readonly TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export const STATUS_COLORS: Record<TaskStatus, string> = {
  BACKLOG: ORDINAL[0],
  TODO: ORDINAL[1],
  IN_PROGRESS: ORDINAL[2],
  REVIEW: ORDINAL[3],
  DONE: ORDINAL[4],
};

export const CHART_CHROME = {
  grid: 'var(--chart-grid)',
  axis: 'var(--chart-axis)',
  muted: 'var(--chart-muted)',
  track: 'var(--chart-track)',
} as const;

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

interface ChartTooltipRow {
  label: string;
  value: ReactNode;
  color?: string;
  /** 'line' draws a short stroke key, 'rect' a swatch. */
  mark?: 'line' | 'rect';
}

/** Tooltip body: values lead, labels follow, series keyed by a short stroke of their colour. */
export function ChartTooltip({ title, rows }: { title?: ReactNode; rows: ChartTooltipRow[] }) {
  return (
    <div className="rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-lg">
      {title ? <div className="mb-1 text-muted-foreground">{title}</div> : null}
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            {r.color ? (
              <span
                aria-hidden
                className={cn('shrink-0', r.mark === 'rect' ? 'size-2 rounded-sm' : 'h-0.5 w-3 rounded-full')}
                style={{ backgroundColor: r.color }}
              />
            ) : null}
            <span className="font-semibold tabular-nums">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Accessible data twin rendered visually hidden (or toggled) so no value is colour-only. */
  table?: ReactNode;
  loading?: boolean;
}

export function ChartCard({ title, description, action, className, children, table, loading }: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col', className)} aria-busy={loading || undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <div className={cn('nexus-chart flex-1 px-4 pb-4 transition-opacity', loading && 'opacity-60')}>{children}</div>
      {table ? <details className="border-t px-4 py-2 text-xs text-muted-foreground"><summary className="cursor-pointer select-none">Data table</summary><div className="mt-2 text-foreground">{table}</div></details> : null}
    </Card>
  );
}

export function ChartEmpty({ message = 'No tasks yet' }: { message?: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
      {message}
    </div>
  );
}

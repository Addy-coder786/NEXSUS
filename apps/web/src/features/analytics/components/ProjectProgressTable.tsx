import { Link } from 'react-router-dom';
import type { ProjectProgressRow } from '@nexus/shared';
import { HealthPill } from './HealthCard';
import { ChartCard, ChartEmpty } from './chart-theme';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDueDate, isOverdue } from '@/lib/format';
import { cn, humanize } from '@/lib/utils';

export function ProjectProgressTable({ projects, workspaceId, loading }: { projects: ProjectProgressRow[] | undefined; workspaceId: string; loading?: boolean }) {
  const rows = projects ?? [];
  return (
    <ChartCard title="Projects" description="Progress, overdue work and health per project" loading={loading}>
      {rows.length === 0 ? (
        <ChartEmpty message="No projects yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-0">Project</TableHead>
              <TableHead className="w-48">Progress</TableHead>
              <TableHead className="text-right">Done / total</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead>Health</TableHead>
              <TableHead className="pr-0 text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const late = p.dueDate ? isOverdue(p.dueDate, p.progressPercent >= 100 ? new Date() : null) : false;
              return (
                <TableRow key={p.projectId}>
                  <TableCell className="pl-0">
                    <Link to={`/w/${workspaceId}/projects/${p.projectId}/analytics`} className="inline-flex max-w-full items-center gap-2 font-medium hover:underline">
                      <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
                      <span className="truncate">{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.key}</span>
                      {p.status !== 'ACTIVE' ? <span className="rounded bg-secondary px-1 text-2xs text-secondary-foreground">{humanize(p.status)}</span> : null}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={p.progressPercent} size="sm" aria-label={`${p.name} progress`} />
                      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{p.progressPercent}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.done} / {p.total}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', p.overdue > 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>{p.overdue}</TableCell>
                  <TableCell>
                    <HealthPill status={p.health} />
                  </TableCell>
                  <TableCell className={cn('pr-0 text-right text-xs', late ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {p.dueDate ? formatDueDate(p.dueDate) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ChartCard>
  );
}

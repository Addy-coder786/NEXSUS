import type { WorkloadRow } from '@nexus/shared';
import { ChartCard, ChartEmpty, SERIES } from './chart-theme';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserAvatar } from '@/components/common/UserAvatar';

export function WorkloadTable({ workload, loading }: { workload: WorkloadRow[] | undefined; loading?: boolean }) {
  const rows = [...(workload ?? [])].sort((a, b) => b.open + b.inProgress - (a.open + a.inProgress));
  const max = Math.max(1, ...rows.map((r) => r.open + r.inProgress));
  return (
    <ChartCard title="Workload" description="Open work per member; the bar is open + in progress relative to the busiest member" loading={loading}>
      {rows.length === 0 ? (
        <ChartEmpty message="No assigned tasks" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-0">Member</TableHead>
              <TableHead className="w-40">Load</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">In progress</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="pr-0 text-right">Done 7d</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const load = r.open + r.inProgress;
              return (
                <TableRow key={r.user.id}>
                  <TableCell className="pl-0">
                    <span className="inline-flex items-center gap-2">
                      <UserAvatar user={r.user} size="sm" />
                      <span className="truncate font-medium">{r.user.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-chart-track" aria-hidden>
                      <div className="h-full rounded-full" style={{ width: `${(load / max) * 100}%`, backgroundColor: SERIES.single }} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.open}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.inProgress}</TableCell>
                  <TableCell className={r.overdue > 0 ? 'text-right font-medium tabular-nums text-destructive' : 'text-right tabular-nums text-muted-foreground'}>
                    {r.overdue}
                  </TableCell>
                  <TableCell className="pr-0 text-right tabular-nums">{r.completedLast7Days}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ChartCard>
  );
}

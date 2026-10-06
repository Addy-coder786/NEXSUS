import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { TaskStatus, TaskSummaryStats } from '@nexus/shared';
import { useReducedMotion } from '../hooks';
import { ChartCard, ChartEmpty, ChartTooltip, STATUS_COLORS, STATUS_ORDER, percent } from './chart-theme';
import { STATUS_LABELS } from '@/features/tasks/constants';

interface Datum {
  status: TaskStatus;
  name: string;
  value: number;
  color: string;
}

export function StatusDonut({ summary, loading }: { summary: TaskSummaryStats | undefined; loading?: boolean }) {
  const reduced = useReducedMotion();
  const data: Datum[] = STATUS_ORDER.map((s) => ({
    status: s,
    name: STATUS_LABELS[s],
    value: summary?.byStatus[s] ?? 0,
    color: STATUS_COLORS[s],
  }));
  const total = data.reduce((a, d) => a + d.value, 0);
  const nonZero = data.filter((d) => d.value > 0);

  const table = (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 font-medium">Status</th>
          <th scope="col" className="py-1 text-right font-medium">Tasks</th>
          <th scope="col" className="py-1 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.status}>
            <td className="py-0.5">{d.name}</td>
            <td className="py-0.5 text-right tabular-nums">{d.value}</td>
            <td className="py-0.5 text-right tabular-nums">{percent(d.value, total)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="By status" description="Where tasks sit in the flow" table={total > 0 ? table : undefined} loading={loading}>
      {total === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative h-44 w-44 shrink-0" role="img" aria-label={`${total} tasks by status`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={nonZero}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="68%"
                  outerRadius="100%"
                  paddingAngle={nonZero.length > 1 ? 2 : 0}
                  stroke="var(--card)"
                  strokeWidth={2}
                  isAnimationActive={!reduced}
                  animationDuration={400}
                >
                  {nonZero.map((d) => (
                    <Cell key={d.status} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  cursor={false}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as Datum | undefined;
                    if (!p) return null;
                    return <ChartTooltip rows={[{ label: p.name, value: `${p.value} · ${percent(p.value, total)}%`, color: p.color, mark: 'rect' }]} />;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold leading-none">{total}</span>
              <span className="mt-1 text-2xs text-muted-foreground">tasks</span>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5 text-xs" aria-label="Legend">
            {data.map((d) => (
              <li key={d.status} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} aria-hidden />
                <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
                <span className="tabular-nums font-medium">{d.value}</span>
                <span className="w-9 text-right tabular-nums text-muted-foreground">{percent(d.value, total)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

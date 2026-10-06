import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TaskPriority, TaskSummaryStats } from '@nexus/shared';
import { useReducedMotion } from '../hooks';
import { CHART_CHROME, ChartCard, ChartEmpty, ChartTooltip, PRIORITY_ORDER, SERIES } from './chart-theme';
import { PRIORITY_LABELS } from '@/features/tasks/constants';

interface Datum {
  priority: TaskPriority;
  name: string;
  value: number;
}

export function PriorityBars({ summary, loading }: { summary: TaskSummaryStats | undefined; loading?: boolean }) {
  const reduced = useReducedMotion();
  const data: Datum[] = PRIORITY_ORDER.map((p) => ({ priority: p, name: PRIORITY_LABELS[p], value: summary?.byPriority[p] ?? 0 }));
  const total = data.reduce((a, d) => a + d.value, 0);

  const table = (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 font-medium">Priority</th>
          <th scope="col" className="py-1 text-right font-medium">Tasks</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.priority}>
            <td className="py-0.5">{d.name}</td>
            <td className="py-0.5 text-right tabular-nums">{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="By priority" description="Open and done tasks per priority" table={total > 0 ? table : undefined} loading={loading}>
      {total === 0 ? (
        <ChartEmpty />
      ) : (
        <div className="h-44" role="img" aria-label="Tasks by priority">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={CHART_CHROME.grid} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={64} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: 'var(--accent)', opacity: 0.6 }}
                content={({ payload }) => {
                  const p = payload?.[0]?.payload as Datum | undefined;
                  if (!p) return null;
                  return <ChartTooltip rows={[{ label: `${p.name} priority`, value: p.value, color: SERIES.single, mark: 'rect' }]} />;
                }}
              />
              <Bar
                dataKey="value"
                fill={SERIES.single}
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
                isAnimationActive={!reduced}
                animationDuration={400}
                label={{ position: 'right', fontSize: 11, fill: 'var(--chart-muted)' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

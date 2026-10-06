import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, parseISO } from 'date-fns';
import type { VelocityPoint } from '@nexus/shared';
import { useReducedMotion } from '../hooks';
import { CHART_CHROME, ChartCard, ChartEmpty, ChartTooltip, SERIES } from './chart-theme';

interface Datum extends VelocityPoint {
  label: string;
}

function weekLabel(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, 'MMM d');
}

export function VelocityChart({ velocity, weeks, loading }: { velocity: VelocityPoint[] | undefined; weeks: number; loading?: boolean }) {
  const reduced = useReducedMotion();
  const data: Datum[] = (velocity ?? []).map((v) => ({ ...v, label: weekLabel(v.weekStart) }));
  const any = data.some((d) => d.created > 0 || d.completed > 0);

  const table = (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 font-medium">Week of</th>
          <th scope="col" className="py-1 text-right font-medium">Created</th>
          <th scope="col" className="py-1 text-right font-medium">Completed</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.weekStart}>
            <td className="py-0.5">{d.label}</td>
            <td className="py-0.5 text-right tabular-nums">{d.created}</td>
            <td className="py-0.5 text-right tabular-nums">{d.completed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="Velocity" description={`Tasks created vs completed per week, last ${weeks} weeks`} table={any ? table : undefined} loading={loading}>
      {!any ? (
        <ChartEmpty message="No activity in this window" />
      ) : (
        <div className="h-60" role="img" aria-label={`Created versus completed tasks per week over ${weeks} weeks`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={CHART_CHROME.grid} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: CHART_CHROME.axis }} tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: 'var(--accent)', opacity: 0.6 }}
                content={({ payload, label }) => {
                  const p = payload?.[0]?.payload as Datum | undefined;
                  if (!p) return null;
                  return (
                    <ChartTooltip
                      title={`Week of ${String(label)}`}
                      rows={[
                        { label: 'created', value: p.created, color: SERIES.created, mark: 'rect' },
                        { label: 'completed', value: p.completed, color: SERIES.completed, mark: 'line' },
                      ]}
                    />
                  );
                }}
              />
              <Legend verticalAlign="top" align="right" iconSize={10} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
              <Bar name="Created" dataKey="created" fill={SERIES.created} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduced} animationDuration={400} />
              <Line
                name="Completed"
                type="monotone"
                dataKey="completed"
                stroke={SERIES.completed}
                strokeWidth={2}
                dot={{ r: 4, fill: SERIES.completed, stroke: 'var(--card)', strokeWidth: 2 }}
                activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
                isAnimationActive={!reduced}
                animationDuration={400}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

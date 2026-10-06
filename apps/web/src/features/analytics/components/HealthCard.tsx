import { CircleCheck, CircleX, Lightbulb, TriangleAlert } from 'lucide-react';
import type { HealthAssessment, ProjectHealth } from '@nexus/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const HEALTH_META: Record<
  ProjectHealth,
  { label: string; text: string; bg: string; ring: string; icon: React.ComponentType<{ className?: string }> }
> = {
  ON_TRACK: { label: 'On track', text: 'text-success', bg: 'bg-success/15', ring: 'var(--success)', icon: CircleCheck },
  AT_RISK: { label: 'At risk', text: 'text-warning', bg: 'bg-warning/20', ring: 'var(--warning)', icon: TriangleAlert },
  OFF_TRACK: { label: 'Off track', text: 'text-destructive', bg: 'bg-destructive/10', ring: 'var(--destructive)', icon: CircleX },
};

export function HealthPill({ status, className }: { status: ProjectHealth; className?: string }) {
  const meta = HEALTH_META[status];
  const Icon = meta.icon;
  return (
    <span
      data-health={status}
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium', meta.bg, meta.text, className)}
    >
      <Icon className="size-3" aria-hidden />
      {meta.label}
    </span>
  );
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`Health score ${score} out of 100`} className="shrink-0">
      <circle cx="34" cy="34" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="6" />
      <circle
        cx="34"
        cy="34"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        transform="rotate(-90 34 34)"
        className="transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
      />
      <text x="34" y="34" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-base font-semibold">
        {score}
      </text>
    </svg>
  );
}

export function HealthCard({ health, avgCycleTimeDays, className }: { health: HealthAssessment | undefined; avgCycleTimeDays?: number | null; className?: string }) {
  if (!health) return <Skeleton className={cn('h-48', className)} />;
  const meta = HEALTH_META[health.status];
  return (
    <Card className={className} data-health={health.status}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Project health</CardTitle>
          <HealthPill status={health.status} />
        </div>
        <CardDescription>Score from overdue, blocked and unassigned work, deadlines and recent throughput.</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4">
        <ScoreRing score={health.score} color={meta.ring} />
        <div className="min-w-0 flex-1 space-y-2 text-[13px]">
          {health.reasons.length === 0 ? (
            <p className="text-muted-foreground">Nothing is dragging the score down right now.</p>
          ) : (
            <ul className="space-y-1" aria-label="Reasons">
              {health.reasons.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', health.status === 'OFF_TRACK' ? 'bg-destructive' : 'bg-warning')} aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          )}
          {health.recommendation ? (
            <p className="flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
              <span>{health.recommendation}</span>
            </p>
          ) : null}
          {avgCycleTimeDays !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Average cycle time:{' '}
              <span className="font-medium text-foreground">
                {avgCycleTimeDays === null ? '—' : `${avgCycleTimeDays.toFixed(1)} days`}
              </span>
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

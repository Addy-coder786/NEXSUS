import { Link } from 'react-router-dom';
import { RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAiEnabled, useProjectInsights, useRefreshInsights } from '../hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonLines } from '@/components/ui/skeleton';
import { HealthPill } from '@/features/analytics/components/HealthCard';
import { getErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** AI narrative over the deterministic project health (score and status come from analytics). */
export function ProjectInsightsCard({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const enabled = useAiEnabled();
  const insights = useProjectInsights(projectId, enabled);
  const refresh = useRefreshInsights(projectId);
  if (!enabled) return null;
  const data = insights.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Sparkles className="size-4 text-primary" /> AI insights
          {data ? <HealthPill status={data.health} className="ml-1" /> : null}
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data ? (
            <span>
              {data.cached ? 'Cached · ' : ''}
              {formatRelative(data.generatedAt)}
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh insights"
            disabled={refresh.isPending || insights.isFetching}
            onClick={() =>
              refresh.mutate(undefined, { onError: (e) => toast.error(getErrorMessage(e)) })
            }
          >
            <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {insights.isPending ? (
          <SkeletonLines lines={4} />
        ) : insights.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {insights.error.message}
          </p>
        ) : data ? (
          <>
            <p className="text-[13px] leading-relaxed">{data.narrative}</p>
            {data.blockers.length ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Blockers
                </h3>
                <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
                  {data.blockers.map((b, i) => (
                    <li key={i}>
                      {b.taskId ? (
                        <Link
                          className="text-primary hover:underline"
                          to={`/w/${workspaceId}/projects/${projectId}/board?task=${b.taskId}`}
                        >
                          {b.text}
                        </Link>
                      ) : (
                        b.text
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <Section title="Risks" items={data.risks} />
              <Section title="Recommendations" items={data.recommendations} />
            </div>
            <Section title="This week" items={data.recentHighlights} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

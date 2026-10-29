import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAiEnabled, useWorkspaceDigest } from '../hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SkeletonLines } from '@/components/ui/skeleton';
import { formatRelative } from '@/lib/format';

/** "This week" AI digest on the workspace dashboard. Hidden when AI is not configured. */
export function WorkspaceDigestCard({ workspaceId }: { workspaceId: string }) {
  const enabled = useAiEnabled();
  const digest = useWorkspaceDigest(workspaceId, 7, enabled);
  if (!enabled) return null;
  const data = digest.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Sparkles className="size-4 text-primary" /> This week
        </CardTitle>
        {data ? (
          <span className="text-xs text-muted-foreground">{formatRelative(data.generatedAt)}</span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {digest.isPending ? (
          <SkeletonLines lines={3} />
        ) : digest.isError ? (
          <p className="text-muted-foreground">{digest.error.message}</p>
        ) : data ? (
          <>
            <p className="leading-relaxed">{data.summary}</p>
            {data.highlights.length ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {data.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : null}
            {data.atRiskProjects.length ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Needs attention
                </h3>
                <ul className="space-y-1">
                  {data.atRiskProjects.map((p) => (
                    <li key={p.projectId}>
                      <Link
                        to={`/w/${workspaceId}/projects/${p.projectId}/analytics`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.name}
                      </Link>{' '}
                      <span className="text-muted-foreground">· {p.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

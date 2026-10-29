import { DatabaseZap, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAiStatus, useAiUsage, useReindexWorkspace } from '../hooks';
import { AiSetupNotice } from './AiSetupNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getErrorMessage } from '@/lib/api';

const FEATURE_LABELS: Record<string, string> = {
  assistant: 'Assistant',
  generate_tasks: 'Task generation',
  meeting_analysis: 'Meeting analysis',
  document_summary: 'Document summaries',
  project_insights: 'Project insights',
  workspace_digest: 'Weekly digest',
};

const fmt = new Intl.NumberFormat();
const PERIOD_DAYS = 30;

/** Settings → AI (OWNER/ADMIN): configuration, today's quota, 30-day usage and reindexing. */
export function AiSettingsPanel({ workspaceId }: { workspaceId: string }) {
  const status = useAiStatus();
  const enabled = status.data?.enabled ?? false;
  const usage = useAiUsage(workspaceId, PERIOD_DAYS, enabled);
  const reindex = useReindexWorkspace(workspaceId);

  if (status.isPending) return <Skeleton className="h-40" />;
  if (!enabled) return <AiSetupNotice />;
  const data = usage.data;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5 text-sm">
            <Sparkles className="size-4 text-primary" /> AI configuration
          </CardTitle>
          <CardDescription>Set on the API server. Changes need a restart.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge variant="outline">Model: {status.data?.model}</Badge>
          <Badge variant={status.data?.semanticSearch ? 'success' : 'secondary'}>
            {status.data?.semanticSearch ? 'Semantic search on' : 'Keyword search only'}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Usage</CardTitle>
          <CardDescription>
            Token usage in this workspace over the last {PERIOD_DAYS} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {usage.isPending ? (
            <Skeleton className="h-32" />
          ) : usage.isError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {usage.error.message}
            </p>
          ) : data ? (
            <>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[13px]">
                  <span id="ai-quota-label">Requests today</span>
                  <span className="tabular-nums text-muted-foreground">
                    {fmt.format(data.quota.usedToday)} of {fmt.format(data.quota.limit)}
                  </span>
                </div>
                <Progress
                  aria-labelledby="ai-quota-label"
                  value={data.quota.usedToday}
                  max={data.quota.limit}
                />
              </div>
              {data.byFeature.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead className="text-right">Model calls</TableHead>
                      <TableHead className="text-right">Input tokens</TableHead>
                      <TableHead className="text-right">Cached input</TableHead>
                      <TableHead className="text-right">Output tokens</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byFeature.map((row) => (
                      <TableRow key={row.feature}>
                        <TableCell>{FEATURE_LABELS[row.feature] ?? row.feature}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt.format(row.calls)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt.format(row.inputTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt.format(row.cacheReadTokens)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt.format(row.outputTokens)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-medium">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.format(data.totals.calls)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.format(data.totals.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.format(data.totals.cacheReadTokens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt.format(data.totals.outputTokens)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              ) : (
                <p className="text-[13px] text-muted-foreground">No AI usage in this period.</p>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Search index</CardTitle>
          <CardDescription>
            Content is indexed as it changes. Rebuild the index after turning on semantic search, or
            if results look out of date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            loading={reindex.isPending}
            onClick={() =>
              reindex.mutate(undefined, {
                onSuccess: () => toast.success('Rebuilding the search index in the background'),
                onError: (e) => toast.error(getErrorMessage(e)),
              })
            }
          >
            <DatabaseZap /> Rebuild search index
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

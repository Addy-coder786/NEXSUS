import { useParams } from 'react-router-dom';
import { BarChart3, Users } from 'lucide-react';
import { useWeeks, useWorkspaceAnalytics } from '../hooks';
import { StatTiles } from '../components/StatTiles';
import { PriorityBars, StatusDonut, VelocityChart } from '../components/charts';
import { WorkloadTable } from '../components/WorkloadTable';
import { ProjectProgressTable } from '../components/ProjectProgressTable';
import { WeeksSelector } from '../components/WeeksSelector';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/permissions';
import { formatRelative } from '@/lib/format';

export function WorkspaceAnalyticsPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const canView = useCan('analytics:view');
  const [weeks, setWeeks] = useWeeks(8);
  const analytics = useWorkspaceAnalytics(canView ? workspaceId : null, weeks);
  const data = analytics.data;
  const refreshing = analytics.isFetching && Boolean(data);

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState icon={<BarChart3 />} title="Analytics unavailable" description="Your role does not include analytics access." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Analytics"
        description={
          data ? (
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden />
                {data.activeMembers7Days} active {data.activeMembers7Days === 1 ? 'member' : 'members'} this week
              </span>
              <span aria-hidden>·</span>
              <span>Updated {formatRelative(data.generatedAt)}</span>
            </span>
          ) : (
            'Workspace-wide task metrics across the projects you can see.'
          )
        }
        actions={<WeeksSelector value={weeks} onChange={setWeeks} />}
      />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-6">
        {analytics.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {analytics.error.message}
          </p>
        ) : null}
        <StatTiles summary={data?.summary} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <VelocityChart velocity={data?.velocity} weeks={weeks} loading={refreshing} />
          <StatusDonut summary={data?.summary} loading={refreshing} />
          <PriorityBars summary={data?.summary} loading={refreshing} />
        </div>
        <ProjectProgressTable projects={data?.projects} workspaceId={workspaceId} loading={refreshing} />
        <WorkloadTable workload={data?.workload} loading={refreshing} />
      </div>
    </div>
  );
}

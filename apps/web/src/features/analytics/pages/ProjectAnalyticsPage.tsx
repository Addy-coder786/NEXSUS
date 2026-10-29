import { BarChart3 } from 'lucide-react';
import { useProjectAnalytics, useWeeks } from '../hooks';
import { StatTiles } from '../components/StatTiles';
import { PriorityBars, StatusDonut, VelocityChart } from '../components/charts';
import { WorkloadTable } from '../components/WorkloadTable';
import { HealthCard } from '../components/HealthCard';
import { WeeksSelector } from '../components/WeeksSelector';
import { useProjectContext } from '@/features/projects/pages/ProjectLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { useCan } from '@/lib/permissions';
import { formatRelative } from '@/lib/format';
import { ProjectInsightsCard } from '@/features/ai/components/ProjectInsightsCard';

export function ProjectAnalyticsPage() {
  const project = useProjectContext();
  const canView = useCan('analytics:view');
  const [weeks, setWeeks] = useWeeks(8);
  const analytics = useProjectAnalytics(canView ? project.id : undefined, weeks);
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-2">
        <p className="text-[13px] text-muted-foreground">
          {data ? `Updated ${formatRelative(data.generatedAt)}` : 'Task metrics, velocity and health for this project.'}
        </p>
        <WeeksSelector value={weeks} onChange={setWeeks} />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto scrollbar-thin p-6">
        {analytics.isError ? (
          <p role="alert" className="text-[13px] text-destructive">
            {analytics.error.message}
          </p>
        ) : null}
        <StatTiles summary={data?.summary} />
        <ProjectInsightsCard projectId={project.id} workspaceId={project.workspaceId} />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <HealthCard health={data?.health} avgCycleTimeDays={data?.avgCycleTimeDays} />
          <VelocityChart velocity={data?.velocity} weeks={weeks} loading={refreshing} />
          <StatusDonut summary={data?.summary} loading={refreshing} />
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <PriorityBars summary={data?.summary} loading={refreshing} />
          <WorkloadTable workload={data?.workload} loading={refreshing} />
        </div>
      </div>
    </div>
  );
}

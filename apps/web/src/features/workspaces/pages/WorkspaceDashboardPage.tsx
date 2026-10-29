import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FolderKanban, Plus, Users } from 'lucide-react';
import type { ProjectDto } from '@nexus/shared';
import { TASK_STATUSES } from '@nexus/shared';
import { useCurrentWorkspace, useWorkspaceActivities, useWorkspaceProjects } from '../hooks';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/common/UserAvatar';
import { CreateProjectDialog } from '@/features/projects/components/CreateProjectDialog';
import { ActivityFeed } from '@/features/activity/components/ActivityFeed';
import { WorkspaceDigestCard } from '@/features/ai/components/WorkspaceDigestCard';
import { useCan } from '@/lib/permissions';
import { humanize } from '@/lib/utils';
import { formatDate } from '@/lib/format';

export function WorkspaceDashboardPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const workspace = useCurrentWorkspace();
  const projects = useWorkspaceProjects(workspaceId);
  const [page, setPage] = useState(1);
  const activities = useWorkspaceActivities(workspaceId, { page, limit: 15 });
  const canCreate = useCan('project:create');
  const canViewActivity = useCan('activity:view');
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={workspace.data?.name ?? <Skeleton className="h-6 w-40" />}
        description={
          workspace.data ? (
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              {workspace.data.memberCount} {workspace.data.memberCount === 1 ? 'member' : 'members'}
              {workspace.data.description ? <span> · {workspace.data.description}</span> : null}
            </span>
          ) : undefined
        }
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New project
            </Button>
          ) : null
        }
      />
      <div className="grid flex-1 grid-cols-1 gap-6 overflow-y-auto scrollbar-thin p-6 xl:grid-cols-[1fr_360px]">
        <section aria-labelledby="projects-heading">
          <h2 id="projects-heading" className="mb-3 text-sm font-semibold">
            Projects
          </h2>
          {projects.isPending ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : projects.isError ? (
            <p role="alert" className="text-[13px] text-destructive">{projects.error.message}</p>
          ) : projects.data.length === 0 ? (
            <EmptyState
              icon={<FolderKanban />}
              title="No projects yet"
              description={
                canCreate
                  ? 'Projects hold your tasks, boards and labels. Create the first one to get going.'
                  : 'You have not been added to any project yet. Ask a manager to add you.'
              }
              action={
                canCreate ? (
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> Create project
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {projects.data.map((p) => (
                <ProjectCard key={p.id} project={p} workspaceId={workspaceId} />
              ))}
            </div>
          )}
        </section>

        <div className="min-w-0 space-y-6">
          <WorkspaceDigestCard workspaceId={workspaceId} />
        {canViewActivity ? (
          <section aria-labelledby="activity-heading" className="min-w-0">
            <h2 id="activity-heading" className="mb-3 text-sm font-semibold">
              Recent activity
            </h2>
            <Card className="px-4 py-1">
              <ActivityFeed
                items={activities.data?.items}
                meta={activities.data?.meta}
                isLoading={activities.isPending}
                error={activities.error}
                onPageChange={setPage}
              />
            </Card>
          </section>
        ) : null}
        </div>
      </div>
      <CreateProjectDialog workspaceId={workspaceId} open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function ProjectCard({ project, workspaceId }: { project: ProjectDto; workspaceId: string }) {
  const total = TASK_STATUSES.reduce((sum, s) => sum + (project.taskCounts[s] ?? 0), 0);
  const done = project.taskCounts.DONE ?? 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <Link
      to={`/w/${workspaceId}/projects/${project.id}`}
      className="group flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: project.color }} aria-hidden />
          <span className="truncate text-sm font-semibold group-hover:underline">{project.name}</span>
        </div>
        <Badge variant="outline" className="font-mono">
          {project.key}
        </Badge>
      </div>
      {project.description ? (
        <p className="line-clamp-2 text-[13px] text-muted-foreground">{project.description}</p>
      ) : null}
      <div className="mt-auto space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {done}/{total} tasks done
          </span>
          <span>{humanize(project.status)}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {project.members.slice(0, 4).map((m) => (
              <UserAvatar key={m.id} user={m} size="sm" className="ring-2 ring-card" />
            ))}
            {project.members.length > 4 ? (
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-2xs ring-2 ring-card">
                +{project.members.length - 4}
              </span>
            ) : null}
          </div>
          {project.dueDate ? (
            <span className="text-xs text-muted-foreground">Due {formatDate(project.dueDate)}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

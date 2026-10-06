import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { Activity, BarChart3, FileText, FolderOpen, KanbanSquare, List, MessageSquare, Settings } from 'lucide-react';
import type { ProjectDto } from '@nexus/shared';
import { useProject } from '../hooks';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { NotFound } from '@/components/common/NotFound';
import { UserAvatar } from '@/components/common/UserAvatar';
import { isApiError } from '@/lib/api';
import { cn, humanize } from '@/lib/utils';

const ProjectContext = createContext<ProjectDto | null>(null);

/** Current project (guaranteed inside ProjectLayout children). */
export function useProjectContext(): ProjectDto {
  const p = useContext(ProjectContext);
  if (!p) throw new Error('useProjectContext must be used inside ProjectLayout');
  return p;
}

const tabs = [
  { to: 'board', label: 'Board', icon: KanbanSquare },
  { to: 'list', label: 'List', icon: List },
  { to: 'chat', label: 'Chat', icon: MessageSquare },
  { to: 'docs', label: 'Docs', icon: FileText },
  { to: 'files', label: 'Files', icon: FolderOpen },
  { to: 'analytics', label: 'Analytics', icon: BarChart3 },
  { to: 'activity', label: 'Activity', icon: Activity },
  { to: 'settings', label: 'Settings', icon: Settings },
] as const;

export function ProjectLayout() {
  const { projectId, workspaceId } = useParams<{ projectId: string; workspaceId: string }>();
  const project = useProject(projectId);

  if (project.isPending) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b px-6 py-3">
          <Skeleton className="h-6 w-56" />
          <div className="mt-3 flex gap-4">
            {tabs.map((t) => (
              <Skeleton key={t.to} className="h-4 w-14" />
            ))}
          </div>
        </div>
        <div className="flex gap-3 p-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-72" />
          ))}
        </div>
      </div>
    );
  }
  if (project.isError) {
    const nf = isApiError(project.error) && (project.error.status === 404 || project.error.status === 403);
    return (
      <NotFound
        title={nf ? 'Project not found' : 'Could not load project'}
        description={nf ? 'This project does not exist or you are not a member of it.' : project.error.message}
        to={workspaceId ? `/w/${workspaceId}` : '/'}
        actionLabel="Back to dashboard"
      />
    );
  }

  const p = project.data;
  return (
    <ProjectContext.Provider value={p}>
      <div className="flex h-full flex-col overflow-hidden">
        <header className="shrink-0 border-b px-6 pt-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden />
              <h1 className="truncate text-base font-semibold tracking-tight">{p.name}</h1>
              <Badge variant="outline" className="font-mono">
                {p.key}
              </Badge>
              {p.status !== 'ACTIVE' ? <Badge variant="secondary">{humanize(p.status)}</Badge> : null}
            </div>
            <div className="flex -space-x-1.5" aria-label={`${p.members.length} project members`}>
              {p.members.slice(0, 5).map((m) => (
                <UserAvatar key={m.id} user={m} size="sm" className="ring-2 ring-background" />
              ))}
              {p.members.length > 5 ? (
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-2xs ring-2 ring-background">
                  +{p.members.length - 5}
                </span>
              ) : null}
            </div>
          </div>
          <nav className="mt-2 flex gap-1" aria-label="Project sections">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  cn(
                    '-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground',
                    isActive ? 'border-primary font-medium text-foreground' : 'border-transparent',
                  )
                }
              >
                <t.icon className="size-3.5" aria-hidden />
                {t.label}
              </NavLink>
            ))}
          </nav>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </ProjectContext.Provider>
  );
}

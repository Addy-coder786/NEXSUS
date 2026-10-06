import { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  ChevronsLeft,
  FileText,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { WorkspaceSwitcher } from '@/features/workspaces/components/WorkspaceSwitcher';
import { CreateProjectDialog } from '@/features/projects/components/CreateProjectDialog';
import { useWorkspaceProjects } from '@/features/workspaces/hooks';
import { useCan } from '@/lib/permissions';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

export function Sidebar({ workspaceId }: { workspaceId: string | null }) {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const { projectId } = useParams<{ projectId?: string }>();
  const projects = useWorkspaceProjects(workspaceId ?? undefined);
  const canCreateProject = useCan('project:create');
  const [createOpen, setCreateOpen] = useState(false);

  const base = workspaceId ? `/w/${workspaceId}` : null;
  const nav: NavItem[] = base
    ? [
        { to: base, label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: `${base}/assistant`, label: 'Assistant', icon: Sparkles },
        { to: `${base}/chat`, label: 'Chat', icon: MessageSquare },
        { to: `${base}/meetings`, label: 'Meetings', icon: CalendarClock },
        { to: `${base}/docs`, label: 'Documents', icon: FileText },
        { to: `${base}/files`, label: 'Files', icon: FolderOpen },
        { to: `${base}/analytics`, label: 'Analytics', icon: BarChart3 },
        { to: `${base}/members`, label: 'Members', icon: Users },
        { to: `${base}/settings`, label: 'Settings', icon: Settings },
      ]
    : [];

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-60',
      )}
      aria-label="Sidebar"
    >
      <div className={cn('flex h-12 items-center gap-1 border-b px-2', collapsed && 'justify-center')}>
        <WorkspaceSwitcher collapsed={collapsed} />
        {!collapsed ? (
          <SimpleTooltip label="Collapse sidebar" side="right">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Collapse sidebar">
              <ChevronsLeft />
            </Button>
          </SimpleTooltip>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
        <ul className="space-y-0.5">
          {nav.map((item) => (
            <li key={item.to}>
              <SidebarLink item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>

        {base ? (
          <div className="mt-4">
            <div className={cn('mb-1 flex items-center justify-between px-2', collapsed && 'justify-center px-0')}>
              {!collapsed ? (
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Projects</span>
              ) : null}
              {canCreateProject ? (
                <SimpleTooltip label="New project" side="right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setCreateOpen(true)}
                    aria-label="New project"
                    className="text-muted-foreground"
                  >
                    <Plus />
                  </Button>
                </SimpleTooltip>
              ) : null}
            </div>
            <ul className="space-y-0.5">
              {projects.isLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <li key={i} className="px-2 py-1">
                      <Skeleton className={cn('h-5', collapsed ? 'w-6' : 'w-full')} />
                    </li>
                  ))
                : (projects.data ?? []).map((p) => {
                    const active = p.id === projectId;
                    const link = (
                      <NavLink
                        to={`${base}/projects/${p.id}`}
                        className={cn(
                          'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-accent',
                          active && 'bg-accent font-medium',
                          collapsed && 'justify-center px-0',
                        )}
                        aria-current={active ? 'page' : undefined}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: p.color }}
                          aria-hidden
                        />
                        {!collapsed ? <span className="truncate">{p.name}</span> : null}
                      </NavLink>
                    );
                    return (
                      <li key={p.id}>
                        {collapsed ? (
                          <SimpleTooltip label={p.name} side="right">
                            {link}
                          </SimpleTooltip>
                        ) : (
                          link
                        )}
                      </li>
                    );
                  })}
              {!projects.isLoading && (projects.data?.length ?? 0) === 0 && !collapsed ? (
                <li className="px-2 py-1 text-xs text-muted-foreground">No projects yet</li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </nav>

      {collapsed ? (
        <div className="border-t p-2">
          <SimpleTooltip label="Expand sidebar" side="right">
            <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Expand sidebar" className="w-full">
              <FolderKanban />
            </Button>
          </SimpleTooltip>
        </div>
      ) : null}

      {workspaceId ? (
        <CreateProjectDialog workspaceId={workspaceId} open={createOpen} onOpenChange={setCreateOpen} />
      ) : null}
    </aside>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-foreground/80 hover:bg-accent hover:text-foreground',
          isActive && 'bg-accent font-medium text-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed ? <span>{item.label}</span> : null}
    </NavLink>
  );
  return collapsed ? (
    <SimpleTooltip label={item.label} side="right">
      {link}
    </SimpleTooltip>
  ) : (
    link
  );
}

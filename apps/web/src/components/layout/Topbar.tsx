import { Fragment } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, LogOut, Monitor, Moon, Sun, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useAuthStore } from '@/stores/auth.store';
import { resolveTheme, useUiStore, type ThemePreference } from '@/stores/ui.store';
import { useLogout } from '@/features/auth/hooks';
import { useCurrentWorkspace } from '@/features/workspaces/hooks';
import { useProject } from '@/features/projects/hooks';
import { NotificationBell } from '@/features/notifications/components/NotificationBell';
import { RouteRooms } from '@/features/realtime/RouteRooms';

interface Crumb {
  label: string;
  to?: string;
}

function useBreadcrumbs(): Crumb[] {
  const { workspaceId, projectId } = useParams<{ workspaceId?: string; projectId?: string }>();
  const { pathname } = useLocation();
  const workspace = useCurrentWorkspace();
  const project = useProject(projectId);
  const crumbs: Crumb[] = [];
  if (workspace.data && workspaceId) crumbs.push({ label: workspace.data.name, to: `/w/${workspaceId}` });
  if (project.data && workspaceId) {
    crumbs.push({ label: project.data.name, to: `/w/${workspaceId}/projects/${project.data.id}` });
    const tail = pathname.split('/').pop();
    const tabLabel: Record<string, string> = { board: 'Board', list: 'List', chat: 'Chat', activity: 'Activity', settings: 'Settings' };
    if (tail && tabLabel[tail]) crumbs.push({ label: tabLabel[tail] as string });
  } else if (workspaceId) {
    const tail = pathname.split('/').pop();
    if (tail === 'members') crumbs.push({ label: 'Members' });
    if (tail === 'settings') crumbs.push({ label: 'Settings' });
    if (pathname.includes('/chat')) crumbs.push({ label: 'Chat' });
  }
  if (pathname.startsWith('/settings/profile')) crumbs.push({ label: 'Profile settings' });
  if (pathname.startsWith('/notifications')) crumbs.push({ label: 'Notifications' });
  return crumbs;
}

export function Topbar() {
  const crumbs = useBreadcrumbs();
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={`${c.label}-${i}`}>
              {i > 0 ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
              {c.to && !last ? (
                <Link to={c.to} className="truncate text-muted-foreground hover:text-foreground">
                  {c.label}
                </Link>
              ) : (
                <span className="truncate font-medium" aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </nav>
      <div className="flex items-center gap-1">
        <RouteRooms />
        <NotificationBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

export function ThemeToggle() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const resolved = resolveTheme(theme);
  return (
    <SimpleTooltip label={resolved === 'dark' ? 'Switch to light' : 'Switch to dark'}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle theme"
        onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
      >
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </SimpleTooltip>
  );
}

function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Account menu"
        >
          <UserAvatar user={user} size="md" showPresence />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-[13px] font-medium text-foreground">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings/profile')}>
          <User /> Profile settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 size-3.5" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 size-3.5" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="mr-2 size-3.5" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { FullScreenSpinner } from '@/components/ui/spinner';
import { NotFound } from '@/components/common/NotFound';
import { useWorkspace, useWorkspaces } from '@/features/workspaces/hooks';
import { isApiError } from '@/lib/api';

/** Blocks until the auth bootstrap resolves; sends anonymous users to /login remembering `from`. */
export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'idle' || status === 'loading') return <FullScreenSpinner label="Loading your workspace" />;
  if (status === 'anon') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}

/** Only for signed-out visitors (login/register...). Authenticated users bounce to `from` or home. */
export function RequireAnon() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'idle' || status === 'loading') return <FullScreenSpinner />;
  if (status === 'authed') {
    const state = location.state as { from?: string } | null;
    return <Navigate to={state?.from ?? '/'} replace />;
  }
  return <Outlet />;
}

/** Loads the workspace from the URL, persists it as "last used", and 404s when inaccessible. */
export function RequireWorkspace() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const workspace = useWorkspace(workspaceId);

  useEffect(() => {
    if (workspace.data) setCurrent(workspace.data.id);
  }, [workspace.data, setCurrent]);

  if (workspace.isPending) {
    return <FullScreenSpinner label="Opening workspace" />;
  }
  if (workspace.isError) {
    const notFound = isApiError(workspace.error) && (workspace.error.status === 404 || workspace.error.status === 403);
    return (
      <NotFound
        title={notFound ? 'Workspace not found' : 'Could not load workspace'}
        description={
          notFound
            ? 'This workspace does not exist or you are not a member of it.'
            : workspace.error.message
        }
        to="/"
        actionLabel="Back to my workspaces"
      />
    );
  }
  return <Outlet />;
}

/** `/` → last used workspace, first workspace, or onboarding. */
export function RootRedirect() {
  const stored = useWorkspaceStore((s) => s.currentWorkspaceId);
  const workspaces = useWorkspaces();
  if (workspaces.isPending) return <FullScreenSpinner />;
  if (workspaces.isError) {
    return <NotFound title="Could not load workspaces" description={workspaces.error.message} to="/login" actionLabel="Sign in again" />;
  }
  const list = workspaces.data;
  const target = list.find((w) => w.id === stored) ?? list[0];
  if (!target) return <Navigate to="/onboarding" replace />;
  return <Navigate to={`/w/${target.id}`} replace />;
}

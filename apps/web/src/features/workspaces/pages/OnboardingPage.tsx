import { Navigate } from 'react-router-dom';
import { CreateWorkspaceForm } from '../components/CreateWorkspaceDialog';
import { useWorkspaces } from '../hooks';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { FullScreenSpinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/features/auth/hooks';
import { Button } from '@/components/ui/button';

export function OnboardingPage() {
  const user = useAuthStore((s) => s.user);
  const workspaces = useWorkspaces();
  const logout = useLogout();

  if (workspaces.isPending) return <FullScreenSpinner />;
  const first = workspaces.data?.[0];
  if (first) return <Navigate to={`/w/${first.id}`} replace />;

  return (
    <AuthLayout
      title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
      description="Create your first workspace to get started. You can invite your team right after."
      footer={
        <Button variant="link" className="text-muted-foreground" onClick={() => logout.mutate()}>
          Sign out
        </Button>
      }
    >
      <CreateWorkspaceForm submitLabel="Create workspace" />
    </AuthLayout>
  );
}

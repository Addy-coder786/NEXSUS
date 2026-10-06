import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAcceptInvitation, useInvitationPreview } from '../hooks';
import { RoleBadge } from '../components/RoleBadge';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { SkeletonLines } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { formatDate } from '@/lib/format';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useLogout } from '@/features/auth/hooks';

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const setCurrent = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  const logout = useLogout();
  const here = `/invite/${token ?? ''}`;

  const onAccept = () => {
    if (!token) return;
    accept.mutate(token, {
      onSuccess: (ws) => {
        setCurrent(ws.id);
        toast.success(`You joined ${ws.name}`);
        navigate(`/w/${ws.id}`, { replace: true });
      },
      onError: (error) => toast.error(getErrorMessage(error)),
    });
  };

  const inv = preview.data;
  const emailMismatch = Boolean(inv && user && inv.email.toLowerCase() !== user.email.toLowerCase());
  const expired = inv ? inv.status !== 'PENDING' || new Date(inv.expiresAt).getTime() < Date.now() : false;

  return (
    <AuthLayout title="Workspace invitation">
      {preview.isPending ? (
        <SkeletonLines lines={4} />
      ) : preview.isError ? (
        <div className="space-y-3 text-center">
          <p role="alert" className="text-[13px] text-destructive">
            {isApiError(preview.error) && preview.error.status === 404
              ? 'This invitation link is invalid or has been revoked.'
              : preview.error.message}
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      ) : inv ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{inv.workspace.name}</p>
              <p className="text-xs text-muted-foreground">Invited by {inv.invitedBy.name}</p>
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate">{inv.email}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>
              <RoleBadge role={inv.role} />
            </dd>
            <dt className="text-muted-foreground">Expires</dt>
            <dd>{formatDate(inv.expiresAt)}</dd>
          </dl>

          {expired ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
              This invitation is no longer valid ({inv.status.toLowerCase()}). Ask the sender for a new one.
            </p>
          ) : status === 'authed' && user ? (
            emailMismatch ? (
              <div className="space-y-2">
                <p role="alert" className="rounded-md bg-warning/15 px-3 py-2 text-[13px]">
                  You are signed in as <strong>{user.email}</strong>, but this invitation was sent to{' '}
                  <strong>{inv.email}</strong>. Sign out and use the invited account.
                </p>
                <Button variant="outline" className="w-full" onClick={() => logout.mutate()} loading={logout.isPending}>
                  Sign out
                </Button>
              </div>
            ) : (
              <Button className="w-full" onClick={onAccept} loading={accept.isPending}>
                Accept invitation
              </Button>
            )
          ) : (
            <div className="space-y-2">
              <Button asChild className="w-full">
                <Link to="/login" state={{ from: here }}>
                  Sign in to accept
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full">
                <Link to="/register" state={{ from: here }}>
                  Create an account
                </Link>
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </AuthLayout>
  );
}

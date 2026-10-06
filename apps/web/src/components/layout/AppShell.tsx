import { Outlet } from 'react-router-dom';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useAuthStore } from '@/stores/auth.store';
import { useResendVerification } from '@/features/auth/hooks';
import { useCurrentWorkspaceId } from '@/features/workspaces/hooks';
import { CommandPalette } from '@/features/search/components/CommandPalette';
import { AssistantLauncher } from '@/features/ai/components/AssistantLauncher';
import { getErrorMessage } from '@/lib/api';

export function AppShell() {
  const workspaceId = useCurrentWorkspaceId();
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <CommandPalette />
      <AssistantLauncher />
      <Sidebar workspaceId={workspaceId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <EmailVerificationBanner />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function EmailVerificationBanner() {
  const user = useAuthStore((s) => s.user);
  const resend = useResendVerification();
  if (!user || user.emailVerified) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b bg-warning/15 px-4 py-1.5 text-[13px]"
    >
      <div className="flex items-center gap-2">
        <MailWarning className="size-4 shrink-0" aria-hidden />
        <span>
          Please verify your email address <strong>{user.email}</strong> to unlock all actions.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        loading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => toast.success('Verification email sent'),
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      >
        Resend verification
      </Button>
    </div>
  );
}

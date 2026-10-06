import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { useVerifyEmail } from '../hooks';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAuthStore } from '@/stores/auth.store';

export function VerifyEmailPage() {
  const [search] = useSearchParams();
  const token = search.get('token');
  const verify = useVerifyEmail();
  const status = useAuthStore((s) => s.status);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  const homeHref = status === 'authed' ? '/' : '/login';

  return (
    <AuthLayout title="Email verification">
      <div className="flex flex-col items-center gap-3 text-center">
        {!token ? (
          <>
            <XCircle className="size-8 text-destructive" aria-hidden />
            <p className="text-[13px]">This verification link is missing its token.</p>
          </>
        ) : verify.isPending || verify.isIdle ? (
          <>
            <Spinner label="Verifying" />
            <p className="text-[13px] text-muted-foreground">Verifying your email…</p>
          </>
        ) : verify.isSuccess ? (
          <>
            <CheckCircle2 className="size-8 text-success" aria-hidden />
            <p className="text-[13px]">Your email has been verified. You are all set.</p>
          </>
        ) : (
          <>
            <XCircle className="size-8 text-destructive" aria-hidden />
            <p role="alert" className="text-[13px]">
              {verify.error.message || 'This link is invalid or has expired.'}
            </p>
          </>
        )}
        <Button asChild className="mt-2 w-full">
          <Link to={homeHref}>{status === 'authed' ? 'Continue to NEXUS' : 'Sign in'}</Link>
        </Button>
      </div>
    </AuthLayout>
  );
}

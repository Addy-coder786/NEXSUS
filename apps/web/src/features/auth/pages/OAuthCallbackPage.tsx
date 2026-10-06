import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRefreshMe } from '../hooks';
import { FullScreenSpinner } from '@/components/ui/spinner';

/** Safe internal path only: never redirect to another origin. */
function safeRedirect(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export function OAuthCallbackPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useRefreshMe();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const redirect = safeRedirect(search.get('redirect'));
    refresh.mutate(undefined, {
      onSuccess: () => navigate(redirect, { replace: true }),
      onError: () => navigate('/login?error=oauth_failed', { replace: true }),
    });
  }, [search, navigate, refresh]);

  return <FullScreenSpinner label="Signing you in" />;
}

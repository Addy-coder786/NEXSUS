import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOAuthProviders } from '../hooks';
import { oauthStartUrl } from '../api';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.1 3.5-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.2v3.1C3.2 21.3 7.3 24 12 24z"
      />
      <path fill="#FBBC05" d="M5.3 14.3c-.5-1.5-.5-3.1 0-4.6V6.6H1.2a12 12 0 0 0 0 10.8l4.1-3.1z" />
      <path
        fill="#EA4335"
        d="M12 4.7c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.6l4.1 3.1c.9-2.9 3.6-5 6.7-5z"
      />
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path fill="#E01E5A" d="M5 15a2.5 2.5 0 1 1-2.5-2.5H5V15zm1.3 0a2.5 2.5 0 0 1 5 0v6.3a2.5 2.5 0 0 1-5 0V15z" />
      <path fill="#36C5F0" d="M8.8 5a2.5 2.5 0 1 1 2.5-2.5V5H8.8zm0 1.3a2.5 2.5 0 0 1 0 5H2.5a2.5 2.5 0 0 1 0-5h6.3z" />
      <path fill="#2EB67D" d="M19 8.8a2.5 2.5 0 1 1 2.5 2.5H19V8.8zm-1.3 0a2.5 2.5 0 0 1-5 0V2.5a2.5 2.5 0 0 1 5 0v6.3z" />
      <path fill="#ECB22E" d="M15.2 19a2.5 2.5 0 1 1-2.5 2.5V19h2.5zm0-1.3a2.5 2.5 0 0 1 0-5h6.3a2.5 2.5 0 0 1 0 5h-6.3z" />
    </svg>
  );
}

export function OAuthButtons({ redirect = '/' }: { redirect?: string }) {
  const providers = useOAuthProviders();
  if (providers.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  const data = providers.data;
  if (!data || (!data.google && !data.slack)) return null;
  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-2xs uppercase tracking-wider">
          <span className="bg-card px-2 text-muted-foreground">or continue with</span>
        </div>
      </div>
      <div className="grid gap-2">
        {data.google ? (
          <Button asChild variant="outline" className="w-full">
            <a href={oauthStartUrl('google', redirect)}>
              <GoogleIcon /> Google
            </a>
          </Button>
        ) : null}
        {data.slack ? (
          <Button asChild variant="outline" className="w-full">
            <a href={oauthStartUrl('slack', redirect)}>
              <SlackIcon /> Slack
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

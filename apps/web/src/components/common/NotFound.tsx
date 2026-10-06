import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NotFound({
  title = 'Page not found',
  description = 'The page you are looking for does not exist or you do not have access to it.',
  to = '/',
  actionLabel = 'Go home',
}: {
  title?: string;
  description?: string;
  to?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-5" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="max-w-md text-[13px] text-muted-foreground">{description}</p>
      <Button asChild variant="outline">
        <Link to={to}>{actionLabel}</Link>
      </Button>
    </div>
  );
}

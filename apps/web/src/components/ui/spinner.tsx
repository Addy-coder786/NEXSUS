import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
    </span>
  );
}

export function FullScreenSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="[&_svg]:size-6" label={label} />
        <span className="text-[13px] text-muted-foreground">{label}…</span>
      </div>
    </div>
  );
}

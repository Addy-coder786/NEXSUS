import { Check, CloudOff, RefreshCw } from 'lucide-react';
import type { SaveStatus } from '../autosave';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const LABELS: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  conflict: 'Conflict',
  error: 'Not saved',
};

export function SaveIndicator({ status, className }: { status: SaveStatus; className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-muted-foreground',
        status === 'conflict' && 'text-warning',
        status === 'error' && 'text-destructive',
        className,
      )}
    >
      {status === 'saving' ? <Spinner className="[&_svg]:size-3" label="Saving" /> : null}
      {status === 'saved' ? <Check className="size-3.5" aria-hidden /> : null}
      {status === 'unsaved' ? <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden /> : null}
      {status === 'conflict' ? <RefreshCw className="size-3.5" aria-hidden /> : null}
      {status === 'error' ? <CloudOff className="size-3.5" aria-hidden /> : null}
      {LABELS[status]}
    </span>
  );
}

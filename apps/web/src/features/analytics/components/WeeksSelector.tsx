import { WEEK_OPTIONS, type Weeks } from '../hooks';
import { cn } from '@/lib/utils';

export function WeeksSelector({ value, onChange, className }: { value: Weeks; onChange: (w: Weeks) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Trend window" className={cn('inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5', className)}>
      {WEEK_OPTIONS.map((w) => (
        <button
          key={w}
          type="button"
          role="radio"
          aria-checked={value === w}
          onClick={() => onChange(w)}
          className={cn(
            'h-7 rounded-sm px-2.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === w && 'bg-card text-foreground shadow-sm',
          )}
        >
          {w} wk
        </button>
      ))}
    </div>
  );
}

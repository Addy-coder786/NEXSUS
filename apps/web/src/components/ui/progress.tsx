import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0..max */
  value: number;
  max?: number;
  indicatorClassName?: string;
  /** Inline colour for the filled part (e.g. a CSS variable). */
  indicatorColor?: string;
  size?: 'sm' | 'md';
}

/** Determinate progress bar with the ARIA progressbar contract. Pass `aria-label` or `aria-labelledby`. */
export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, indicatorClassName, indicatorColor, size = 'md', ...props }, ref) => {
    const safeMax = max > 0 ? max : 100;
    const clamped = Math.min(Math.max(value, 0), safeMax);
    const pct = (clamped / safeMax) * 100;
    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={Math.round(clamped)}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-chart-track',
          size === 'sm' ? 'h-1.5' : 'h-2',
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none',
            indicatorClassName,
          )}
          style={{ width: `${pct}%`, backgroundColor: indicatorColor }}
        />
      </div>
    );
  },
);
Progress.displayName = 'Progress';

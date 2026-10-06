import type { TaskPriority } from '@nexus/shared';
import { AlertOctagon, SignalHigh, SignalLow, SignalMedium } from 'lucide-react';
import { PRIORITY_LABELS } from '../constants';
import { cn } from '@/lib/utils';

const config: Record<TaskPriority, { icon: typeof SignalLow; className: string }> = {
  LOW: { icon: SignalLow, className: 'text-muted-foreground' },
  MEDIUM: { icon: SignalMedium, className: 'text-foreground/70' },
  HIGH: { icon: SignalHigh, className: 'text-warning' },
  URGENT: { icon: AlertOctagon, className: 'text-destructive' },
};

export function PriorityIcon({
  priority,
  className,
  withLabel = false,
}: {
  priority: TaskPriority;
  className?: string;
  withLabel?: boolean;
}) {
  const { icon: Icon, className: color } = config[priority];
  const label = PRIORITY_LABELS[priority];
  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={`Priority: ${label}`}>
      <Icon className={cn('size-3.5 shrink-0', color)} aria-hidden />
      {withLabel ? <span className="text-xs">{label}</span> : <span className="sr-only">{label} priority</span>}
    </span>
  );
}

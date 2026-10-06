import { HardDrive } from 'lucide-react';
import { useStorageUsage } from '../hooks';
import { formatBytes } from '../utils';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function StorageUsageBar({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const usage = useStorageUsage(workspaceId);
  if (usage.isPending) return <Skeleton className={cn('h-8 w-56', className)} />;
  if (usage.isError || !usage.data) return null;
  const { usedBytes, limitBytes, fileCount } = usage.data;
  const pct = limitBytes > 0 ? Math.min(100, (usedBytes / limitBytes) * 100) : 0;
  const tone = pct >= 95 ? 'var(--destructive)' : pct >= 80 ? 'var(--warning)' : undefined;
  return (
    <div className={cn('flex min-w-56 flex-col gap-1 text-xs text-muted-foreground', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5">
          <HardDrive className="size-3.5" aria-hidden />
          Storage
        </span>
        <span className="tabular-nums">
          {formatBytes(usedBytes)} of {formatBytes(limitBytes, 0)} · {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
      <Progress value={pct} size="sm" indicatorColor={tone} aria-label="Storage used" />
    </div>
  );
}

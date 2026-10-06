import { Activity } from 'lucide-react';
import type { ActivityDto, PaginationMeta } from '@nexus/shared';
import { ActivityItem } from './ActivityItem';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

interface ActivityFeedProps {
  items: ActivityDto[] | undefined;
  meta?: PaginationMeta;
  isLoading: boolean;
  error?: Error | null;
  onPageChange?: (page: number) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function ActivityFeed({
  items,
  meta,
  isLoading,
  error,
  onPageChange,
  emptyTitle = 'No activity yet',
  emptyDescription = 'Changes to projects, tasks and members will show up here.',
}: ActivityFeedProps) {
  if (isLoading && !items) {
    return (
      <ul className="divide-y" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex gap-3 py-2.5">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-16" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  if (error) {
    return <p role="alert" className="text-[13px] text-destructive">{error.message}</p>;
  }
  if (!items || items.length === 0) {
    return <EmptyState icon={<Activity />} title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div>
      <ul className="divide-y">
        {items.map((a) => (
          <ActivityItem key={a.id} activity={a} />
        ))}
      </ul>
      {meta && meta.totalPages > 1 && onPageChange ? (
        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>
            Page {meta.page} of {meta.totalPages}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={meta.page >= meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

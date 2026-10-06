import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import type { NotificationDto } from '@nexus/shared';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks';
import { NotificationItem } from './NotificationItem';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const PREVIEW_COUNT = 10;

export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const list = useNotifications({ limit: PREVIEW_COUNT });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const count = unread.data?.total ?? 0;
  const items = (list.data?.pages[0]?.items ?? []).slice(0, PREVIEW_COUNT);

  const openNotification = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <SimpleTooltip label="Notifications">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
            className={cn('relative', className)}
          >
            <Bell />
            {count > 0 ? (
              <span
                data-testid="notification-badge"
                aria-hidden
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground ring-2 ring-background"
              >
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <h2 className="text-[13px] font-semibold">Notifications</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
            disabled={count === 0 || markAll.isPending}
            onClick={() => markAll.mutate(undefined)}
          >
            <CheckCheck className="size-3.5" aria-hidden />
            Mark all read
          </Button>
        </div>
        <ul className="max-h-[420px] space-y-0.5 overflow-y-auto scrollbar-thin p-1" aria-label="Latest notifications" aria-busy={list.isPending}>
          {list.isPending
            ? Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="flex gap-3 px-2 py-2">
                  <Skeleton className="size-6 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </li>
              ))
            : items.map((n) => <NotificationItem key={n.id} notification={n} onOpen={openNotification} compact />)}
          {!list.isPending && items.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13px] text-muted-foreground">You're all caught up.</li>
          ) : null}
        </ul>
        <div className="border-t p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center text-xs"
            onClick={() => {
              setOpen(false);
              navigate('/notifications');
            }}
          >
            View all
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

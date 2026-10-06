import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { isToday, isYesterday, parseISO, startOfDay, format, isThisYear } from 'date-fns';
import type { NotificationDto } from '@nexus/shared';
import { NotificationItem } from '../components/NotificationItem';
import { useDeleteNotification, useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../hooks';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkspaces } from '@/features/workspaces/hooks';

const ALL = '__all__';

function dayLabel(iso: string): string {
  const d = parseISO(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, isThisYear(d) ? 'EEEE, MMM d' : 'MMM d, yyyy');
}

function groupByDay(items: NotificationDto[]): Array<{ key: string; label: string; items: NotificationDto[] }> {
  const groups: Array<{ key: string; label: string; items: NotificationDto[] }> = [];
  for (const n of items) {
    const key = startOfDay(parseISO(n.createdAt)).toISOString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(n);
    else groups.push({ key, label: dayLabel(n.createdAt), items: [n] });
  }
  return groups;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [workspaceId, setWorkspaceId] = useState<string>(ALL);
  const workspaces = useWorkspaces();
  const unreadCount = useUnreadCount();
  const filters = useMemo(
    () => ({ unread: tab === 'unread' || undefined, workspaceId: workspaceId === ALL ? undefined : workspaceId, limit: 25 }),
    [tab, workspaceId],
  );
  const list = useNotifications(filters);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const remove = useDeleteNotification();

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const groups = useMemo(() => groupByDay(items), [items]);
  const scopedUnread = workspaceId === ALL ? (unreadCount.data?.total ?? 0) : (unreadCount.data?.byWorkspace[workspaceId] ?? 0);

  const open = (n: NotificationDto) => {
    if (!n.readAt) markRead.mutate(n);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight">Notifications</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'unread')}>
          <TabsList aria-label="Filter notifications">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              {scopedUnread > 0 ? (
                <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{scopedUnread > 99 ? '99+' : scopedUnread}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger size="sm" className="w-48" aria-label="Filter by workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All workspaces</SelectItem>
              {(workspaces.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={scopedUnread === 0 || markAll.isPending}
            loading={markAll.isPending}
            onClick={() => markAll.mutate(workspaceId === ALL ? undefined : workspaceId)}
          >
            <CheckCheck />
            Mark all read
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-3">
        <div className="mx-auto max-w-3xl">
          {list.isPending ? (
            <ul className="space-y-2" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex gap-3 px-3 py-2.5">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </li>
              ))}
            </ul>
          ) : list.isError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {list.error.message}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              description={
                tab === 'unread'
                  ? 'You are all caught up.'
                  : 'Mentions, assignments, comments and deadline reminders will show up here.'
              }
            />
          ) : (
            <>
              {groups.map((g) => (
                <section key={g.key} aria-label={g.label} className="mb-4">
                  <h2 className="sticky top-0 z-10 -mx-1 mb-1 bg-background/95 px-1 py-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {g.label}
                  </h2>
                  <ul className="space-y-0.5">
                    {g.items.map((n) => (
                      <NotificationItem key={n.id} notification={n} onOpen={open} onDelete={(x) => remove.mutate(x)} />
                    ))}
                  </ul>
                </section>
              ))}
              {list.hasNextPage ? (
                <div className="flex justify-center py-3">
                  <Button variant="outline" size="sm" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

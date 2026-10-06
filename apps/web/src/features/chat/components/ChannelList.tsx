import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Hash, Lock, MessageSquarePlus, Plus, Search, Users } from 'lucide-react';
import type { ChannelDto } from '@nexus/shared';
import { useChatPrefs } from '../store';
import { sortChannels } from '../utils';
import { CreateChannelDialog } from './CreateChannelDialog';
import { NewDmDialog } from './NewDmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface ChannelListProps {
  workspaceId: string;
  channels: ChannelDto[] | undefined;
  isLoading: boolean;
  activeChannelId: string | null;
  /** Called after a channel is picked (lets the mobile overlay close). */
  onNavigate?: () => void;
  className?: string;
}

export function ChannelList({ workspaceId, channels, isLoading, activeChannelId, onNavigate, className }: ChannelListProps) {
  const canCreate = useCan('channel:create');
  const showArchived = useChatPrefs((s) => s.showArchived);
  const setShowArchived = useChatPrefs((s) => s.setShowArchived);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = sortChannels(channels ?? []).filter(
      (c) => (showArchived || !c.isArchived) && (!q || c.name.toLowerCase().includes(q) || c.slug.includes(q)),
    );
    return {
      project: visible.filter((c) => c.projectId),
      channels: visible.filter((c) => !c.projectId && c.type !== 'DM'),
      dms: visible.filter((c) => c.type === 'DM'),
      archivedCount: (channels ?? []).filter((c) => c.isArchived).length,
    };
  }, [channels, search, showArchived]);

  return (
    <nav aria-label="Channels" className={cn('flex h-full w-full flex-col bg-sidebar', className)}>
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <h2 className="flex-1 text-sm font-semibold">Chat</h2>
        <SimpleTooltip label="New direct message">
          <Button variant="ghost" size="icon-sm" aria-label="New direct message" onClick={() => setDmOpen(true)}>
            <MessageSquarePlus />
          </Button>
        </SimpleTooltip>
        {canCreate ? (
          <SimpleTooltip label="New channel">
            <Button variant="ghost" size="icon-sm" aria-label="New channel" onClick={() => setCreateOpen(true)}>
              <Plus />
            </Button>
          </SimpleTooltip>
        ) : null}
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a channel"
            aria-label="Find a channel"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-2">
        {isLoading ? (
          <ul className="space-y-1 px-1 pt-1" aria-busy="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <li key={i}>
                <Skeleton className="h-6 w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <Section title="Project channels" channels={sections.project} workspaceId={workspaceId} activeChannelId={activeChannelId} onNavigate={onNavigate} />
            <Section title="Channels" channels={sections.channels} workspaceId={workspaceId} activeChannelId={activeChannelId} onNavigate={onNavigate} />
            <Section title="Direct messages" channels={sections.dms} workspaceId={workspaceId} activeChannelId={activeChannelId} onNavigate={onNavigate}
              empty={
                <button type="button" onClick={() => setDmOpen(true)} className="w-full rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent">
                  Start a conversation…
                </button>
              }
            />
          </>
        )}
      </div>

      {sections.archivedCount > 0 ? (
        <div className="border-t px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--primary)]"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            <Archive className="size-3.5" aria-hidden />
            Show archived ({sections.archivedCount})
          </label>
        </div>
      ) : null}

      <CreateChannelDialog workspaceId={workspaceId} open={createOpen} onOpenChange={setCreateOpen} />
      <NewDmDialog workspaceId={workspaceId} open={dmOpen} onOpenChange={setDmOpen} />
    </nav>
  );
}

function Section({
  title,
  channels,
  workspaceId,
  activeChannelId,
  onNavigate,
  empty,
}: {
  title: string;
  channels: ChannelDto[];
  workspaceId: string;
  activeChannelId: string | null;
  onNavigate?: () => void;
  empty?: React.ReactNode;
}) {
  if (channels.length === 0 && !empty) return null;
  return (
    <section className="mt-2" aria-label={title}>
      <h3 className="mb-0.5 px-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="space-y-px">
        {channels.map((c) => (
          <ChannelRow key={c.id} channel={c} workspaceId={workspaceId} active={c.id === activeChannelId} onNavigate={onNavigate} />
        ))}
        {channels.length === 0 && empty ? <li>{empty}</li> : null}
      </ul>
    </section>
  );
}

function ChannelRow({
  channel,
  workspaceId,
  active,
  onNavigate,
}: {
  channel: ChannelDto;
  workspaceId: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const muted = channel.muted;
  const unread = channel.unreadCount > 0 && !active;
  const isDm = channel.type === 'DM';
  const other = isDm ? channel.participants?.[0] : undefined;
  const Icon = channel.type === 'PRIVATE' ? Lock : channel.type === 'GROUP' ? Users : Hash;
  return (
    <li>
      <Link
        to={`/w/${workspaceId}/chat/${channel.id}`}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={`${channel.name}${unread ? `, ${channel.unreadCount} unread` : ''}${channel.isArchived ? ', archived' : ''}`}
        className={cn(
          'flex h-7 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-accent',
          active ? 'bg-accent font-medium text-foreground' : 'text-foreground/80',
          unread && !muted && 'font-semibold text-foreground',
          channel.isArchived && 'opacity-60',
          muted && !active && 'text-muted-foreground',
        )}
      >
        {isDm ? (
          <UserAvatar user={other ?? { name: channel.name, avatarUrl: null }} size="xs" showPresence />
        ) : (
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
        {channel.isArchived ? <Archive className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        {unread ? (
          <span
            aria-hidden
            className={cn(
              'ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
              muted ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground',
            )}
          >
            {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

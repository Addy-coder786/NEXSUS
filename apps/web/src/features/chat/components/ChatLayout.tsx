import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import type { ChannelDto, UserPublicDto } from '@nexus/shared';
import { ChannelList } from './ChannelList';
import { Conversation } from './Conversation';
import { ThreadPanel } from './ThreadPanel';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

interface ChatLayoutProps {
  workspaceId: string;
  channels: ChannelDto[] | undefined;
  channelsLoading: boolean;
  channel: ChannelDto | undefined;
}

/** Channel sidebar + conversation + optional thread panel. The sidebar becomes an overlay under 1024px. */
export function ChatLayout({ workspaceId, channels, channelsLoading, channel }: ChatLayoutProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get('thread');
  const [listOpen, setListOpen] = useState(false);
  const [members, setMembers] = useState<UserPublicDto[]>([]);

  useEffect(() => {
    setListOpen(false);
  }, [channel?.id]);

  const openThread = useCallback(
    (messageId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('thread', messageId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const closeThread = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('thread');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden">
      <aside
        className={cn(
          'absolute inset-y-0 left-0 z-30 w-64 border-r shadow-xl transition-transform lg:static lg:z-auto lg:translate-x-0 lg:shadow-none',
          listOpen || !channel ? 'translate-x-0' : '-translate-x-full',
          !channel && 'static w-full lg:w-64',
        )}
      >
        <ChannelList
          workspaceId={workspaceId}
          channels={channels}
          isLoading={channelsLoading}
          activeChannelId={channel?.id ?? null}
          onNavigate={() => setListOpen(false)}
        />
      </aside>
      {listOpen && channel ? (
        <button
          type="button"
          aria-label="Hide channels"
          className="absolute inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setListOpen(false)}
        />
      ) : null}

      {channel ? (
        <Conversation
          key={channel.id}
          channel={channel}
          workspaceId={workspaceId}
          onOpenThread={openThread}
          onShowChannels={() => setListOpen(true)}
          onMembers={setMembers}
          className={cn(threadId && 'hidden lg:flex')}
        />
      ) : !channelsLoading ? (
        <div className="hidden flex-1 items-center justify-center p-6 lg:flex">
          <EmptyState
            icon={<MessageSquare />}
            title="Pick a channel"
            description="Choose a channel or direct message from the list to start chatting."
          />
        </div>
      ) : null}

      {channel && threadId ? (
        <div className="flex min-w-0 flex-1 lg:w-[380px] lg:flex-none lg:border-l xl:w-[420px]">
          <ThreadPanel
            key={threadId}
            messageId={threadId}
            channel={channel}
            workspaceId={workspaceId}
            members={members}
            onClose={closeThread}
          />
        </div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChannelDto, UserPublicDto } from '@nexus/shared';
import type { ChatMessage } from '../cache';
import {
  newClientId,
  useChannelMembers,
  useDeleteMessage,
  useEditMessage,
  useMarkRead,
  useMessages,
  useSendMessage,
  useToggleReaction,
  useUnread,
} from '../hooks';
import { composerDisabledReason } from '../utils';
import { ChannelHeader } from './ChannelHeader';
import { EmptyChannel } from './EmptyChannel';
import { MessageComposer } from './MessageComposer';
import type { MessageActions } from './MessageItem';
import { MessageList } from './MessageList';
import { TypingIndicator } from './TypingIndicator';
import { useChannelRoom, useTyping } from '@/features/realtime/hooks';
import { useAuthStore } from '@/stores/auth.store';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface ConversationProps {
  channel: ChannelDto;
  workspaceId: string;
  onOpenThread?: (messageId: string) => void;
  onShowChannels?: () => void;
  /** Lets the parent (thread panel) reuse the member list. */
  onMembers?: (members: UserPublicDto[]) => void;
  className?: string;
}

export function Conversation({ channel, workspaceId, onOpenThread, onShowChannels, onMembers, className }: ConversationProps) {
  const user = useAuthStore((s) => s.user);
  const canSend = useCan('message:send');
  const canManage = useCan('channel:manage');
  useChannelRoom(channel.id);

  const messages = useMessages(channel.id);
  const membersQuery = useChannelMembers(channel.id);
  const unread = useUnread(workspaceId);
  const typing = useTyping(channel.id);
  const send = useSendMessage(channel.id);
  const edit = useEditMessage();
  const remove = useDeleteMessage();
  const react = useToggleReaction();
  const markRead = useMarkRead();

  const members = useMemo<UserPublicDto[]>(() => {
    if (membersQuery.data) return membersQuery.data.map((m) => m.user);
    return channel.participants ?? [];
  }, [membersQuery.data, channel.participants]);
  useEffect(() => {
    onMembers?.(members);
  }, [members, onMembers]);

  // Capture lastReadAt once per channel so the "New messages" divider stays put while we mark read.
  const [lastReadAt, setLastReadAt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastReadAt !== undefined || !unread.data) return;
    setLastReadAt(unread.data.channels.find((c) => c.channelId === channel.id)?.lastReadAt ?? null);
  }, [unread.data, channel.id, lastReadAt]);

  const flat = useMemo<ChatMessage[]>(() => {
    const pages = messages.data?.pages ?? [];
    const out: ChatMessage[] = [];
    for (let i = pages.length - 1; i >= 0; i--) {
      const page = pages[i] ?? [];
      for (let j = page.length - 1; j >= 0; j--) out.push(page[j] as ChatMessage);
    }
    return out;
  }, [messages.data]);

  // Mark the channel read while it is open and visible: when it has unread messages, and whenever a
  // new message from someone else arrives (the bridge suppresses unread pushes for the open channel).
  const lastIncoming = useMemo(() => {
    for (let i = flat.length - 1; i >= 0; i--) {
      const m = flat[i];
      if (m && !m.pending && !m.failed && m.author?.id !== user?.id) return m.id;
    }
    return null;
  }, [flat, user?.id]);
  const seenIncomingRef = useRef<string | null | undefined>(undefined);
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (!messages.data) return;
    const firstSeen = seenIncomingRef.current === undefined;
    const newIncoming = !firstSeen && lastIncoming !== seenIncomingRef.current;
    seenIncomingRef.current = lastIncoming;
    if (channel.unreadCount <= 0 && !newIncoming) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (markTimer.current) clearTimeout(markTimer.current);
    markTimer.current = setTimeout(() => markReadMutate({ channelId: channel.id }), 400);
    return () => {
      if (markTimer.current) clearTimeout(markTimer.current);
    };
  }, [channel.id, channel.unreadCount, messages.data, lastIncoming, markReadMutate]);

  const retry = useCallback(
    (m: ChatMessage) => {
      if (!m.clientId) return;
      send.mutate({
        clientId: m.clientId,
        body: m.body,
        mentions: m.mentions,
        attachmentIds: m.attachments.map((f) => f.id),
        attachments: m.attachments,
      });
    },
    [send],
  );

  const mentionNames = useMemo(() => members.map((m) => m.name), [members]);
  const actions: MessageActions = useMemo(
    () => ({
      canReact: canSend && !channel.isReadOnly && !channel.isArchived,
      canManage,
      mentionNames,
      myId: user?.id ?? null,
      myName: user?.name ?? null,
      showThreadActions: Boolean(onOpenThread) && !channel.isArchived,
      onReply: onOpenThread ? (m) => onOpenThread(m.id) : undefined,
      onEdit: (m, body) => edit.mutate({ messageId: m.id, body }),
      onDelete: (m) => remove.mutate(m),
      onToggleReaction: (m, emoji) => react.mutate({ message: m, emoji }),
      onRetry: retry,
    }),
    [canSend, canManage, channel.isReadOnly, channel.isArchived, mentionNames, user?.id, user?.name, onOpenThread, edit, remove, react, retry],
  );

  return (
    <section aria-label={`${channel.name} conversation`} className={cn('flex h-full min-w-0 flex-1 flex-col', className)}>
      <ChannelHeader channel={channel} workspaceId={workspaceId} onShowChannels={onShowChannels} />
      {messages.isError ? (
        <p role="alert" className="px-4 py-3 text-[13px] text-destructive">
          Could not load messages: {messages.error.message}
        </p>
      ) : (
        <MessageList
          key={channel.id}
          messages={flat}
          lastReadAt={lastReadAt}
          isLoading={messages.isPending}
          hasMore={Boolean(messages.hasNextPage)}
          isFetchingMore={messages.isFetchingNextPage}
          onLoadMore={() => void messages.fetchNextPage()}
          actions={actions}
          emptyState={<EmptyChannel channel={channel} />}
        />
      )}
      <TypingIndicator users={typing.typingUsers} />
      <MessageComposer
        key={channel.id}
        channelId={channel.id}
        workspaceId={workspaceId}
        members={members}
        autoFocus
        placeholder={channel.type === 'DM' ? `Message ${channel.name}` : `Message #${channel.slug}`}
        disabledReason={composerDisabledReason(channel, canSend)}
        onTyping={typing.onInput}
        onStopTyping={typing.stop}
        onSend={(payload) =>
          send.mutate({
            clientId: newClientId(),
            body: payload.body,
            mentions: payload.mentions,
            attachmentIds: payload.attachmentIds,
            attachments: payload.attachments,
          })
        }
      />
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import type { ChannelDto, UserPublicDto } from '@nexus/shared';
import type { ChatMessage } from '../cache';
import {
  newClientId,
  useDeleteMessage,
  useEditMessage,
  useMessage,
  useReplies,
  useSendMessage,
  useToggleReaction,
} from '../hooks';
import { buildMessageRows, composerDisabledReason } from '../utils';
import { MessageComposer } from './MessageComposer';
import { MessageItem, type MessageActions } from './MessageItem';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth.store';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface ThreadPanelProps {
  messageId: string;
  channel: ChannelDto;
  workspaceId: string;
  members: UserPublicDto[];
  onClose: () => void;
  className?: string;
}

export function ThreadPanel({ messageId, channel, workspaceId, members, onClose, className }: ThreadPanelProps) {
  const user = useAuthStore((s) => s.user);
  const canSend = useCan('message:send');
  const canManage = useCan('channel:manage');
  const parent = useMessage(messageId);
  const replies = useReplies(messageId);
  const send = useSendMessage(channel.id);
  const edit = useEditMessage();
  const remove = useDeleteMessage();
  const react = useToggleReaction();
  const bottomRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, [messageId]);

  const count = replies.data?.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const mentionNames = useMemo(() => members.map((m) => m.name), [members]);

  const retry = useCallback(
    (m: ChatMessage) => {
      if (!m.clientId) return;
      send.mutate({
        clientId: m.clientId,
        body: m.body,
        mentions: m.mentions,
        attachmentIds: m.attachments.map((f) => f.id),
        attachments: m.attachments,
        parentMessageId: messageId,
      });
    },
    [send, messageId],
  );

  const actions: MessageActions = useMemo(
    () => ({
      canReact: canSend && !channel.isReadOnly && !channel.isArchived,
      canManage,
      mentionNames,
      myId: user?.id ?? null,
      myName: user?.name ?? null,
      showThreadActions: false,
      onEdit: (m, body) => edit.mutate({ messageId: m.id, body }),
      onDelete: (m) => remove.mutate(m),
      onToggleReaction: (m, emoji) => react.mutate({ message: m, emoji }),
      onRetry: retry,
    }),
    [canSend, canManage, channel.isReadOnly, channel.isArchived, mentionNames, user?.id, user?.name, edit, remove, react, retry],
  );

  const rows = useMemo(
    () => buildMessageRows(replies.data ?? [], { myId: user?.id ?? null }),
    [replies.data, user?.id],
  );

  return (
    <aside
      aria-label="Thread"
      className={cn('flex h-full w-full flex-col bg-background', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Thread</h2>
          <p className="truncate text-2xs text-muted-foreground">#{channel.slug}</p>
        </div>
        <Button ref={closeRef} variant="ghost" size="icon-sm" aria-label="Close thread" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin py-2">
        {parent.isPending ? (
          <div className="flex gap-2.5 px-4 py-2">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </div>
        ) : parent.isError ? (
          <p role="alert" className="px-4 py-2 text-[13px] text-destructive">
            Could not load this message.
          </p>
        ) : parent.data ? (
          <MessageItem message={parent.data} grouped={false} {...actions} />
        ) : null}

        <div className="my-2 flex items-center gap-2 px-4" role="separator" aria-label={`${count} replies`}>
          <span className="text-2xs font-medium text-muted-foreground">
            {count} {count === 1 ? 'reply' : 'replies'}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {replies.isPending ? (
          <div className="space-y-3 px-4" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          rows.map((row) =>
            row.type === 'message' ? (
              <MessageItem key={row.key} message={row.message} grouped={row.grouped} {...actions} />
            ) : row.type === 'day' ? (
              <div key={row.key} role="separator" aria-label={row.label} className="my-2 px-4 text-center text-2xs text-muted-foreground">
                {row.label}
              </div>
            ) : null,
          )
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        channelId={channel.id}
        workspaceId={workspaceId}
        members={members}
        placeholder="Reply in thread…"
        disabledReason={composerDisabledReason(channel, canSend)}
        onSend={(payload) =>
          send.mutate({
            clientId: newClientId(),
            body: payload.body,
            mentions: payload.mentions,
            attachmentIds: payload.attachmentIds,
            attachments: payload.attachments,
            parentMessageId: messageId,
          })
        }
      />
    </aside>
  );
}

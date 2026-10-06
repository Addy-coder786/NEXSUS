import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage } from '../cache';
import { authorOf, buildMessageRows } from '../utils';
import { MessageItem, type MessageActions } from './MessageItem';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

const BOTTOM_THRESHOLD_PX = 80;
const LOAD_MORE_THRESHOLD_PX = 240;

export interface MessageListProps {
  /** Chronological (oldest first). */
  messages: ChatMessage[];
  /** `undefined` disables the "New messages" divider; `null` means never read. */
  lastReadAt?: string | null;
  isLoading: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  actions: MessageActions;
  emptyState?: React.ReactNode;
  className?: string;
}

export function MessageList({
  messages,
  lastReadAt,
  isLoading,
  hasMore,
  isFetchingMore,
  onLoadMore,
  actions,
  emptyState,
  className,
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prependHeightRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const initialisedRef = useRef(false);
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [announcement, setAnnouncement] = useState('');

  const rows = useMemo(() => buildMessageRows(messages, { lastReadAt, myId: actions.myId }), [messages, lastReadAt, actions.myId]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setShowJump(false);
    setUnseen(0);
  }, []);

  // Keep the viewport stable when older pages are prepended; stick to the bottom for new messages.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (prependHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependHeightRef.current;
      prependHeightRef.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    if (!initialisedRef.current) {
      if (messages.length > 0) {
        initialisedRef.current = true;
        lastIdRef.current = lastId;
        el.scrollTop = el.scrollHeight;
      }
      return;
    }
    if (lastId !== lastIdRef.current) {
      const isNew = Boolean(last && !messages.slice(0, -1).some((m) => m.id === lastId));
      lastIdRef.current = lastId;
      const mine = Boolean(last && actions.myId && last.author?.id === actions.myId);
      if (atBottomRef.current || mine) {
        el.scrollTop = el.scrollHeight;
      } else if (isNew) {
        setUnseen((n) => n + 1);
        setShowJump(true);
      }
      if (last && isNew && !mine) setAnnouncement(`New message from ${authorOf(last).name}`);
    }
  }, [messages, actions.myId]);

  // Clear the announcement so repeated identical messages are still announced.
  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(''), 1500);
    return () => clearTimeout(t);
  }, [announcement]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < BOTTOM_THRESHOLD_PX;
    atBottomRef.current = atBottom;
    if (atBottom) {
      setShowJump(false);
      setUnseen(0);
    } else if (!showJump && distance > el.clientHeight) {
      setShowJump(true);
    }
    if (el.scrollTop < LOAD_MORE_THRESHOLD_PX && hasMore && !isFetchingMore && prependHeightRef.current === null) {
      prependHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  };

  // If a fetch finished without changing the list (no older messages), release the guard.
  useEffect(() => {
    if (!isFetchingMore && prependHeightRef.current !== null && !hasMore) prependHeightRef.current = null;
  }, [isFetchingMore, hasMore]);

  if (isLoading) {
    return (
      <div className={cn('flex-1 space-y-4 px-4 py-4', className)} aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-2.5">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className={cn('h-3.5', i % 2 ? 'w-3/4' : 'w-1/2')} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin pb-3"
        role="log"
        aria-label="Messages"
        data-testid="message-scroller"
      >
        {hasMore || isFetchingMore ? (
          <div className="flex justify-center py-3">
            {isFetchingMore ? (
              <Spinner label="Loading older messages" />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => {
                const el = scrollerRef.current;
                if (el) prependHeightRef.current = el.scrollHeight;
                onLoadMore();
              }}>
                Load older messages
              </Button>
            )}
          </div>
        ) : messages.length > 0 && emptyState ? (
          <div className="px-4 pt-6 pb-2">{emptyState}</div>
        ) : null}

        {messages.length === 0 && emptyState ? <div className="flex h-full items-center justify-center px-4">{emptyState}</div> : null}

        {rows.map((row) => {
          if (row.type === 'day') {
            return (
              <div key={row.key} role="separator" aria-label={row.label} className="relative my-3 flex items-center px-4">
                <span className="h-px flex-1 bg-border" />
                <span className="mx-3 rounded-full border bg-card px-2.5 py-0.5 text-2xs font-medium text-muted-foreground">
                  {row.label}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
            );
          }
          if (row.type === 'new') {
            return (
              <div key={row.key} role="separator" aria-label="New messages" data-testid="new-messages-divider" className="my-2 flex items-center gap-2 px-4">
                <span className="h-px flex-1 bg-destructive/60" />
                <span className="text-2xs font-semibold uppercase tracking-wider text-destructive">New messages</span>
              </div>
            );
          }
          return <MessageItem key={row.key} message={row.message} grouped={row.grouped} {...actions} />;
        })}
      </div>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {showJump ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            className="pointer-events-auto rounded-full shadow-md"
            onClick={() => scrollToBottom('smooth')}
          >
            <ArrowDown />
            {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'message' : 'messages'}` : 'Jump to latest'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

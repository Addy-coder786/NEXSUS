import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, MessageSquare, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { MAX_MESSAGE_LENGTH } from '@nexus/shared';
import type { ChatMessage } from '../cache';
import { authorOf, formatTime } from '../utils';
import { AttachmentCard } from './AttachmentCard';
import { EmojiPicker } from './EmojiPicker';
import { MessageBody } from './MessageBody';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface MessageActions {
  /** May add reactions (message:send). */
  canReact: boolean;
  /** May delete anyone's message (channel:manage). */
  canManage: boolean;
  mentionNames: string[];
  myId: string | null;
  myName: string | null;
  /** Show the reply action and the thread summary (false inside a thread panel). */
  showThreadActions: boolean;
  onReply?: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage, body: string) => void;
  onDelete: (message: ChatMessage) => void;
  onToggleReaction: (message: ChatMessage, emoji: string) => void;
  onRetry?: (message: ChatMessage) => void;
}

export interface MessageItemProps extends MessageActions {
  message: ChatMessage;
  /** Continuation of the previous author's group: no avatar/header, hanging indent. */
  grouped: boolean;
}

function InlineEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSave(trimmed);
    else onCancel();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  };
  return (
    <div className="mt-1 space-y-1.5">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_MESSAGE_LENGTH}
        aria-label="Edit message"
        className="min-h-[40px] text-[13.5px]"
        rows={2}
      />
      <div className="flex items-center gap-2 text-2xs text-muted-foreground">
        <Button size="sm" onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span>Enter to save · Esc to cancel</span>
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message, grouped, canReact, canManage, mentionNames, myId, myName, showThreadActions } = props;
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const author = authorOf(message);
  const isOwn = Boolean(myId && author.id === myId);
  const deleted = Boolean(message.deletedAt);
  const canEdit = isOwn && !deleted && message.source === 'nexus' && !message.pending && !message.failed;
  const canDelete = (isOwn || canManage) && !deleted && !message.pending;
  const showActions = !deleted && !message.pending && !message.failed && (canReact || canEdit || canDelete || showThreadActions);

  return (
    <article
      data-testid="message-item"
      data-message-id={message.id}
      aria-label={`${author.name}, ${formatTime(message.createdAt)}`}
      className={cn(
        'group relative flex gap-2.5 px-4 hover:bg-accent/40',
        grouped ? 'py-px' : 'mt-1.5 pt-1 pb-px',
        message.pending && 'opacity-60',
        message.mentions.includes(myId ?? '') && 'bg-warning/10 hover:bg-warning/15',
      )}
    >
      {grouped ? (
        <div className="w-9 shrink-0 pt-1 text-right text-2xs leading-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>
      ) : (
        <UserAvatar
          user={author.id ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl } : { name: author.name, avatarUrl: author.avatarUrl }}
          size="lg"
          className="mt-0.5 shrink-0"
        />
      )}

      <div className="min-w-0 flex-1">
        {!grouped ? (
          <div className="flex flex-wrap items-baseline gap-x-2 leading-5">
            <span className="text-[13.5px] font-semibold">{author.name}</span>
            {message.source === 'slack' ? (
              <Badge variant="outline" className="h-4 px-1 py-0 text-[10px] uppercase tracking-wide">
                Slack
              </Badge>
            ) : null}
            <time
              dateTime={message.createdAt}
              title={formatDateTime(message.createdAt)}
              className="text-2xs text-muted-foreground"
            >
              {formatTime(message.createdAt)}
            </time>
          </div>
        ) : null}

        {deleted ? (
          <p className="text-[13px] italic text-muted-foreground">This message was deleted.</p>
        ) : editing ? (
          <InlineEditor
            initial={message.body}
            onSave={(body) => {
              props.onEdit(message, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            {message.body ? (
              <MessageBody body={message.body} mentionNames={mentionNames} myName={myName} />
            ) : null}
            {message.editedAt ? (
              <span className="ml-1 text-2xs text-muted-foreground" title={formatDateTime(message.editedAt)}>
                (edited)
              </span>
            ) : null}
            {message.attachments.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {message.attachments.map((f) => (
                  <AttachmentCard key={f.id} file={f} />
                ))}
              </div>
            ) : null}
          </>
        )}

        {message.failed ? (
          <div role="alert" className="mt-0.5 flex items-center gap-1.5 text-2xs text-destructive">
            <AlertCircle className="size-3" aria-hidden />
            Not sent.
            {props.onRetry ? (
              <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => props.onRetry?.(message)}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {!deleted && message.reactions.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-1" aria-label="Reactions">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                aria-pressed={r.reacted}
                aria-label={`${r.emoji} ${r.count}${r.reacted ? ', you reacted' : ''}`}
                disabled={!canReact}
                onClick={() => props.onToggleReaction(message, r.emoji)}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs transition-colors disabled:cursor-default',
                  r.reacted
                    ? 'border-primary/40 bg-primary/10 text-foreground'
                    : 'border-border bg-card hover:bg-accent',
                )}
              >
                <span aria-hidden>{r.emoji}</span>
                <span className="tabular-nums">{r.count}</span>
              </button>
            ))}
            {canReact ? (
              <EmojiPicker
                align="start"
                side="bottom"
                onPick={(emoji) => props.onToggleReaction(message, emoji)}
                trigger={
                  <button
                    type="button"
                    aria-label="Add reaction"
                    className="inline-flex size-6 items-center justify-center rounded-full border border-dashed text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <SmilePlus className="size-3.5" aria-hidden />
                  </button>
                }
              />
            ) : null}
          </div>
        ) : null}

        {showThreadActions && message.replyCount > 0 && props.onReply ? (
          <button
            type="button"
            onClick={() => props.onReply?.(message)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-primary hover:bg-accent"
          >
            <MessageSquare className="size-3.5" aria-hidden />
            {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            {message.lastReplyAt ? (
              <span className="font-normal text-muted-foreground">· last {formatRelative(message.lastReplyAt)}</span>
            ) : null}
            <span className="sr-only">, view thread</span>
          </button>
        ) : null}
      </div>

      {showActions && !editing ? (
        <div
          role="toolbar"
          aria-label="Message actions"
          className={cn(
            'absolute -top-3 right-4 flex items-center rounded-md border bg-card p-0.5 shadow-sm',
            'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            pickerOpen && 'opacity-100',
          )}
        >
          {canReact ? (
            <EmojiPicker
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onPick={(emoji) => props.onToggleReaction(message, emoji)}
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="Add reaction">
                  <SmilePlus />
                </Button>
              }
            />
          ) : null}
          {showThreadActions && props.onReply ? (
            <SimpleTooltip label="Reply in thread">
              <Button variant="ghost" size="icon-sm" aria-label="Reply in thread" onClick={() => props.onReply?.(message)}>
                <MessageSquare />
              </Button>
            </SimpleTooltip>
          ) : null}
          {canEdit ? (
            <SimpleTooltip label="Edit">
              <Button variant="ghost" size="icon-sm" aria-label="Edit message" onClick={() => setEditing(true)}>
                <Pencil />
              </Button>
            </SimpleTooltip>
          ) : null}
          {canDelete ? (
            <SimpleTooltip label="Delete">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete message"
                className="text-destructive hover:text-destructive"
                onClick={() => props.onDelete(message)}
              >
                <Trash2 />
              </Button>
            </SimpleTooltip>
          ) : null}
        </div>
      ) : null}
    </article>
  );
});

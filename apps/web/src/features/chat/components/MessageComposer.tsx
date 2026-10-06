import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Loader2, Paperclip, SendHorizontal, SmilePlus, X } from 'lucide-react';
import { MAX_FILE_SIZE_BYTES, MAX_MESSAGE_LENGTH, type FileDto, type UserPublicDto } from '@nexus/shared';
import { useUploadAttachment } from '../hooks';
import { formatFileSize } from '../utils';
import { EmojiPicker } from './EmojiPicker';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { UserAvatar } from '@/components/common/UserAvatar';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const MAX_ATTACHMENTS = 10;
const MAX_MENTION_RESULTS = 6;

export interface ComposerSubmit {
  body: string;
  mentions: string[];
  attachmentIds: string[];
  attachments: FileDto[];
}

export interface MessageComposerProps {
  channelId: string;
  workspaceId: string;
  members: UserPublicDto[];
  onSend: (payload: ComposerSubmit) => void;
  /** When set the composer is disabled and this notice is shown instead. */
  disabledReason?: string | null;
  onTyping?: () => void;
  onStopTyping?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

interface PendingUpload {
  localId: string;
  file: File;
  progress: number;
  result?: FileDto;
  error?: string;
}

interface MentionState {
  /** Index of the `@` in the textarea value. */
  start: number;
  query: string;
}

function findMention(value: string, caret: number): MentionState | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? '')) return null;
  const query = before.slice(at + 1);
  if (query.length > 30 || query.includes('\n')) return null;
  return { start: at, query };
}

export function MessageComposer({
  channelId,
  workspaceId,
  members,
  onSend,
  disabledReason,
  onTyping,
  onStopTyping,
  placeholder = 'Write a message…',
  autoFocus,
  className,
}: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionedRef = useRef(new Map<string, string>()); // name -> id
  const listId = useId();
  const upload = useUploadAttachment(workspaceId);
  const disabled = Boolean(disabledReason);

  const matches = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.trim().toLowerCase();
    return members
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().startsWith(q))
      .slice(0, MAX_MENTION_RESULTS);
  }, [mention, members]);

  useEffect(() => {
    setActiveIdx(0);
  }, [mention?.query]);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [value, autosize]);

  useEffect(() => {
    if (autoFocus && !disabled) textareaRef.current?.focus();
  }, [autoFocus, disabled, channelId]);

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    setMention(findMention(next, e.target.selectionStart ?? next.length));
    if (next.trim()) onTyping?.();
    else onStopTyping?.();
  };

  const insertAtCaret = (text: string, replaceFrom?: number) => {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const from = replaceFrom ?? caret;
    const next = `${value.slice(0, from)}${text}${value.slice(caret)}`;
    setValue(next);
    requestAnimationFrame(() => {
      const pos = from + text.length;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const pickMention = (user: UserPublicDto) => {
    if (!mention) return;
    mentionedRef.current.set(user.name, user.id);
    insertAtCaret(`@${user.name} `, mention.start);
    setMention(null);
  };

  const uploadsInFlight = uploads.some((u) => !u.result && !u.error);
  const canSubmit = !disabled && !uploadsInFlight && (value.trim().length > 0 || uploads.some((u) => u.result));

  const submit = () => {
    if (!canSubmit) return;
    const body = value.trim();
    const attachments = uploads.flatMap((u) => (u.result ? [u.result] : []));
    const mentions = [...mentionedRef.current.entries()]
      .filter(([name]) => body.includes(`@${name}`))
      .map(([, id]) => id);
    onSend({ body, mentions: [...new Set(mentions)], attachmentIds: attachments.map((f) => f.id), attachments });
    setValue('');
    setUploads([]);
    setMention(null);
    mentionedRef.current.clear();
    onStopTyping?.();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const pick = matches[activeIdx] ?? matches[0];
        if (pick) pickMention(pick);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const startUpload = (file: File) => {
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploads((prev) => [...prev, { localId, file, progress: 1, error: `Larger than ${formatFileSize(MAX_FILE_SIZE_BYTES)}` }]);
      return;
    }
    setUploads((prev) => [...prev, { localId, file, progress: 0 }]);
    upload.mutate(
      {
        file,
        channelId,
        onProgress: (p) => setUploads((prev) => prev.map((u) => (u.localId === localId ? { ...u, progress: p } : u))),
      },
      {
        onSuccess: (result) =>
          setUploads((prev) => prev.map((u) => (u.localId === localId ? { ...u, progress: 1, result } : u))),
        onError: (error) =>
          setUploads((prev) =>
            prev.map((u) => (u.localId === localId ? { ...u, error: getErrorMessage(error, 'Upload failed') } : u)),
          ),
      },
    );
  };

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const room = MAX_ATTACHMENTS - uploads.length;
    Array.from(files).slice(0, Math.max(0, room)).forEach(startUpload);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (disabled) {
    return (
      <div className={cn('border-t px-4 py-3', className)}>
        <p role="note" className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-center text-[13px] text-muted-foreground">
          {disabledReason}
        </p>
      </div>
    );
  }

  const activeMatch = matches[activeIdx];

  return (
    <div className={cn('border-t px-4 pb-3 pt-2', className)}>
      <div
        className="relative rounded-lg border border-input bg-card shadow-sm focus-within:border-transparent focus-within:ring-2 focus-within:ring-ring"
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onFiles(e.dataTransfer.files);
        }}
      >
        {mention && matches.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Mention a member"
            className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {matches.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${m.id}`}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickMention(m);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                className={cn(
                  'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px]',
                  i === activeIdx && 'bg-accent text-accent-foreground',
                )}
              >
                <UserAvatar user={m} size="sm" showPresence />
                <span className="truncate font-medium">{m.name}</span>
                <span className="ml-auto truncate text-2xs text-muted-foreground">{m.email}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {uploads.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-2.5 pt-2" aria-label="Attachments">
            {uploads.map((u) => (
              <li
                key={u.localId}
                className={cn(
                  'flex h-7 max-w-[240px] items-center gap-1.5 rounded-md border bg-muted/50 pl-2 pr-1 text-xs',
                  u.error && 'border-destructive/50 text-destructive',
                )}
              >
                {!u.result && !u.error ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : <Paperclip className="size-3 shrink-0" aria-hidden />}
                <span className="truncate" title={u.error ?? u.file.name}>
                  {u.file.name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {u.error ? u.error : u.result ? formatFileSize(u.result.size) : `${Math.round(u.progress * 100)}%`}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${u.file.name}`}
                  onClick={() => setUploads((prev) => prev.filter((x) => x.localId !== u.localId))}
                  className="rounded p-0.5 hover:bg-accent"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 100)}
          onClick={(e) => setMention(findMention(value, e.currentTarget.selectionStart ?? value.length))}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={placeholder}
          aria-label="Message"
          role={mention && matches.length > 0 ? 'combobox' : undefined}
          aria-expanded={mention && matches.length > 0 ? true : undefined}
          aria-controls={mention && matches.length > 0 ? listId : undefined}
          aria-activedescendant={mention && activeMatch ? `${listId}-${activeMatch.id}` : undefined}
          aria-autocomplete={mention && matches.length > 0 ? 'list' : undefined}
          className="block max-h-[200px] w-full resize-none bg-transparent px-3 py-2 text-[13.5px] leading-5 placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Attach files"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploads.length >= MAX_ATTACHMENTS}
            className="text-muted-foreground"
          >
            <Paperclip />
          </Button>
          <EmojiPicker
            align="start"
            onPick={(emoji) => insertAtCaret(emoji)}
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label="Insert emoji" className="text-muted-foreground">
                <SmilePlus />
              </Button>
            }
          />
          <span className="ml-auto hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
          </span>
          {value.length > MAX_MESSAGE_LENGTH * 0.9 ? (
            <span className={cn('ml-2 text-2xs tabular-nums', value.length >= MAX_MESSAGE_LENGTH ? 'text-destructive' : 'text-muted-foreground')}>
              {value.length}/{MAX_MESSAGE_LENGTH}
            </span>
          ) : null}
          <Button size="icon-sm" aria-label="Send message" onClick={submit} disabled={!canSubmit} className="ml-1">
            <SendHorizontal />
          </Button>
        </div>
      </div>
    </div>
  );
}

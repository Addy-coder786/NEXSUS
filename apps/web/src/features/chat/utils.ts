import { format, isSameDay, isThisYear, isToday, isYesterday, parseISO } from 'date-fns';
import type { ChannelDto, MessageDto } from '@nexus/shared';
import { API_URL } from '@/lib/api';
import type { ChatMessage } from './cache';

/** Consecutive messages by the same author within this window are visually grouped. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function formatTime(iso: string): string {
  const d = parseISO(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'HH:mm');
}

export function formatDayLabel(iso: string): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, isThisYear(d) ? 'EEEE, MMM d' : 'EEEE, MMM d, yyyy');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Relative file URLs (local disk storage) live on the API origin. */
export function resolveFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;
  return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface AuthorInfo {
  id: string | null;
  name: string;
  avatarUrl: string | null;
}

export function authorOf(message: Pick<MessageDto, 'author' | 'externalAuthor' | 'source'>): AuthorInfo {
  if (message.author) return { id: message.author.id, name: message.author.name, avatarUrl: message.author.avatarUrl };
  if (message.externalAuthor) return { id: null, name: message.externalAuthor.name, avatarUrl: message.externalAuthor.avatarUrl };
  return { id: null, name: message.source === 'system' ? 'System' : 'Unknown', avatarUrl: null };
}

function sameAuthor(a: MessageDto, b: MessageDto): boolean {
  const x = authorOf(a);
  const y = authorOf(b);
  if (x.id && y.id) return x.id === y.id;
  if (!x.id && !y.id) return x.name === y.name;
  return false;
}

export type MessageRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'new'; key: string }
  | { type: 'message'; key: string; message: ChatMessage; grouped: boolean };

/**
 * Build the render rows for a chronological list: day separators, a single "New messages" divider
 * (first message after `lastReadAt` not written by `myId`), and author grouping.
 */
export function buildMessageRows(
  messages: ChatMessage[],
  options: { lastReadAt?: string | null; myId: string | null },
): MessageRow[] {
  const rows: MessageRow[] = [];
  const lastRead = options.lastReadAt ? parseISO(options.lastReadAt).getTime() : null;
  let dividerPlaced = options.lastReadAt === undefined;
  let prev: ChatMessage | null = null;
  let prevDate: Date | null = null;
  let breakGroup = true;

  for (const message of messages) {
    const date = parseISO(message.createdAt);
    if (!prevDate || !isSameDay(prevDate, date)) {
      rows.push({ type: 'day', key: `day-${message.createdAt}`, label: formatDayLabel(message.createdAt) });
      breakGroup = true;
    }
    const isMine = Boolean(options.myId && message.author?.id === options.myId);
    if (!dividerPlaced && !isMine && !message.pending && (lastRead === null || date.getTime() > lastRead)) {
      rows.push({ type: 'new', key: 'new-messages' });
      dividerPlaced = true;
      breakGroup = true;
    }
    const grouped =
      !breakGroup &&
      prev !== null &&
      message.source !== 'system' &&
      prev.source !== 'system' &&
      sameAuthor(prev, message) &&
      date.getTime() - parseISO(prev.createdAt).getTime() < GROUP_WINDOW_MS;
    rows.push({ type: 'message', key: message.id, message, grouped });
    prev = message;
    prevDate = date;
    breakGroup = false;
  }
  return rows;
}

/** Why the composer is disabled for this channel, or null when the user can post. */
export function composerDisabledReason(channel: ChannelDto, canSend: boolean): string | null {
  if (channel.isReadOnly || channel.source === 'slack') return 'This channel is mirrored from Slack and is read-only.';
  if (channel.isArchived) return 'This channel is archived. Unarchive it to post new messages.';
  if (!canSend) return 'Your role does not allow posting messages in this workspace.';
  if ((channel.type === 'PRIVATE' || channel.type === 'GROUP') && !channel.isMember) {
    return 'You are not a member of this channel.';
  }
  return null;
}

/** Sort for the channel sidebar: project channels first, then by latest activity. */
export function sortChannels(channels: ChannelDto[]): ChannelDto[] {
  return [...channels].sort((a, b) => {
    if (Boolean(a.projectId) !== Boolean(b.projectId)) return a.projectId ? -1 : 1;
    const at = a.lastMessageAt ? parseISO(a.lastMessageAt).getTime() : 0;
    const bt = b.lastMessageAt ? parseISO(b.lastMessageAt).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
}

export function isGeneralChannel(channel: ChannelDto): boolean {
  return channel.slug === 'general' && channel.projectId === null;
}

/** Default channel to open: first project channel, then #general, then anything. */
export function pickDefaultChannel(channels: ChannelDto[]): ChannelDto | undefined {
  const active = channels.filter((c) => !c.isArchived);
  return active.find((c) => c.projectId) ?? active.find(isGeneralChannel) ?? active[0] ?? channels[0];
}

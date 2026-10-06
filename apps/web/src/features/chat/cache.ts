import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { ChannelDto, ChannelReadStateDto, MessageDto, ReactionDto } from '@nexus/shared';
import { chatKeys } from './keys';
import type { UnreadSummary } from './api';

/** A message as held in the cache: `pending` while the optimistic send is in flight, `failed` after an error. */
export type ChatMessage = MessageDto & { pending?: boolean; failed?: boolean };
export type MessagesData = InfiniteData<ChatMessage[], string | undefined>;

export const MESSAGES_PAGE_SIZE = 50;
/** Maximum number of unconfirmed optimistic messages kept per channel. */
export const MAX_PENDING_MESSAGES = 20;

export type UpsertResult = 'inserted' | 'replaced-pending' | 'replaced' | 'missing';

function sameMessage(a: Pick<ChatMessage, 'id' | 'clientId'>, b: Pick<ChatMessage, 'id' | 'clientId'>): boolean {
  if (a.id === b.id) return true;
  return Boolean(a.clientId && b.clientId && a.clientId === b.clientId);
}

function capPending(page: ChatMessage[]): ChatMessage[] {
  let pending = page.filter((m) => m.pending || m.failed).length;
  if (pending <= MAX_PENDING_MESSAGES) return page;
  // Pages are newest first; drop the oldest unconfirmed entries (end of the page) first.
  const out: ChatMessage[] = [];
  for (let i = page.length - 1; i >= 0; i--) {
    const m = page[i] as ChatMessage;
    if ((m.pending || m.failed) && pending > MAX_PENDING_MESSAGES) {
      pending -= 1;
      continue;
    }
    out.unshift(m);
  }
  return out;
}

/**
 * Insert or replace a top-level message in the channel's infinite cache (pages newest first).
 * A message matching by `id` or `clientId` replaces the existing entry in place.
 */
export function upsertTopLevelMessage(
  queryClient: QueryClient,
  channelId: string,
  message: ChatMessage,
): UpsertResult {
  const key = chatKeys.messages(channelId);
  const data = queryClient.getQueryData<MessagesData>(key);
  if (!data) return 'missing';
  let result: UpsertResult = 'inserted';
  const pages = data.pages.map((page) =>
    page.map((m) => {
      if (!sameMessage(m, message)) return m;
      result = m.pending ? 'replaced-pending' : 'replaced';
      return { ...message, clientId: message.clientId ?? m.clientId };
    }),
  );
  if (result === 'inserted') {
    const first = pages[0] ?? [];
    pages[0] = capPending([message, ...first]);
  }
  queryClient.setQueryData<MessagesData>(key, { ...data, pages });
  return result;
}

/** Insert or replace a reply in the parent's replies cache (oldest first). */
export function upsertReply(queryClient: QueryClient, parentMessageId: string, reply: ChatMessage): UpsertResult {
  const key = chatKeys.replies(parentMessageId);
  const data = queryClient.getQueryData<ChatMessage[]>(key);
  if (!data) return 'missing';
  let result: UpsertResult = 'inserted';
  const next = data.map((m) => {
    if (!sameMessage(m, reply)) return m;
    result = m.pending ? 'replaced-pending' : 'replaced';
    return { ...reply, clientId: reply.clientId ?? m.clientId };
  });
  queryClient.setQueryData<ChatMessage[]>(key, result === 'inserted' ? [...next, reply] : next);
  return result;
}

/** Insert/replace wherever the message belongs (thread or channel). */
export function upsertMessage(queryClient: QueryClient, message: ChatMessage): UpsertResult {
  const result = message.parentMessageId
    ? upsertReply(queryClient, message.parentMessageId, message)
    : upsertTopLevelMessage(queryClient, message.channelId, message);
  queryClient.setQueryData<ChatMessage>(chatKeys.message(message.id), (old) => (old ? { ...old, ...message } : old));
  return result;
}

type Patch = Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage);

function applyPatch(m: ChatMessage, patch: Patch): ChatMessage {
  return typeof patch === 'function' ? patch(m) : { ...m, ...patch };
}

/** Patch a message by id (or clientId) in the channel cache, thread caches and the single-message cache. */
export function patchMessage(
  queryClient: QueryClient,
  ref: { channelId: string; messageId: string; parentMessageId?: string | null; clientId?: string | null },
  patch: Patch,
): void {
  const matches = (m: ChatMessage) => sameMessage(m, { id: ref.messageId, clientId: ref.clientId ?? null });
  if (ref.parentMessageId) {
    queryClient.setQueryData<ChatMessage[]>(chatKeys.replies(ref.parentMessageId), (old) =>
      old ? old.map((m) => (matches(m) ? applyPatch(m, patch) : m)) : old,
    );
  } else {
    queryClient.setQueryData<MessagesData>(chatKeys.messages(ref.channelId), (old) =>
      old ? { ...old, pages: old.pages.map((p) => p.map((m) => (matches(m) ? applyPatch(m, patch) : m))) } : old,
    );
  }
  queryClient.setQueryData<ChatMessage>(chatKeys.message(ref.messageId), (old) => (old ? applyPatch(old, patch) : old));
}

/** Patch a message when we do not know whether it is a reply: scans the channel cache and every loaded thread. */
export function patchMessageAnywhere(
  queryClient: QueryClient,
  ref: { channelId: string; messageId: string },
  patch: Patch,
): void {
  const matches = (m: ChatMessage) => m.id === ref.messageId;
  queryClient.setQueryData<MessagesData>(chatKeys.messages(ref.channelId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => p.map((m) => (matches(m) ? applyPatch(m, patch) : m))) } : old,
  );
  queryClient.setQueriesData<ChatMessage[]>({ queryKey: [...chatKeys.all, 'replies'] }, (old) =>
    old ? old.map((m) => (matches(m) ? applyPatch(m, patch) : m)) : old,
  );
  queryClient.setQueryData<ChatMessage>(chatKeys.message(ref.messageId), (old) => (old ? applyPatch(old, patch) : old));
}

/** Recompute `reacted` relative to the current user; the server's flag is relative to the actor. */
export function withMyReactions(reactions: ReactionDto[], myId: string | null): ReactionDto[] {
  return reactions.map((r) => ({ ...r, reacted: myId ? r.userIds.includes(myId) : false }));
}

/** Toggle `emoji` for `myId` locally (used for optimistic reactions). */
export function toggleReactionLocally(reactions: ReactionDto[], emoji: string, myId: string): ReactionDto[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) return [...reactions, { emoji, count: 1, userIds: [myId], reacted: true }];
  if (existing.reacted) {
    const userIds = existing.userIds.filter((id) => id !== myId);
    if (userIds.length === 0) return reactions.filter((r) => r.emoji !== emoji);
    return reactions.map((r) => (r.emoji === emoji ? { ...r, userIds, count: userIds.length, reacted: false } : r));
  }
  return reactions.map((r) =>
    r.emoji === emoji ? { ...r, userIds: [...r.userIds, myId], count: r.userIds.length + 1, reacted: true } : r,
  );
}

export function patchChannel(queryClient: QueryClient, channelId: string, patch: Partial<ChannelDto>): void {
  queryClient.setQueriesData<ChannelDto[]>({ queryKey: chatKeys.channelLists() }, (old) =>
    old ? old.map((c) => (c.id === channelId ? { ...c, ...patch } : c)) : old,
  );
  queryClient.setQueryData<ChannelDto>(chatKeys.channel(channelId), (old) => (old ? { ...old, ...patch } : old));
}

/** Fields of a socket-pushed ChannelDto that are the same for every viewer. */
function sharedChannelFields(channel: ChannelDto): Partial<ChannelDto> {
  return {
    name: channel.name,
    description: channel.description,
    isArchived: channel.isArchived,
    lastMessageAt: channel.lastMessageAt,
    lastMessagePreview: channel.lastMessagePreview,
    memberCount: channel.memberCount,
  };
}

/**
 * Add or update a channel. Pushed `channel:*` payloads carry the actor's perspective (isMember,
 * unreadCount, DM name), so an existing entry only takes the shared fields; REST responses (which are
 * caller-relative) pass `{ full: true }`. Returns false when the channel was unknown and not inserted.
 */
export function upsertChannel(queryClient: QueryClient, channel: ChannelDto, options: { full?: boolean } = {}): boolean {
  const patch = options.full ? channel : sharedChannelFields(channel);
  let known = false;
  queryClient.setQueryData<ChannelDto[]>(chatKeys.channels(channel.workspaceId), (old) => {
    if (!old) return old;
    known = old.some((c) => c.id === channel.id);
    if (known) return old.map((c) => (c.id === channel.id ? { ...c, ...patch } : c));
    return options.full || channel.type === 'PUBLIC' || channel.type === 'PRIVATE' ? [...old, channel] : old;
  });
  queryClient.setQueryData<ChannelDto>(chatKeys.channel(channel.id), (old) => (old ? { ...old, ...patch } : old));
  return known;
}

/** Increment a channel's unread count locally (used for the `unreadCount: -1` public-channel push). */
export function incrementChannelUnread(queryClient: QueryClient, channelId: string, delta = 1): void {
  const current = findChannelInCache(queryClient, channelId)?.unreadCount ?? 0;
  setChannelUnread(queryClient, channelId, Math.max(0, current + delta));
}

export function removeChannel(queryClient: QueryClient, workspaceId: string, channelId: string): void {
  queryClient.setQueryData<ChannelDto[]>(chatKeys.channels(workspaceId), (old) =>
    old ? old.filter((c) => c.id !== channelId) : old,
  );
  queryClient.removeQueries({ queryKey: chatKeys.channel(channelId) });
  queryClient.removeQueries({ queryKey: chatKeys.messages(channelId) });
}

/** Find a channel in any cached channel list. */
export function findChannelInCache(queryClient: QueryClient, channelId: string): ChannelDto | undefined {
  const direct = queryClient.getQueryData<ChannelDto>(chatKeys.channel(channelId));
  if (direct) return direct;
  for (const [, list] of queryClient.getQueriesData<ChannelDto[]>({ queryKey: chatKeys.channelLists() })) {
    const found = list?.find((c) => c.id === channelId);
    if (found) return found;
  }
  return undefined;
}

/** Set the unread count of a channel in the channel lists and in the per-workspace unread summaries. */
export function setChannelUnread(
  queryClient: QueryClient,
  channelId: string,
  unreadCount: number,
  lastReadAt?: string | null,
): void {
  patchChannel(queryClient, channelId, { unreadCount });
  queryClient.setQueriesData<UnreadSummary>({ queryKey: chatKeys.unreadAll() }, (old) => {
    if (!old) return old;
    let found = false;
    const channels: ChannelReadStateDto[] = old.channels.map((c) => {
      if (c.channelId !== channelId) return c;
      found = true;
      return { ...c, unreadCount, lastReadAt: lastReadAt === undefined ? c.lastReadAt : lastReadAt };
    });
    if (!found) channels.push({ channelId, unreadCount, lastReadAt: lastReadAt ?? null, muted: false });
    return { channels, total: channels.reduce((sum, c) => sum + c.unreadCount, 0) };
  });
}

/** Mark the channel's preview after a new top-level message. */
export function bumpChannelPreview(queryClient: QueryClient, message: MessageDto): void {
  if (message.parentMessageId) return;
  const preview = message.body || (message.attachments.length > 0 ? 'Sent an attachment' : '');
  patchChannel(queryClient, message.channelId, { lastMessageAt: message.createdAt, lastMessagePreview: preview });
}

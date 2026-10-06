import { Types, type FilterQuery } from 'mongoose';
import {
  hasPermission,
  type ChannelDto,
  type ChannelReadStateDto,
  type CreateChannelInput,
  type ProjectDto,
  type UpdateChannelInput,
  type UserPublicDto,
  type WorkspaceMemberDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { Channel, type IChannel } from '../../models/Channel';
import { ChannelRead } from '../../models/ChannelRead';
import { FileModel } from '../../models/File';
import { Message } from '../../models/Message';
import { Project } from '../../models/Project';
import { WorkspaceMember, toWorkspaceMemberDto } from '../../models/WorkspaceMember';
import { recordActivity } from '../../services/activity.service';
import { ApiError } from '../../utils/ApiError';
import { loadUserMap } from '../workspaces/user.lookup';
import { assertWorkspaceMembers, listMembers as listWorkspaceMembers } from '../workspaces/workspace.service';
import { channelAllows } from './chat.access';
import { toChannelDto, toChannelReadStateDto, type ChannelLean, type ChannelReadLean } from './chat.dto';

export const GENERAL_SLUG = 'general';
const PREVIEW_MAX = 200;

// ---------- slug helpers ----------

export function slugifyChannel(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : 'channel';
}

export async function uniqueChannelSlug(workspaceId: Types.ObjectId | string, base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await Channel.exists({ workspaceId, slug: candidate })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

export function messagePreview(body: string, attachmentCount: number): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (text) return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
  return attachmentCount > 1 ? `Sent ${attachmentCount} attachments` : 'Sent an attachment';
}

// ---------- read cursors & unread counts ----------

/** The epoch sentinel means "state row exists (e.g. muted) but nothing was ever read". */
function readCursor(read: ChannelReadLean | undefined): Date | null {
  if (!read) return null;
  return read.lastReadAt.getTime() > 0 ? read.lastReadAt : null;
}

async function loadReads(userId: string, channelIds: Types.ObjectId[]): Promise<Map<string, ChannelReadLean>> {
  if (channelIds.length === 0) return new Map();
  const reads = await ChannelRead.find({ userId, channelId: { $in: channelIds } }).lean();
  return new Map(reads.map((r) => [String(r.channelId), r]));
}

/**
 * Unread = top-level, non-deleted messages created after the user's `lastReadAt` (all of them when
 * no read state exists), excluding the user's own messages. One aggregation for every channel.
 */
async function unreadCounts(
  userId: string,
  channels: ChannelLean[],
  reads: Map<string, ChannelReadLean>,
): Promise<Map<string, number>> {
  const uid = new Types.ObjectId(userId);
  const conditions: FilterQuery<unknown>[] = [];
  for (const c of channels) {
    if (!c.lastMessageAt) continue;
    const since = readCursor(reads.get(String(c._id)));
    if (since && since >= c.lastMessageAt) continue;
    conditions.push({ channelId: c._id, createdAt: { $gt: since ?? new Date(0) } });
  }
  if (conditions.length === 0) return new Map();

  const rows = await Message.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { parentMessageId: null, deletedAt: null, authorId: { $ne: uid }, $or: conditions } },
    { $group: { _id: '$channelId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

export async function unreadCountFor(channel: ChannelLean, userId: string): Promise<number> {
  const reads = await loadReads(userId, [channel._id]);
  const counts = await unreadCounts(userId, [channel], reads);
  return counts.get(String(channel._id)) ?? 0;
}

// ---------- DTO building ----------

export async function buildChannelDtos(channels: ChannelLean[], viewerId: string): Promise<ChannelDto[]> {
  if (channels.length === 0) return [];
  const workspaceIds = [...new Set(channels.map((c) => String(c.workspaceId)))];
  const needsWorkspaceCount = channels.some((c) => c.type === 'PUBLIC');
  const participantRefs = channels
    .filter((c) => c.type === 'DM' || c.type === 'GROUP')
    .flatMap((c) => c.memberIds);

  const [reads, memberCountRows, users] = await Promise.all([
    loadReads(viewerId, channels.map((c) => c._id)),
    needsWorkspaceCount
      ? WorkspaceMember.aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) } } },
          { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
    loadUserMap(participantRefs),
  ]);
  const unread = await unreadCounts(viewerId, channels, reads);
  const workspaceCounts = new Map(memberCountRows.map((r) => [String(r._id), r.count]));

  return channels.map((c) => {
    const isPublic = c.type === 'PUBLIC';
    const others: UserPublicDto[] | null =
      c.type === 'DM' || c.type === 'GROUP'
        ? c.memberIds.filter((m) => String(m) !== viewerId).map((m) => users.get(m))
        : null;
    return toChannelDto(c, {
      participants: others,
      memberCount: isPublic ? (workspaceCounts.get(String(c.workspaceId)) ?? 0) : c.memberIds.length,
      isMember: isPublic ? true : channelAllows(c, viewerId),
      unreadCount: unread.get(String(c._id)) ?? 0,
      muted: reads.get(String(c._id))?.muted ?? false,
      name: c.type === 'DM' ? (others?.[0]?.name ?? c.name) : undefined,
    });
  });
}

export async function buildChannelDto(channel: ChannelLean, viewerId: string): Promise<ChannelDto> {
  const [dto] = await buildChannelDtos([channel], viewerId);
  if (!dto) throw ApiError.internal();
  return dto;
}

export async function reloadChannel(channelId: Types.ObjectId | string): Promise<ChannelLean> {
  const channel = await Channel.findById(channelId).lean();
  if (!channel) throw ApiError.notFound('Channel');
  return channel;
}

// ---------- listing ----------

function visibleChannelFilter(workspaceId: string, userId: string): FilterQuery<IChannel> {
  return { workspaceId, $or: [{ type: 'PUBLIC' }, { memberIds: new Types.ObjectId(userId) }] };
}

function sortChannels(a: ChannelDto, b: ChannelDto): number {
  const aProject = a.projectId ? 0 : 1;
  const bProject = b.projectId ? 0 : 1;
  if (aProject !== bProject) return aProject - bProject;
  const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  if (aTime !== bTime) return bTime - aTime;
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

/** PUBLIC channels + ones the caller belongs to; project channels first, then by lastMessageAt desc. */
export async function listChannels(workspaceId: string, userId: string): Promise<ChannelDto[]> {
  const channels = await Channel.find(visibleChannelFilter(workspaceId, userId)).lean();
  const dtos = await buildChannelDtos(channels, userId);
  return dtos.sort(sortChannels);
}

// ---------- create ----------

export async function createChannel(workspaceId: string, actorId: string, input: CreateChannelInput): Promise<ChannelDto> {
  if (input.projectId) {
    const exists = await Project.exists({ _id: input.projectId, workspaceId });
    if (!exists) throw ApiError.badRequest('Project must belong to the workspace');
  }

  let slug: string;
  if (input.slug) {
    if (await Channel.exists({ workspaceId, slug: input.slug })) throw ApiError.conflict('Channel slug already in use');
    slug = input.slug;
  } else {
    slug = await uniqueChannelSlug(workspaceId, slugifyChannel(input.name));
  }

  let memberIds: Types.ObjectId[] = [];
  if (input.type !== 'PUBLIC') {
    const extra = (input.memberIds ?? []).filter((id) => id !== actorId);
    await assertWorkspaceMembers(workspaceId, extra);
    memberIds = [actorId, ...new Set(extra)].map((id) => new Types.ObjectId(id));
  }

  const channel = await Channel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    projectId: input.projectId ? new Types.ObjectId(input.projectId) : null,
    type: input.type,
    name: input.name,
    slug,
    description: input.description ?? null,
    memberIds,
    createdBy: new Types.ObjectId(actorId),
  });

  await recordActivity({
    workspaceId,
    projectId: input.projectId ?? null,
    actorId,
    type: 'CHANNEL_CREATED',
    metadata: { channelId: String(channel._id), name: channel.name, slug, type: channel.type },
  });

  const dto = await buildChannelDto(channel.toObject(), actorId);
  events.emit('channel.created', { channel: dto, actorId });
  return dto;
}

/** Finds or creates the DM between the caller and `otherUserId`. */
export async function openDm(workspaceId: string, actorId: string, otherUserId: string): Promise<ChannelDto> {
  if (otherUserId === actorId) throw ApiError.badRequest('You cannot open a direct message with yourself');
  await assertWorkspaceMembers(workspaceId, [otherUserId]);

  const pair = [actorId, otherUserId].sort();
  const dmKey = pair.join(':');
  const existing = await Channel.findOne({ workspaceId, dmKey }).lean();
  if (existing) return buildChannelDto(existing, actorId);

  const users = await loadUserMap(pair);
  const channel = await Channel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    type: 'DM',
    name: users.get(otherUserId).name,
    slug: `dm-${pair.join('-')}`,
    memberIds: pair.map((id) => new Types.ObjectId(id)),
    dmKey,
    createdBy: new Types.ObjectId(actorId),
  });

  const dto = await buildChannelDto(channel.toObject(), actorId);
  events.emit('channel.created', { channel: dto, actorId });
  return dto;
}

// ---------- update / delete ----------

export function canManageChannel(channel: ChannelLean, userId: string, role: WorkspaceRole): boolean {
  return (channel.createdBy !== null && String(channel.createdBy) === userId) || hasPermission(role, 'channel:manage');
}

export async function updateChannel(
  channel: ChannelLean,
  actorId: string,
  role: WorkspaceRole,
  input: UpdateChannelInput,
): Promise<ChannelDto> {
  if (channel.type === 'DM') throw ApiError.badRequest('Direct messages cannot be edited');
  if (!canManageChannel(channel, actorId, role)) {
    throw ApiError.forbidden('Only the channel creator or a manager can edit this channel');
  }

  const $set: Record<string, unknown> = {};
  if (input.name !== undefined && input.name !== channel.name) $set.name = input.name;
  if (input.description !== undefined && input.description !== channel.description) $set.description = input.description;
  if (input.isArchived !== undefined && input.isArchived !== channel.isArchived) $set.isArchived = input.isArchived;

  if (Object.keys($set).length === 0) return buildChannelDto(channel, actorId);

  await Channel.updateOne({ _id: channel._id }, { $set });
  const updated = await reloadChannel(channel._id);

  if ($set.isArchived === true) {
    await recordActivity({
      workspaceId: channel.workspaceId,
      projectId: channel.projectId,
      actorId,
      type: 'CHANNEL_ARCHIVED',
      metadata: { channelId: String(channel._id), name: updated.name, slug: updated.slug },
    });
  }

  const dto = await buildChannelDto(updated, actorId);
  events.emit('channel.updated', { channel: dto, actorId });
  return dto;
}

/** Hard-deletes a channel with its messages and read states; attachments are unlinked, not deleted. */
export async function deleteChannel(channel: ChannelLean): Promise<void> {
  if (channel.projectId || channel.slug === GENERAL_SLUG) {
    throw ApiError.badRequest('The general and project channels cannot be deleted');
  }
  await Promise.all([
    Message.deleteMany({ channelId: channel._id }),
    ChannelRead.deleteMany({ channelId: channel._id }),
    FileModel.updateMany({ channelId: channel._id }, { $set: { channelId: null, messageId: null } }),
  ]);
  await Channel.deleteOne({ _id: channel._id });
}

// ---------- members ----------

export async function listChannelMembers(channel: ChannelLean): Promise<WorkspaceMemberDto[]> {
  const workspaceId = String(channel.workspaceId);
  if (channel.type === 'PUBLIC') return listWorkspaceMembers(workspaceId);

  const members = await WorkspaceMember.find({ workspaceId, userId: { $in: channel.memberIds } })
    .sort({ createdAt: 1 })
    .lean();
  const users = await loadUserMap(members.map((m) => m.userId));
  return members.map((m) => toWorkspaceMemberDto(m, users.get(m.userId)));
}

function assertInvitable(channel: ChannelLean): void {
  if (channel.type !== 'PRIVATE' && channel.type !== 'GROUP') {
    throw ApiError.badRequest('Members can only be managed on private and group channels');
  }
}

export async function addChannelMembers(
  channel: ChannelLean,
  actorId: string,
  role: WorkspaceRole,
  userIds: string[],
): Promise<ChannelDto> {
  assertInvitable(channel);
  if (!channelAllows(channel, actorId) && !hasPermission(role, 'channel:manage')) {
    throw ApiError.forbidden('Only channel members or a manager can add members');
  }

  const existing = new Set(channel.memberIds.map(String));
  const toAdd = [...new Set(userIds)].filter((id) => !existing.has(id));
  if (toAdd.length === 0) return buildChannelDto(channel, actorId);

  await assertWorkspaceMembers(channel.workspaceId, toAdd);
  await Channel.updateOne(
    { _id: channel._id },
    { $addToSet: { memberIds: { $each: toAdd.map((id) => new Types.ObjectId(id)) } } },
  );

  const dto = await buildChannelDto(await reloadChannel(channel._id), actorId);
  events.emit('channel.updated', { channel: dto, actorId });
  return dto;
}

export async function removeChannelMember(
  channel: ChannelLean,
  actorId: string,
  role: WorkspaceRole,
  userId: string,
): Promise<ChannelDto> {
  assertInvitable(channel);
  if (userId !== actorId && !hasPermission(role, 'channel:manage')) {
    throw ApiError.forbidden('Only the member themself or a manager can remove a channel member');
  }
  if (!channel.memberIds.some((m) => String(m) === userId)) throw ApiError.notFound('Channel member');

  await Channel.updateOne({ _id: channel._id }, { $pull: { memberIds: new Types.ObjectId(userId) } });

  const dto = await buildChannelDto(await reloadChannel(channel._id), actorId);
  events.emit('channel.updated', { channel: dto, actorId });
  return dto;
}

// ---------- read state ----------

async function readState(channel: ChannelLean, userId: string): Promise<ChannelReadStateDto> {
  const reads = await loadReads(userId, [channel._id]);
  const counts = await unreadCounts(userId, [channel], reads);
  const read = reads.get(String(channel._id));
  return toChannelReadStateDto(channel._id, counts.get(String(channel._id)) ?? 0, readCursor(read), read?.muted ?? false);
}

/** Moves the read cursor to now, or to the given message's `createdAt`. */
export async function markRead(channel: ChannelLean, userId: string, messageId?: string): Promise<ChannelReadStateDto> {
  let lastReadAt = new Date();
  let lastReadMessageId: Types.ObjectId | null = null;
  if (messageId) {
    const message = await Message.findOne({ _id: messageId, channelId: channel._id }).select('createdAt').lean();
    if (!message) throw ApiError.notFound('Message');
    lastReadAt = message.createdAt;
    lastReadMessageId = message._id;
  }
  await ChannelRead.updateOne(
    { channelId: channel._id, userId: new Types.ObjectId(userId) },
    { $set: { lastReadAt, lastReadMessageId }, $setOnInsert: { workspaceId: channel.workspaceId } },
    { upsert: true },
  );
  return readState(channel, userId);
}

/** Used by sendMessage: the author has read everything up to their own message. */
export async function markReadAt(channel: ChannelLean, userId: string, at: Date, messageId: Types.ObjectId): Promise<void> {
  await ChannelRead.updateOne(
    { channelId: channel._id, userId: new Types.ObjectId(userId) },
    { $set: { lastReadAt: at, lastReadMessageId: messageId }, $setOnInsert: { workspaceId: channel.workspaceId } },
    { upsert: true },
  );
}

export async function setMuted(channel: ChannelLean, userId: string, muted: boolean): Promise<ChannelReadStateDto> {
  await ChannelRead.updateOne(
    { channelId: channel._id, userId: new Types.ObjectId(userId) },
    { $set: { muted }, $setOnInsert: { workspaceId: channel.workspaceId, lastReadAt: new Date(0) } },
    { upsert: true },
  );
  return readState(channel, userId);
}

export async function isMuted(channelId: Types.ObjectId | string, userId: string): Promise<boolean> {
  const read = await ChannelRead.findOne({ channelId, userId }).select('muted').lean();
  return read?.muted ?? false;
}

export async function workspaceUnread(
  workspaceId: string,
  userId: string,
): Promise<{ channels: ChannelReadStateDto[]; total: number }> {
  const channels = await Channel.find({ ...visibleChannelFilter(workspaceId, userId), isArchived: false }).lean();
  const reads = await loadReads(userId, channels.map((c) => c._id));
  const counts = await unreadCounts(userId, channels, reads);
  const states = channels.map((c) =>
    toChannelReadStateDto(
      c._id,
      counts.get(String(c._id)) ?? 0,
      readCursor(reads.get(String(c._id))),
      reads.get(String(c._id))?.muted ?? false,
    ),
  );
  return { channels: states, total: states.reduce((sum, s) => sum + s.unreadCount, 0) };
}

// ---------- system channels (chat.listeners) ----------

export async function ensureGeneralChannel(workspaceId: string, ownerId: string): Promise<void> {
  if (await Channel.exists({ workspaceId, slug: GENERAL_SLUG })) return;
  const channel = await Channel.create({
    workspaceId: new Types.ObjectId(workspaceId),
    type: 'PUBLIC',
    name: 'general',
    slug: GENERAL_SLUG,
    description: 'Workspace-wide announcements and conversation',
    createdBy: new Types.ObjectId(ownerId),
  });
  events.emit('channel.created', { channel: await buildChannelDto(channel.toObject(), ownerId), actorId: null });
}

export async function createProjectChannel(project: ProjectDto, actorId: string): Promise<void> {
  if (await Channel.exists({ projectId: project.id })) return;
  const slug = await uniqueChannelSlug(project.workspaceId, `proj-${project.key.toLowerCase()}`);
  const channel = await Channel.create({
    workspaceId: new Types.ObjectId(project.workspaceId),
    projectId: new Types.ObjectId(project.id),
    type: 'PUBLIC',
    name: project.name,
    slug,
    description: `Discussion for the ${project.name} project`,
    createdBy: new Types.ObjectId(actorId),
  });
  events.emit('channel.created', { channel: await buildChannelDto(channel.toObject(), actorId), actorId });
}

export async function archiveProjectChannels(projectId: string, actorId: string): Promise<void> {
  const channels = await Channel.find({ projectId, isArchived: false }).lean();
  if (channels.length === 0) return;
  await Channel.updateMany({ _id: { $in: channels.map((c) => c._id) } }, { $set: { isArchived: true } });
  const dtos = await buildChannelDtos(
    channels.map((c) => ({ ...c, isArchived: true })),
    actorId,
  );
  for (const dto of dtos) events.emit('channel.updated', { channel: dto, actorId });
}

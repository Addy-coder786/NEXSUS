import type { Types } from 'mongoose';
import type { ChannelDto, ChannelReadStateDto, FileDto, MessageDto, ReactionDto, UserPublicDto } from '@nexus/shared';
import type { IChannel } from '../../models/Channel';
import type { IChannelRead } from '../../models/ChannelRead';
import type { IFile } from '../../models/File';
import type { IMessage, IReaction } from '../../models/Message';

export type ChannelLean = IChannel & { _id: Types.ObjectId };
export type MessageLean = IMessage & { _id: Types.ObjectId };
export type ChannelReadLean = IChannelRead & { _id: Types.ObjectId };
export type FileLean = IFile & { _id: Types.ObjectId };

export interface ChannelDtoExtras {
  /** Other participants (DM/GROUP) — null for PUBLIC/PRIVATE. */
  participants: UserPublicDto[] | null;
  memberCount: number;
  isMember: boolean;
  unreadCount: number;
  muted: boolean;
  /** Display name override (DMs show the other participant's name). */
  name?: string;
}

export function toChannelDto(c: ChannelLean, extras: ChannelDtoExtras): ChannelDto {
  return {
    id: String(c._id),
    workspaceId: String(c.workspaceId),
    projectId: c.projectId ? String(c.projectId) : null,
    type: c.type,
    name: extras.name ?? c.name,
    slug: c.slug,
    description: c.description ?? null,
    participants: extras.participants,
    memberCount: extras.memberCount,
    isMember: extras.isMember,
    isArchived: c.isArchived,
    isReadOnly: c.isReadOnly,
    source: c.source,
    unreadCount: extras.unreadCount,
    muted: extras.muted,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    lastMessagePreview: c.lastMessagePreview ?? null,
    createdBy: c.createdBy ? String(c.createdBy) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** `reacted` is relative to `viewerId`; pass null for socket pushes (clients derive it from `userIds`). */
export function toReactionDtos(reactions: IReaction[], viewerId: string | null): ReactionDto[] {
  return reactions
    .filter((r) => r.userIds.length > 0)
    .map((r) => {
      const userIds = r.userIds.map(String);
      return {
        emoji: r.emoji,
        count: userIds.length,
        userIds,
        reacted: viewerId !== null && userIds.includes(viewerId),
      };
    });
}

export interface MessageDtoExtras {
  author: UserPublicDto | null;
  attachments: FileDto[];
}

export function toMessageDto(m: MessageLean, extras: MessageDtoExtras, viewerId: string | null): MessageDto {
  const deleted = m.deletedAt !== null;
  return {
    id: String(m._id),
    channelId: String(m.channelId),
    workspaceId: String(m.workspaceId),
    author: extras.author,
    externalAuthor: m.externalAuthor ? { name: m.externalAuthor.name, avatarUrl: m.externalAuthor.avatarUrl ?? null } : null,
    body: deleted ? '' : m.body,
    mentions: m.mentions.map(String),
    attachments: deleted ? [] : extras.attachments,
    parentMessageId: m.parentMessageId ? String(m.parentMessageId) : null,
    replyCount: m.replyCount,
    lastReplyAt: m.lastReplyAt ? m.lastReplyAt.toISOString() : null,
    reactions: toReactionDtos(m.reactions, viewerId),
    source: m.source,
    clientId: m.clientId ?? null,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Minimal FileDto mapper for message attachments (field names per `FileDto`). */
export function toFileDto(f: FileLean, uploadedBy: UserPublicDto): FileDto {
  return {
    id: String(f._id),
    workspaceId: String(f.workspaceId),
    projectId: f.projectId ? String(f.projectId) : null,
    taskId: f.taskId ? String(f.taskId) : null,
    channelId: f.channelId ? String(f.channelId) : null,
    documentId: f.documentId ? String(f.documentId) : null,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    kind: f.kind,
    url: f.url,
    thumbnailUrl: f.thumbnailUrl ?? null,
    width: f.width ?? null,
    height: f.height ?? null,
    uploadedBy,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toChannelReadStateDto(
  channelId: Types.ObjectId | string,
  unreadCount: number,
  lastReadAt: Date | null,
  muted = false,
): ChannelReadStateDto {
  return { channelId: String(channelId), unreadCount, lastReadAt: lastReadAt ? lastReadAt.toISOString() : null, muted };
}

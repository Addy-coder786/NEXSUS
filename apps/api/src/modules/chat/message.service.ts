import { Types, type FilterQuery } from 'mongoose';
import {
  hasPermission,
  type EditMessageInput,
  type FileDto,
  type MessageDto,
  type MessageListQuery,
  type SendMessageInput,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { Channel } from '../../models/Channel';
import { FileModel } from '../../models/File';
import { Message, type IMessage } from '../../models/Message';
import { ApiError } from '../../utils/ApiError';
import { loadUserMap } from '../workspaces/user.lookup';
import { filterWorkspaceMembers } from '../workspaces/workspace.service';
import { buildChannelDto, markReadAt, messagePreview, reloadChannel } from './channel.service';
import { toFileDto, toMessageDto, type ChannelLean, type MessageLean } from './chat.dto';

// ---------- DTO building ----------

async function loadAttachments(messages: MessageLean[]): Promise<Map<string, FileDto>> {
  const ids = messages.flatMap((m) => (m.deletedAt ? [] : m.attachmentIds));
  if (ids.length === 0) return new Map();
  const files = await FileModel.find({ _id: { $in: ids }, deletedAt: null }).lean();
  const users = await loadUserMap(files.map((f) => f.uploadedBy));
  return new Map(files.map((f) => [String(f._id), toFileDto(f, users.get(f.uploadedBy))]));
}

/** `viewerId` drives `reactions[].reacted`; pass null for socket pushes. */
export async function buildMessageDtos(messages: MessageLean[], viewerId: string | null): Promise<MessageDto[]> {
  if (messages.length === 0) return [];
  const [users, attachments] = await Promise.all([
    loadUserMap(messages.map((m) => m.authorId)),
    loadAttachments(messages),
  ]);
  return messages.map((m) =>
    toMessageDto(
      m,
      {
        author: users.getOrNull(m.authorId),
        attachments: m.attachmentIds.flatMap((id) => {
          const file = attachments.get(String(id));
          return file ? [file] : [];
        }),
      },
      viewerId,
    ),
  );
}

export async function buildMessageDto(message: MessageLean, viewerId: string | null): Promise<MessageDto> {
  const [dto] = await buildMessageDtos([message], viewerId);
  if (!dto) throw ApiError.internal();
  return dto;
}

async function reloadMessage(messageId: Types.ObjectId): Promise<MessageLean> {
  const message = await Message.findById(messageId).lean();
  if (!message) throw ApiError.notFound('Message');
  return message;
}

// ---------- read ----------

/** Top-level messages, newest first, cursor-paginated on `createdAt`. */
export async function listMessages(channel: ChannelLean, viewerId: string, query: MessageListQuery): Promise<MessageDto[]> {
  const filter: FilterQuery<IMessage> = { channelId: channel._id, parentMessageId: null };
  if (query.before || query.after) {
    filter.createdAt = {
      ...(query.before ? { $lt: query.before } : {}),
      ...(query.after ? { $gt: query.after } : {}),
    };
  }
  const messages = await Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(query.limit).lean();
  return buildMessageDtos(messages, viewerId);
}

export function getMessage(message: MessageLean, viewerId: string): Promise<MessageDto> {
  return buildMessageDto(message, viewerId);
}

/** Thread replies, oldest first. */
export async function listReplies(message: MessageLean, viewerId: string, limit: number): Promise<MessageDto[]> {
  const replies = await Message.find({ parentMessageId: message._id }).sort({ createdAt: 1, _id: 1 }).limit(limit).lean();
  return buildMessageDtos(replies, viewerId);
}

// ---------- send ----------

async function resolveAttachments(channel: ChannelLean, actorId: string, ids: string[] | undefined): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return [];
  const files = await FileModel.find({
    _id: { $in: unique },
    workspaceId: channel.workspaceId,
    uploadedBy: new Types.ObjectId(actorId),
    messageId: null,
    deletedAt: null,
  })
    .select('_id')
    .lean();
  if (files.length !== unique.length) {
    throw ApiError.badRequest('Attachments must be your own unattached files in this workspace');
  }
  return files.map((f) => f._id);
}

async function resolveParent(channel: ChannelLean, parentMessageId: string | undefined): Promise<MessageLean | null> {
  if (!parentMessageId) return null;
  const parent = await Message.findOne({ _id: parentMessageId, channelId: channel._id }).lean();
  if (!parent || parent.parentMessageId) throw ApiError.badRequest('Replies must target a top-level message in this channel');
  if (parent.deletedAt) throw ApiError.badRequest('Cannot reply to a deleted message');
  return parent;
}

export async function sendMessage(channel: ChannelLean, actorId: string, input: SendMessageInput): Promise<MessageDto> {
  if (channel.isReadOnly) throw ApiError.forbidden('This channel is mirrored from Slack and is read-only');
  if (channel.isArchived) throw ApiError.forbidden('This channel is archived');

  const [mentions, attachmentIds, parent] = await Promise.all([
    filterWorkspaceMembers(channel.workspaceId, input.mentions ?? []),
    resolveAttachments(channel, actorId, input.attachmentIds),
    resolveParent(channel, input.parentMessageId),
  ]);

  const message = await Message.create({
    workspaceId: channel.workspaceId,
    channelId: channel._id,
    authorId: new Types.ObjectId(actorId),
    body: input.body,
    mentions: mentions.map((id) => new Types.ObjectId(id)),
    attachmentIds,
    parentMessageId: parent ? parent._id : null,
    source: 'nexus',
    clientId: input.clientId ?? null,
  });

  const writes: Promise<unknown>[] = [markReadAt(channel, actorId, message.createdAt, message._id)];
  if (attachmentIds.length) {
    writes.push(
      FileModel.updateMany({ _id: { $in: attachmentIds } }, { $set: { channelId: channel._id, messageId: message._id } }),
    );
  }
  if (parent) {
    writes.push(Message.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 }, $set: { lastReplyAt: message.createdAt } }));
  } else {
    writes.push(
      Channel.updateOne(
        { _id: channel._id },
        {
          $set: { lastMessageAt: message.createdAt, lastMessagePreview: messagePreview(input.body, attachmentIds.length) },
          $inc: { messageCount: 1 },
        },
      ),
    );
  }
  await Promise.all(writes);

  const lean = message.toObject();
  const [dto, channelDto] = await Promise.all([
    buildMessageDto(lean, actorId),
    buildChannelDto(await reloadChannel(channel._id), actorId),
  ]);
  events.emit('message.created', { message: dto, channel: channelDto, actorId });
  return dto;
}

// ---------- edit / delete / react ----------

export async function editMessage(message: MessageLean, actorId: string, input: EditMessageInput): Promise<MessageDto> {
  if (message.authorId === null || String(message.authorId) !== actorId) {
    throw ApiError.forbidden('Only the author can edit a message');
  }
  if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be edited');

  const editedAt = new Date();
  await Message.updateOne({ _id: message._id }, { $set: { body: input.body, editedAt } });
  if (!message.parentMessageId) {
    // Keep the channel preview in sync when the latest message is edited.
    await Channel.updateOne(
      { _id: message.channelId, lastMessageAt: message.createdAt },
      { $set: { lastMessagePreview: messagePreview(input.body, message.attachmentIds.length) } },
    );
  }

  const updated = await reloadMessage(message._id);
  events.emit('message.updated', { message: await buildMessageDto(updated, null) });
  return buildMessageDto(updated, actorId);
}

export function canDeleteMessage(message: MessageLean, userId: string, role: WorkspaceRole): boolean {
  if (message.authorId !== null && String(message.authorId) === userId) return true;
  return hasPermission(role, 'channel:manage');
}

/** Soft delete: body cleared, attachments unlinked (files are kept), thread shape preserved. */
export async function deleteMessage(message: MessageLean, actorId: string, role: WorkspaceRole): Promise<MessageDto> {
  if (!canDeleteMessage(message, actorId, role)) {
    throw ApiError.forbidden('Only the author or a manager can delete this message');
  }
  if (message.deletedAt) return buildMessageDto(message, actorId);

  await Promise.all([
    Message.updateOne({ _id: message._id }, { $set: { deletedAt: new Date(), body: '', attachmentIds: [] } }),
    message.attachmentIds.length
      ? FileModel.updateMany({ _id: { $in: message.attachmentIds } }, { $set: { messageId: null, channelId: null } })
      : Promise.resolve(),
  ]);

  const updated = await reloadMessage(message._id);
  events.emit('message.deleted', {
    workspaceId: String(message.workspaceId),
    channelId: String(message.channelId),
    messageId: String(message._id),
    parentMessageId: message.parentMessageId ? String(message.parentMessageId) : null,
  });
  return buildMessageDto(updated, actorId);
}

/** Adds the caller to the emoji's reaction, or removes them if already present. */
export async function toggleReaction(message: MessageLean, actorId: string, emoji: string): Promise<MessageDto> {
  if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be reacted to');
  const uid = new Types.ObjectId(actorId);
  const existing = message.reactions.find((r) => r.emoji === emoji);
  const reacted = existing?.userIds.some((u) => String(u) === actorId) ?? false;

  if (!existing) {
    await Message.updateOne({ _id: message._id }, { $push: { reactions: { emoji, userIds: [uid] } } });
  } else if (reacted) {
    await Message.updateOne({ _id: message._id, 'reactions.emoji': emoji }, { $pull: { 'reactions.$.userIds': uid } });
    await Message.updateOne({ _id: message._id }, { $pull: { reactions: { emoji, userIds: { $size: 0 } } } });
  } else {
    await Message.updateOne({ _id: message._id, 'reactions.emoji': emoji }, { $addToSet: { 'reactions.$.userIds': uid } });
  }

  const updated = await reloadMessage(message._id);
  events.emit('message.updated', { message: await buildMessageDto(updated, null) });
  return buildMessageDto(updated, actorId);
}

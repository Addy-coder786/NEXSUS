import type { Types } from 'mongoose';
import type { UserPublicDto } from '@nexus/shared';
import { logger } from '../../../config/logger';
import { cache } from '../../../config/redis';
import { events } from '../../../events';
import { Channel } from '../../../models/Channel';
import { Message } from '../../../models/Message';
import { User } from '../../../models/User';
import { WorkspaceMember } from '../../../models/WorkspaceMember';
import { loadUserMap } from '../../workspaces/user.lookup';
import { usersInfo, type SlackMessage } from './slack.client';
import { toImportedMessageDto, toMirroredChannelDto, type ChannelLean, type IntegrationLean, type MessageLean } from './slack.dto';

const USER_CACHE_TTL_SEC = 60 * 60;
const PREVIEW_LENGTH = 200;

export interface ImportContext {
  integration: IntegrationLean;
  /** Decrypted bot token */
  token: string;
  channel: ChannelLean;
}

interface CachedSlackUser {
  name: string;
  avatarUrl: string | null;
  email: string | null;
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export function slackTsToDate(ts: string): Date {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds) ? new Date(Math.round(seconds * 1000)) : new Date();
}

/** Unescapes Slack's mrkdwn entities and link syntax into plain text. */
export function slackTextToBody(text: string | undefined): string {
  if (!text) return '';
  return text
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<@([A-Z0-9]+)>/g, '@$1')
    .replace(/<!(channel|here|everyone)>/g, '@$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/** `users.info` lookup cached for an hour per team. Failures degrade to a generic author. */
export async function lookupSlackUser(token: string, teamId: string, slackUserId: string): Promise<CachedSlackUser> {
  const key = `slack:user:${teamId}:${slackUserId}`;
  const hit = await cache.get<CachedSlackUser>(key);
  if (hit) return hit;

  let resolved: CachedSlackUser = { name: 'Slack user', avatarUrl: null, email: null };
  try {
    const user = await usersInfo(token, slackUserId);
    resolved = {
      name: user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || 'Slack user',
      avatarUrl: user.profile?.image_72 ?? user.profile?.image_48 ?? user.profile?.image_192 ?? null,
      email: user.profile?.email?.toLowerCase() ?? null,
    };
  } catch (err) {
    logger.warn({ err, slackUserId }, 'Slack users.info failed');
  }
  await cache.set(key, resolved, USER_CACHE_TTL_SEC);
  return resolved;
}

export interface ResolvedAuthor {
  authorId: Types.ObjectId | null;
  externalAuthor: { name: string; avatarUrl: string | null; slackUserId: string | null };
}

/** Maps a Slack user to a workspace member by email when possible. */
export async function resolveAuthor(ctx: ImportContext, slackUserId: string | undefined): Promise<ResolvedAuthor> {
  if (!slackUserId) return { authorId: null, externalAuthor: { name: 'Slack', avatarUrl: null, slackUserId: null } };
  const info = await lookupSlackUser(ctx.token, ctx.integration.externalId, slackUserId);

  let authorId: Types.ObjectId | null = null;
  if (info.email) {
    const user = await User.findOne({ email: info.email, deletedAt: null }).select('_id').lean();
    if (user) {
      const member = await WorkspaceMember.exists({ workspaceId: ctx.integration.workspaceId, userId: user._id });
      if (member) authorId = user._id;
    }
  }
  return { authorId, externalAuthor: { name: info.name, avatarUrl: info.avatarUrl, slackUserId } };
}

export function isImportableMessage(ctx: ImportContext, msg: SlackMessage): boolean {
  if (!msg.ts) return false;
  if (msg.subtype && msg.subtype !== 'file_share') return false;
  if (msg.hidden) return false;
  if (msg.bot_id && !msg.user) return false;
  if (ctx.integration.botUserId && msg.user === ctx.integration.botUserId) return false;
  return true;
}

async function emitCreated(ctx: ImportContext, message: MessageLean): Promise<void> {
  const [users, channel, memberCount] = await Promise.all([
    loadUserMap([message.authorId]),
    Channel.findById(ctx.channel._id).lean(),
    WorkspaceMember.countDocuments({ workspaceId: ctx.integration.workspaceId }),
  ]);
  const author: UserPublicDto | null = users.getOrNull(message.authorId);
  events.emit('message.created', {
    message: toImportedMessageDto(message, author),
    channel: toMirroredChannelDto(channel ?? ctx.channel, memberCount),
    actorId: null,
  });
}

/**
 * Imports one Slack message into the mirrored channel. Returns the stored message, or null when
 * the message is skipped (unsupported subtype, bot echo) or already imported.
 */
export async function importSlackMessage(ctx: ImportContext, msg: SlackMessage): Promise<MessageLean | null> {
  if (!isImportableMessage(ctx, msg) || !msg.ts) return null;
  const existing = await Message.exists({ channelId: ctx.channel._id, slackTs: msg.ts });
  if (existing) return null;

  const author = await resolveAuthor(ctx, msg.user);

  let parentMessageId: Types.ObjectId | null = null;
  if (msg.thread_ts && msg.thread_ts !== msg.ts) {
    const parent = await Message.findOne({ channelId: ctx.channel._id, slackTs: msg.thread_ts }).select('_id').lean();
    parentMessageId = parent?._id ?? null;
  }

  let body = slackTextToBody(msg.text);
  if (!body && msg.files?.length) {
    body = `Shared ${msg.files.map((f) => f.title || f.name || 'a file').join(', ')}`;
  }
  const createdAt = slackTsToDate(msg.ts);

  let created: MessageLean;
  try {
    const doc = await Message.create({
      workspaceId: ctx.integration.workspaceId,
      channelId: ctx.channel._id,
      authorId: author.authorId,
      externalAuthor: author.externalAuthor,
      body,
      mentions: [],
      attachmentIds: [],
      parentMessageId,
      source: 'slack',
      slackTs: msg.ts,
      createdAt,
      updatedAt: createdAt,
    });
    created = doc.toObject();
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    throw err;
  }

  if (parentMessageId) {
    await Message.updateOne({ _id: parentMessageId }, { $inc: { replyCount: 1 }, $max: { lastReplyAt: createdAt } });
  } else {
    await Channel.updateOne(
      { _id: ctx.channel._id },
      {
        $inc: { messageCount: 1 },
        $max: { lastMessageAt: createdAt },
        $set: { lastMessagePreview: body.slice(0, PREVIEW_LENGTH), 'slack.lastSyncedAt': new Date() },
      },
    );
  }

  await emitCreated(ctx, created);
  return created;
}

/** `message_changed`: updates the body of the mirrored message. */
export async function updateSlackMessage(ctx: ImportContext, changed: SlackMessage | undefined): Promise<MessageLean | null> {
  if (!changed?.ts) return null;
  const body = slackTextToBody(changed.text);
  const updated = await Message.findOneAndUpdate(
    { channelId: ctx.channel._id, slackTs: changed.ts, deletedAt: null },
    { $set: { body, editedAt: new Date() } },
    { new: true },
  ).lean();
  if (!updated) return null;

  const users = await loadUserMap([updated.authorId]);
  events.emit('message.updated', { message: toImportedMessageDto(updated, users.getOrNull(updated.authorId)) });
  return updated;
}

/** `message_deleted`: soft-deletes the mirrored message. */
export async function deleteSlackMessage(ctx: ImportContext, deletedTs: string | undefined): Promise<MessageLean | null> {
  if (!deletedTs) return null;
  const deleted = await Message.findOneAndUpdate(
    { channelId: ctx.channel._id, slackTs: deletedTs, deletedAt: null },
    { $set: { deletedAt: new Date(), body: '' } },
    { new: true },
  ).lean();
  if (!deleted) return null;

  if (!deleted.parentMessageId) {
    await Channel.updateOne({ _id: ctx.channel._id, messageCount: { $gt: 0 } }, { $inc: { messageCount: -1 } });
  }
  events.emit('message.deleted', {
    workspaceId: String(deleted.workspaceId),
    channelId: String(deleted.channelId),
    messageId: String(deleted._id),
    parentMessageId: deleted.parentMessageId ? String(deleted.parentMessageId) : null,
  });
  return deleted;
}

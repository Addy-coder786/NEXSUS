import type { Types } from 'mongoose';
import type { ChannelDto, MessageDto, SlackIntegrationDto, UserPublicDto } from '@nexus/shared';
import type { IChannel } from '../../../models/Channel';
import type { IIntegration } from '../../../models/Integration';
import type { IMessage } from '../../../models/Message';

export type IntegrationLean = IIntegration & { _id: Types.ObjectId };
export type ChannelLean = IChannel & { _id: Types.ObjectId };
export type MessageLean = IMessage & { _id: Types.ObjectId };

export function toSlackIntegrationDto(
  integration: IntegrationLean,
  channelCounts: Map<string, number>,
): SlackIntegrationDto {
  return {
    id: String(integration._id),
    provider: 'slack',
    workspaceId: String(integration.workspaceId),
    teamId: integration.externalId,
    teamName: integration.externalName,
    teamIconUrl: integration.externalIconUrl ?? null,
    installedBy: String(integration.installedBy),
    notificationChannelId: integration.notificationChannelId ?? null,
    notificationChannelName: integration.notificationChannelName ?? null,
    notifyOn: [...integration.notifyOn],
    syncedChannels: integration.syncedChannels.map((c) => ({
      slackChannelId: c.slackChannelId,
      slackChannelName: c.slackChannelName,
      channelId: String(c.channelId),
      lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
      messageCount: channelCounts.get(String(c.channelId)) ?? 0,
    })),
    status: integration.status,
    lastError: integration.lastError ?? null,
    createdAt: integration.createdAt.toISOString(),
  };
}

/** ChannelDto for a Slack-mirrored (PUBLIC, read-only) channel as seen by no particular viewer. */
export function toMirroredChannelDto(channel: ChannelLean, memberCount: number): ChannelDto {
  return {
    id: String(channel._id),
    workspaceId: String(channel.workspaceId),
    projectId: channel.projectId ? String(channel.projectId) : null,
    type: channel.type,
    name: channel.name,
    slug: channel.slug,
    description: channel.description ?? null,
    participants: null,
    memberCount,
    isMember: true,
    isArchived: channel.isArchived,
    isReadOnly: channel.isReadOnly,
    source: channel.source,
    unreadCount: 0,
    muted: false,
    lastMessageAt: channel.lastMessageAt ? channel.lastMessageAt.toISOString() : null,
    lastMessagePreview: channel.lastMessagePreview ?? null,
    createdBy: channel.createdBy ? String(channel.createdBy) : null,
    createdAt: channel.createdAt.toISOString(),
  };
}

/** MessageDto for an imported Slack message (no attachments, reactions relative to nobody). */
export function toImportedMessageDto(message: MessageLean, author: UserPublicDto | null): MessageDto {
  return {
    id: String(message._id),
    channelId: String(message.channelId),
    workspaceId: String(message.workspaceId),
    author,
    externalAuthor: message.externalAuthor
      ? { name: message.externalAuthor.name, avatarUrl: message.externalAuthor.avatarUrl ?? null }
      : null,
    body: message.body,
    mentions: message.mentions.map(String),
    attachments: [],
    parentMessageId: message.parentMessageId ? String(message.parentMessageId) : null,
    replyCount: message.replyCount,
    lastReplyAt: message.lastReplyAt ? message.lastReplyAt.toISOString() : null,
    reactions: message.reactions.map((r) => ({
      emoji: r.emoji,
      count: r.userIds.length,
      userIds: r.userIds.map(String),
      reacted: false,
    })),
    source: message.source,
    clientId: message.clientId ?? null,
    editedAt: message.editedAt ? message.editedAt.toISOString() : null,
    deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
    createdAt: message.createdAt.toISOString(),
  };
}

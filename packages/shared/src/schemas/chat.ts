import { z } from 'zod';
import {
  MAX_MESSAGE_LENGTH,
  WORKSPACE_SLUG_REGEX,
  type ChannelType,
  type MessageSource,
} from '../constants';
import { objectIdSchema } from './common';
import type { FileDto } from './file';
import type { UserPublicDto } from './user';

export const createChannelSchema = z.object({
  type: z.enum(['PUBLIC', 'PRIVATE', 'GROUP']).default('PUBLIC'),
  name: z.string().trim().min(2).max(60),
  slug: z.string().trim().min(2).max(40).regex(WORKSPACE_SLUG_REGEX).optional(),
  description: z.string().trim().max(300).optional(),
  projectId: objectIdSchema.optional(),
  memberIds: z.array(objectIdSchema).max(200).optional(),
});
export const updateChannelSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isArchived: z.boolean().optional(),
});
export const openDmSchema = z.object({ userId: objectIdSchema });
export const channelMembersSchema = z.object({ userIds: z.array(objectIdSchema).min(1).max(100) });

export const sendMessageSchema = z.object({
  body: z.string().trim().max(MAX_MESSAGE_LENGTH),
  mentions: z.array(objectIdSchema).max(50).optional(),
  attachmentIds: z.array(objectIdSchema).max(10).optional(),
  parentMessageId: objectIdSchema.optional(),
  /** Client-generated id for optimistic rendering; echoed back on the created message. */
  clientId: z.string().max(64).optional(),
}).refine((m) => m.body.length > 0 || (m.attachmentIds?.length ?? 0) > 0, {
  message: 'Message must have text or an attachment',
  path: ['body'],
});
export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });
export const reactionSchema = z.object({ emoji: z.string().min(1).max(32) });

export const messageListQuerySchema = z.object({
  /** Return messages created before this ISO timestamp (cursor pagination, newest first). */
  before: z.coerce.date().optional(),
  after: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const markReadSchema = z.object({ messageId: objectIdSchema.optional() });

export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type EditMessageInput = z.infer<typeof editMessageSchema>;
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

export interface ChannelDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  type: ChannelType;
  name: string;
  slug: string;
  description: string | null;
  /** For DM/GROUP: the other participants. For PUBLIC/PRIVATE: null (use /members). */
  participants: UserPublicDto[] | null;
  memberCount: number;
  isMember: boolean;
  isArchived: boolean;
  /** Mirrored from Slack; composer is disabled. */
  isReadOnly: boolean;
  source: 'nexus' | 'slack';
  unreadCount: number;
  /** Viewer has muted notifications for this channel. */
  muted: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ReactionDto {
  emoji: string;
  count: number;
  userIds: string[];
  reacted: boolean;
}

export interface MessageDto {
  id: string;
  channelId: string;
  workspaceId: string;
  /** null for system or Slack messages without a linked NEXUS user */
  author: UserPublicDto | null;
  /** Display name for messages whose author is not a NEXUS user (Slack). */
  externalAuthor: { name: string; avatarUrl: string | null } | null;
  body: string;
  mentions: string[];
  attachments: FileDto[];
  parentMessageId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: ReactionDto[];
  source: MessageSource;
  clientId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ChannelReadStateDto {
  channelId: string;
  unreadCount: number;
  lastReadAt: string | null;
  muted: boolean;
}

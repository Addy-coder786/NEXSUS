import type { ChannelDto, MessageDto, NotificationDto, UserDto, UserPublicDto } from '@nexus/shared';
import { makeUser } from '@/test/utils';

let seq = 1000;
const hex = (n: number) => n.toString(16).padStart(24, '0');

export function makeMessage(overrides: Partial<MessageDto> & { author?: UserPublicDto | null } = {}): MessageDto {
  seq += 1;
  return {
    id: hex(seq),
    channelId: hex(1),
    workspaceId: hex(2),
    author: overrides.author === undefined ? makeUser() : overrides.author,
    externalAuthor: null,
    body: `Message ${seq}`,
    mentions: [],
    attachments: [],
    parentMessageId: null,
    replyCount: 0,
    lastReplyAt: null,
    reactions: [],
    source: 'nexus',
    clientId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeChannel(overrides: Partial<ChannelDto> = {}): ChannelDto {
  seq += 1;
  return {
    id: hex(seq),
    workspaceId: hex(2),
    projectId: null,
    type: 'PUBLIC',
    name: 'general',
    slug: 'general',
    description: null,
    participants: null,
    memberCount: 3,
    isMember: true,
    isArchived: false,
    isReadOnly: false,
    source: 'nexus',
    unreadCount: 0,
    muted: false,
    lastMessageAt: null,
    lastMessagePreview: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  seq += 1;
  return {
    id: hex(seq),
    workspaceId: hex(2),
    type: 'MENTION',
    title: `Notification ${seq}`,
    body: null,
    link: null,
    actor: null,
    entity: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeUserDto(overrides: Partial<UserDto> = {}): UserDto {
  const base = makeUser();
  return {
    ...base,
    bio: null,
    timezone: null,
    emailVerified: true,
    hasPassword: true,
    preferences: {
      notifications: { email: true, inApp: true, taskAssigned: true, taskCompleted: true, mentions: true, comments: true, deadlines: true },
      theme: 'system',
    },
    oauthProviders: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function minutesAgo(minutes: number, from = Date.now()): string {
  return new Date(from - minutes * 60_000).toISOString();
}

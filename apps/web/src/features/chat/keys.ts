export const chatKeys = {
  all: ['chat'] as const,
  channelLists: () => [...chatKeys.all, 'channels'] as const,
  channels: (workspaceId: string) => [...chatKeys.channelLists(), workspaceId] as const,
  channel: (channelId: string) => [...chatKeys.all, 'channel', channelId] as const,
  members: (channelId: string) => [...chatKeys.all, 'members', channelId] as const,
  messages: (channelId: string) => [...chatKeys.all, 'messages', channelId] as const,
  message: (messageId: string) => [...chatKeys.all, 'message', messageId] as const,
  replies: (messageId: string) => [...chatKeys.all, 'replies', messageId] as const,
  unreadAll: () => [...chatKeys.all, 'unread'] as const,
  unread: (workspaceId: string) => [...chatKeys.unreadAll(), workspaceId] as const,
};

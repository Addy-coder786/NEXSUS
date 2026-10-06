import type {
  ChannelDto,
  ChannelReadStateDto,
  CreateChannelInput,
  FileDto,
  MessageDto,
  SendMessageInput,
  UpdateChannelInput,
  WorkspaceMemberDto,
} from '@nexus/shared';
import { api, cleanParams } from '@/lib/api';

export interface UnreadSummary {
  channels: ChannelReadStateDto[];
  total: number;
}

export const chatApi = {
  channels: (workspaceId: string) => api.get<ChannelDto[]>(`/workspaces/${workspaceId}/channels`),
  createChannel: (workspaceId: string, input: CreateChannelInput) =>
    api.post<ChannelDto>(`/workspaces/${workspaceId}/channels`, input),
  openDm: (workspaceId: string, userId: string) =>
    api.post<ChannelDto>(`/workspaces/${workspaceId}/channels/dm`, { userId }),
  channel: (channelId: string) => api.get<ChannelDto>(`/channels/${channelId}`),
  updateChannel: (channelId: string, input: UpdateChannelInput) =>
    api.patch<ChannelDto>(`/channels/${channelId}`, input),
  deleteChannel: (channelId: string) => api.delete(`/channels/${channelId}`),
  members: (channelId: string) => api.get<WorkspaceMemberDto[]>(`/channels/${channelId}/members`),
  addMembers: (channelId: string, userIds: string[]) =>
    api.post<ChannelDto>(`/channels/${channelId}/members`, { userIds }),
  removeMember: (channelId: string, userId: string) =>
    api.delete<ChannelDto>(`/channels/${channelId}/members/${userId}`),
  markRead: (channelId: string, messageId?: string) =>
    api.post<ChannelReadStateDto>(`/channels/${channelId}/read`, messageId ? { messageId } : {}),
  mute: (channelId: string, muted: boolean) =>
    api.post<ChannelReadStateDto>(`/channels/${channelId}/mute`, { muted }),

  messages: (channelId: string, query: { before?: string; limit?: number }) =>
    api.get<MessageDto[]>(`/channels/${channelId}/messages`, cleanParams({ ...query })),
  send: (channelId: string, input: SendMessageInput) => api.post<MessageDto>(`/channels/${channelId}/messages`, input),
  message: (messageId: string) => api.get<MessageDto>(`/messages/${messageId}`),
  replies: (messageId: string, limit = 100) => api.get<MessageDto[]>(`/messages/${messageId}/replies`, { limit }),
  edit: (messageId: string, body: string) => api.patch<MessageDto>(`/messages/${messageId}`, { body }),
  remove: (messageId: string) => api.delete<MessageDto>(`/messages/${messageId}`),
  react: (messageId: string, emoji: string) => api.post<MessageDto>(`/messages/${messageId}/reactions`, { emoji }),

  unread: (workspaceId: string) => api.get<UnreadSummary>(`/workspaces/${workspaceId}/unread`),

  uploadAttachment: (
    workspaceId: string,
    file: File,
    fields: { channelId: string },
    onProgress?: (fraction: number) => void,
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('channelId', fields.channelId);
    return api.post<FileDto>(`/workspaces/${workspaceId}/files`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.min(1, e.loaded / e.total));
      },
    });
  },
};

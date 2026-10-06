import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ChannelDto,
  CreateChannelInput,
  FileDto,
  MessageDto,
  ReactionDto,
  UpdateChannelInput,
} from '@nexus/shared';
import { chatApi } from './api';
import { chatKeys } from './keys';
import {
  MESSAGES_PAGE_SIZE,
  bumpChannelPreview,
  findChannelInCache,
  patchChannel,
  patchMessage,
  patchMessageAnywhere,
  removeChannel,
  setChannelUnread,
  toggleReactionLocally,
  upsertChannel,
  upsertMessage,
  withMyReactions,
  type ChatMessage,
  type MessagesData,
} from './cache';
import { getErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';

export type { ChatMessage, MessagesData } from './cache';

export function useChannels(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: chatKeys.channels(workspaceId ?? ''),
    queryFn: () => chatApi.channels(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useChannel(channelId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: chatKeys.channel(channelId ?? ''),
    queryFn: () => chatApi.channel(channelId as string),
    enabled: Boolean(channelId),
    initialData: () => (channelId ? findChannelInCache(queryClient, channelId) : undefined),
    initialDataUpdatedAt: () => Date.now() - 60_000,
    staleTime: 60_000,
  });
}

export function useChannelMembers(channelId: string | null | undefined) {
  return useQuery({
    queryKey: chatKeys.members(channelId ?? ''),
    queryFn: () => chatApi.members(channelId as string),
    enabled: Boolean(channelId),
    staleTime: 5 * 60_000,
  });
}

export function useUnread(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: chatKeys.unread(workspaceId ?? ''),
    queryFn: () => chatApi.unread(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useCreateChannel(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChannelInput) => chatApi.createChannel(workspaceId, input),
    onSuccess: (channel) => upsertChannel(queryClient, channel, { full: true }),
  });
}

export function useOpenDm(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chatApi.openDm(workspaceId, userId),
    onSuccess: (channel) => upsertChannel(queryClient, channel, { full: true }),
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, ...input }: UpdateChannelInput & { channelId: string }) =>
      chatApi.updateChannel(channelId, input),
    onSuccess: (channel) => upsertChannel(queryClient, channel, { full: true }),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channel: Pick<ChannelDto, 'id' | 'workspaceId'>) => chatApi.deleteChannel(channel.id),
    onSuccess: (_, channel) => {
      removeChannel(queryClient, channel.workspaceId, channel.id);
      // DELETE emits no socket event, so refresh the list from the server.
      void queryClient.invalidateQueries({ queryKey: chatKeys.channels(channel.workspaceId) });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useAddChannelMembers(channelId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) => chatApi.addMembers(channelId, userIds),
    onSuccess: (channel) => {
      upsertChannel(queryClient, channel, { full: true });
      void queryClient.invalidateQueries({ queryKey: chatKeys.members(channelId) });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useMessages(channelId: string | null | undefined) {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  return useInfiniteQuery<ChatMessage[], Error, MessagesData, ReturnType<typeof chatKeys.messages>, string | undefined>({
    queryKey: chatKeys.messages(channelId ?? ''),
    queryFn: async ({ pageParam }) => {
      const items = await chatApi.messages(channelId as string, { before: pageParam, limit: MESSAGES_PAGE_SIZE });
      return items.map((m) => ({ ...m, reactions: withMyReactions(m.reactions, myId) }));
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.length < MESSAGES_PAGE_SIZE ? undefined : last[last.length - 1]?.createdAt),
    enabled: Boolean(channelId),
    // Realtime keeps this cache fresh; refetching would drop optimistic entries.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useMessage(messageId: string | null | undefined) {
  return useQuery({
    queryKey: chatKeys.message(messageId ?? ''),
    queryFn: () => chatApi.message(messageId as string),
    enabled: Boolean(messageId),
  });
}

export function useReplies(messageId: string | null | undefined) {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  return useQuery<ChatMessage[]>({
    queryKey: chatKeys.replies(messageId ?? ''),
    queryFn: async () => {
      const items = await chatApi.replies(messageId as string);
      return items.map((m) => ({ ...m, reactions: withMyReactions(m.reactions, myId) }));
    },
    enabled: Boolean(messageId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface SendMessageVars {
  clientId: string;
  body: string;
  mentions?: string[];
  attachmentIds?: string[];
  parentMessageId?: string;
  /** Already-uploaded files, used to render the optimistic message. */
  attachments?: FileDto[];
}

/**
 * Optimistic send: a pending message keyed by `clientId` is inserted immediately and replaced by the
 * server message (from the REST response or the `message:new` echo, whichever comes first).
 */
export function useSendMessage(channelId: string) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation<MessageDto, Error, SendMessageVars>({
    mutationFn: ({ clientId, body, mentions, attachmentIds, parentMessageId }) =>
      chatApi.send(channelId, {
        body,
        clientId,
        mentions: mentions && mentions.length > 0 ? mentions : undefined,
        attachmentIds: attachmentIds && attachmentIds.length > 0 ? attachmentIds : undefined,
        parentMessageId,
      }),
    onMutate: (vars) => {
      if (!user) return;
      const optimistic: ChatMessage = {
        id: `pending:${vars.clientId}`,
        channelId,
        workspaceId: findChannelInCache(queryClient, channelId)?.workspaceId ?? '',
        author: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          title: user.title,
          availability: user.availability,
        },
        externalAuthor: null,
        body: vars.body,
        mentions: vars.mentions ?? [],
        attachments: vars.attachments ?? [],
        parentMessageId: vars.parentMessageId ?? null,
        replyCount: 0,
        lastReplyAt: null,
        reactions: [],
        source: 'nexus',
        clientId: vars.clientId,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      upsertMessage(queryClient, optimistic);
    },
    onSuccess: (message, vars) => {
      const result = upsertMessage(queryClient, { ...message, reactions: withMyReactions(message.reactions, user?.id ?? null) });
      if (message.parentMessageId && (result === 'inserted' || result === 'replaced-pending')) {
        patchMessage(
          queryClient,
          { channelId, messageId: message.parentMessageId },
          (parent) => ({ ...parent, replyCount: parent.replyCount + 1, lastReplyAt: message.createdAt }),
        );
      }
      bumpChannelPreview(queryClient, message);
      setChannelUnread(queryClient, channelId, 0, message.createdAt);
      void vars;
    },
    onError: (error, vars) => {
      patchMessage(
        queryClient,
        { channelId, messageId: `pending:${vars.clientId}`, parentMessageId: vars.parentMessageId, clientId: vars.clientId },
        { pending: false, failed: true },
      );
      toast.error(getErrorMessage(error, 'Message not sent'));
    },
  });
}

export function useEditMessage() {
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) => chatApi.edit(messageId, body),
    onSuccess: (message) => upsertMessage(queryClient, { ...message, reactions: withMyReactions(message.reactions, myId) }),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: Pick<MessageDto, 'id' | 'channelId' | 'parentMessageId'>) => chatApi.remove(message.id),
    onSuccess: (deleted, message) => {
      const dto = deleted ?? { deletedAt: new Date().toISOString(), body: '', attachments: [] };
      patchMessage(queryClient, { channelId: message.channelId, messageId: message.id, parentMessageId: message.parentMessageId }, {
        deletedAt: dto.deletedAt,
        body: '',
        attachments: [],
      });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

interface ReactionVars {
  message: Pick<MessageDto, 'id' | 'channelId' | 'parentMessageId' | 'reactions'>;
  emoji: string;
}

export function useToggleReaction() {
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation<MessageDto, Error, ReactionVars, { previous: ReactionDto[] }>({
    mutationFn: ({ message, emoji }) => chatApi.react(message.id, emoji),
    onMutate: ({ message, emoji }) => {
      const previous = message.reactions;
      if (myId) {
        patchMessageAnywhere(queryClient, { channelId: message.channelId, messageId: message.id }, {
          reactions: toggleReactionLocally(previous, emoji, myId),
        });
      }
      return { previous };
    },
    onError: (error, { message }, context) => {
      if (context) {
        patchMessageAnywhere(queryClient, { channelId: message.channelId, messageId: message.id }, { reactions: context.previous });
      }
      toast.error(getErrorMessage(error));
    },
    onSuccess: (updated, { message }) => {
      patchMessageAnywhere(queryClient, { channelId: message.channelId, messageId: message.id }, {
        reactions: withMyReactions(updated.reactions, myId),
      });
    },
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, messageId }: { channelId: string; messageId?: string }) => chatApi.markRead(channelId, messageId),
    onSuccess: (state, vars) => setChannelUnread(queryClient, vars.channelId, state?.unreadCount ?? 0, state?.lastReadAt ?? new Date().toISOString()),
  });
}

export function useMuteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelId, muted }: { channelId: string; muted: boolean }) => chatApi.mute(channelId, muted),
    onMutate: ({ channelId, muted }) => patchChannel(queryClient, channelId, { muted }),
    onSuccess: (state, { channelId }) => {
      if (state) patchChannel(queryClient, channelId, { muted: state.muted });
    },
    onError: (error, { channelId, muted }) => {
      patchChannel(queryClient, channelId, { muted: !muted });
      toast.error(getErrorMessage(error));
    },
  });
}

export function useUploadAttachment(workspaceId: string) {
  return useMutation({
    mutationFn: ({ file, channelId, onProgress }: { file: File; channelId: string; onProgress?: (f: number) => void }) =>
      chatApi.uploadAttachment(workspaceId, file, { channelId }, onProgress),
  });
}

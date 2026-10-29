import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiConversationDetailDto,
  AiMessageDto,
  AiSourceDto,
  AiToolCallDto,
  CommitGeneratedTasksInput,
  CreateConversationInput,
  GenerateTasksInput,
} from '@nexus/shared';
import { taskKeys } from '@/features/tasks/hooks';
import { getErrorMessage } from '@/lib/api';
import { aiApi, type ConversationFilters } from './api';
import { streamAssistantMessage } from './stream';

export const aiKeys = {
  all: ['ai'] as const,
  status: () => [...aiKeys.all, 'status'] as const,
  conversations: (workspaceId: string) => [...aiKeys.all, 'conversations', workspaceId] as const,
  conversationList: (workspaceId: string, filters: ConversationFilters) =>
    [...aiKeys.conversations(workspaceId), filters] as const,
  conversation: (id: string) => [...aiKeys.all, 'conversation', id] as const,
  summary: (documentId: string, version: number, length: string) =>
    [...aiKeys.all, 'summary', documentId, version, length] as const,
  insights: (projectId: string) => [...aiKeys.all, 'insights', projectId] as const,
  usage: (workspaceId: string, days: number) =>
    [...aiKeys.all, 'usage', workspaceId, days] as const,
  digest: (workspaceId: string, days: number) =>
    [...aiKeys.all, 'digest', workspaceId, days] as const,
};

export function useAiStatus() {
  return useQuery({ queryKey: aiKeys.status(), queryFn: aiApi.status, staleTime: 5 * 60_000 });
}

/** True once status has loaded and AI is configured on the server. */
export function useAiEnabled(): boolean {
  return useAiStatus().data?.enabled ?? false;
}

export function useConversations(
  workspaceId: string | undefined,
  filters: ConversationFilters = {},
) {
  return useQuery({
    queryKey: aiKeys.conversationList(workspaceId ?? '', filters),
    queryFn: () => aiApi.conversations(workspaceId as string, filters),
    enabled: Boolean(workspaceId),
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: () => aiApi.conversation(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateConversation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreateConversationInput>) =>
      aiApi.createConversation(workspaceId, input),
    onSuccess: (conversation) => {
      queryClient.setQueryData<AiConversationDetailDto>(aiKeys.conversation(conversation.id), {
        ...conversation,
        messages: [],
      });
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) });
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      aiApi.renameConversation(id, title),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: aiKeys.all }),
  });
}

export function useDeleteConversation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => aiApi.deleteConversation(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: aiKeys.conversation(id) });
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) });
    },
  });
}

/** The assistant reply while it streams in. */
export interface StreamingReply {
  text: string;
  toolCalls: AiToolCallDto[];
  sources: AiSourceDto[];
}

/**
 * Chat state for one conversation: persisted messages come from the detail query; the reply in
 * flight lives in `streaming` until the `done` event appends it to the cache.
 */
export function useAssistantChat(conversationId: string | undefined, workspaceId: string) {
  const queryClient = useQueryClient();
  const detail = useConversation(conversationId);
  const [streaming, setStreaming] = useState<StreamingReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Conversation the in-flight stream belongs to. */
  const targetRef = useRef<string | null>(null);

  // Switching to another conversation stops the stream; adopting the conversation the stream
  // just created (undefined → its id) does not.
  useEffect(() => {
    if (abortRef.current && targetRef.current !== conversationId) {
      abortRef.current.abort();
      abortRef.current = null;
      setStreaming(null);
    }
    setError(null);
  }, [conversationId]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const append = useCallback(
    (id: string, message: AiMessageDto) => {
      queryClient.setQueryData<AiConversationDetailDto>(aiKeys.conversation(id), (old) =>
        old && !old.messages.some((m) => m.id === message.id)
          ? { ...old, messages: [...old.messages, message] }
          : old,
      );
    },
    [queryClient],
  );

  const send = useCallback(
    async (content: string, targetId = conversationId) => {
      if (!targetId) return;
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      targetRef.current = targetId;
      setError(null);
      setStreaming({ text: '', toolCalls: [], sources: [] });
      try {
        await streamAssistantMessage(
          targetId,
          content,
          (event) => {
            switch (event.type) {
              case 'user_message':
                append(targetId, event.message);
                break;
              case 'tool_call':
                setStreaming((s) =>
                  s ? { ...s, toolCalls: [...s.toolCalls, event.toolCall] } : s,
                );
                break;
              case 'text_delta':
                setStreaming((s) => (s ? { ...s, text: s.text + event.text } : s));
                break;
              case 'sources':
                setStreaming((s) => (s ? { ...s, sources: event.sources } : s));
                break;
              case 'done':
                append(targetId, event.message);
                setStreaming(null);
                break;
              case 'error':
                setError(event.message);
                setStreaming(null);
                break;
            }
          },
          abort.signal,
        );
      } catch (err) {
        if (!abort.signal.aborted) setError(getErrorMessage(err, 'The assistant could not answer'));
      } finally {
        if (abortRef.current === abort) {
          setStreaming(null);
          abortRef.current = null;
          targetRef.current = null;
          void queryClient.invalidateQueries({ queryKey: aiKeys.conversations(workspaceId) });
        }
      }
    },
    [append, conversationId, queryClient, workspaceId],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(null);
    if (conversationId)
      void queryClient.invalidateQueries({ queryKey: aiKeys.conversation(conversationId) });
  }, [conversationId, queryClient]);

  return {
    messages: detail.data?.messages ?? [],
    conversation: detail.data,
    isLoading: detail.isLoading,
    streaming,
    isStreaming: streaming !== null,
    error,
    send,
    stop,
  };
}

// ---------- generation & insights ----------

export function useGenerateTasks(projectId: string) {
  return useMutation({
    mutationFn: (input: Partial<GenerateTasksInput>) => aiApi.generateTasks(projectId, input),
  });
}

export function useCommitTasks(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CommitGeneratedTasksInput) => aiApi.commitTasks(projectId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.lists(projectId) });
      void queryClient.invalidateQueries({ queryKey: aiKeys.insights(projectId) });
    },
  });
}

export function useSummarizeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      documentId,
      length,
    }: {
      documentId: string;
      version: number;
      length: 'short' | 'detailed';
    }) => aiApi.summarize(documentId, length),
    onSuccess: (data, vars) =>
      queryClient.setQueryData(aiKeys.summary(vars.documentId, vars.version, vars.length), data),
  });
}

export function useProjectInsights(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: aiKeys.insights(projectId ?? ''),
    queryFn: () => aiApi.insights(projectId as string),
    enabled: Boolean(projectId) && enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRefreshInsights(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => aiApi.insights(projectId, true),
    onSuccess: (data) => queryClient.setQueryData(aiKeys.insights(projectId), data),
  });
}

export function useWorkspaceDigest(workspaceId: string | undefined, days = 7, enabled = true) {
  return useQuery({
    queryKey: aiKeys.digest(workspaceId ?? '', days),
    queryFn: () => aiApi.digest(workspaceId as string, days),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });
}

export function useAiUsage(workspaceId: string | undefined, days = 30, enabled = true) {
  return useQuery({
    queryKey: aiKeys.usage(workspaceId ?? '', days),
    queryFn: () => aiApi.usage(workspaceId as string, days),
    enabled: Boolean(workspaceId) && enabled,
  });
}

export function useReindexWorkspace(workspaceId: string) {
  return useMutation({ mutationFn: () => aiApi.reindex(workspaceId) });
}

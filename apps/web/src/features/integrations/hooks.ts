import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IntegrationsOverviewDto, SlackIntegrationDto, SyncSlackChannelsInput, UpdateSlackIntegrationInput } from '@nexus/shared';
import { integrationsApi } from './api';

export const integrationKeys = {
  all: ['integrations'] as const,
  overview: (workspaceId: string) => [...integrationKeys.all, 'overview', workspaceId] as const,
  slackChannels: (workspaceId: string) => [...integrationKeys.all, 'slack-channels', workspaceId] as const,
};

export function useIntegrations(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.overview(workspaceId ?? ''),
    queryFn: () => integrationsApi.overview(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
  });
}

type QC = ReturnType<typeof useQueryClient>;

function setSlack(queryClient: QC, workspaceId: string, slack: SlackIntegrationDto | null): void {
  queryClient.setQueryData<IntegrationsOverviewDto>(integrationKeys.overview(workspaceId), (old) =>
    old ? { ...old, slack } : old,
  );
  void queryClient.invalidateQueries({ queryKey: integrationKeys.slackChannels(workspaceId) });
  // Mirrored chat channels change on sync/unsync/disconnect.
  void queryClient.invalidateQueries({ queryKey: ['chat'] });
}

export function useUpdateSlack(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSlackIntegrationInput) => integrationsApi.updateSlack(workspaceId, input),
    onSuccess: (slack) => setSlack(queryClient, workspaceId, slack),
  });
}

export function useDisconnectSlack(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => integrationsApi.disconnectSlack(workspaceId),
    onSuccess: () => {
      setSlack(queryClient, workspaceId, null);
      void queryClient.invalidateQueries({ queryKey: integrationKeys.overview(workspaceId) });
    },
  });
}

export function useSlackChannels(workspaceId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: integrationKeys.slackChannels(workspaceId ?? ''),
    queryFn: () => integrationsApi.slackChannels(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
  });
}

export function useSyncSlackChannels(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SyncSlackChannelsInput) => integrationsApi.syncChannels(workspaceId, input),
    onSuccess: (slack) => setSlack(queryClient, workspaceId, slack),
  });
}

export function useUnsyncSlackChannel(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slackChannelId: string) => integrationsApi.unsyncChannel(workspaceId, slackChannelId),
    onSuccess: (slack) => setSlack(queryClient, workspaceId, slack),
  });
}

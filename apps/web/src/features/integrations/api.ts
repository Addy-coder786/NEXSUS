import type {
  IntegrationsOverviewDto,
  SlackChannelOption,
  SlackIntegrationDto,
  SyncSlackChannelsInput,
  UpdateSlackIntegrationInput,
} from '@nexus/shared';
import { api, API_BASE } from '@/lib/api';

/** Full-page navigation target: the API redirects to Slack's authorize screen. */
export function slackInstallUrl(workspaceId: string): string {
  return `${API_BASE}/workspaces/${workspaceId}/integrations/slack/install`;
}

export const integrationsApi = {
  overview: (workspaceId: string) => api.get<IntegrationsOverviewDto>(`/workspaces/${workspaceId}/integrations`),
  updateSlack: (workspaceId: string, input: UpdateSlackIntegrationInput) =>
    api.patch<SlackIntegrationDto>(`/workspaces/${workspaceId}/integrations/slack`, input),
  disconnectSlack: (workspaceId: string) => api.delete(`/workspaces/${workspaceId}/integrations/slack`),
  slackChannels: (workspaceId: string) =>
    api.get<SlackChannelOption[]>(`/workspaces/${workspaceId}/integrations/slack/channels`),
  syncChannels: (workspaceId: string, input: SyncSlackChannelsInput) =>
    api.post<SlackIntegrationDto>(`/workspaces/${workspaceId}/integrations/slack/sync`, input),
  unsyncChannel: (workspaceId: string, slackChannelId: string) =>
    api.post<SlackIntegrationDto>(`/workspaces/${workspaceId}/integrations/slack/unsync`, { slackChannelId }),
};

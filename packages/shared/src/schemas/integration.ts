import { z } from 'zod';
import { NOTIFICATION_TYPES, type IntegrationProvider, type NotificationType } from '../constants';

export const updateSlackIntegrationSchema = z.object({
  /** Slack channel id (e.g. C0123) that receives workspace notifications; null disables. */
  notificationChannelId: z.string().max(32).nullable().optional(),
  notificationChannelName: z.string().max(80).nullable().optional(),
  notifyOn: z.array(z.enum(NOTIFICATION_TYPES)).optional(),
});
export const syncSlackChannelsSchema = z.object({
  channels: z.array(z.object({ id: z.string().min(1).max(32), name: z.string().min(1).max(80) })).min(1).max(20),
});
export const unsyncSlackChannelSchema = z.object({ slackChannelId: z.string().min(1).max(32) });

export type UpdateSlackIntegrationInput = z.infer<typeof updateSlackIntegrationSchema>;
export type SyncSlackChannelsInput = z.infer<typeof syncSlackChannelsSchema>;

export interface SlackSyncedChannelDto {
  slackChannelId: string;
  slackChannelName: string;
  channelId: string;
  lastSyncedAt: string | null;
  messageCount: number;
}

export interface SlackIntegrationDto {
  id: string;
  provider: 'slack';
  workspaceId: string;
  teamId: string;
  teamName: string;
  teamIconUrl: string | null;
  installedBy: string;
  notificationChannelId: string | null;
  notificationChannelName: string | null;
  notifyOn: NotificationType[];
  syncedChannels: SlackSyncedChannelDto[];
  status: 'ACTIVE' | 'REVOKED' | 'ERROR';
  lastError: string | null;
  createdAt: string;
}

export interface SlackChannelOption {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount: number;
  alreadySynced: boolean;
}

export interface IntegrationsOverviewDto {
  available: Record<IntegrationProvider, boolean>;
  slack: SlackIntegrationDto | null;
}

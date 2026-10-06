import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationsOverviewDto, SlackIntegrationDto } from '@nexus/shared';
import { SlackIntegrationCard } from './SlackIntegrationCard';
import { renderWithProviders } from '@/test/utils';

let overview: IntegrationsOverviewDto = { available: { slack: true }, slack: null };

vi.mock('../hooks', () => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    useIntegrations: () => ({ data: overview, isPending: false, isError: false, error: null }),
    useSlackChannels: () => ({
      data: [{ id: 'C1', name: 'general', isPrivate: false, memberCount: 12, alreadySynced: false }],
      isPending: false,
      isError: false,
      error: null,
    }),
    useUpdateSlack: mutation,
    useDisconnectSlack: mutation,
    useSyncSlackChannels: mutation,
    useUnsyncSlackChannel: mutation,
  };
});

const connected: SlackIntegrationDto = {
  id: 'i1',
  provider: 'slack',
  workspaceId: 'ws1',
  teamId: 'T1',
  teamName: 'Acme Corp',
  teamIconUrl: null,
  installedBy: 'u1',
  notificationChannelId: 'C1',
  notificationChannelName: 'general',
  notifyOn: ['TASK_ASSIGNED', 'MENTION'],
  syncedChannels: [
    { slackChannelId: 'C2', slackChannelName: 'engineering', channelId: 'ch2', lastSyncedAt: new Date().toISOString(), messageCount: 120 },
    { slackChannelId: 'C3', slackChannelName: 'design', channelId: 'ch3', lastSyncedAt: null, messageCount: 0 },
  ],
  status: 'ACTIVE',
  lastError: null,
  createdAt: new Date().toISOString(),
};

describe('SlackIntegrationCard', () => {
  beforeEach(() => {
    overview = { available: { slack: true }, slack: null };
  });

  it('links to the install route when disconnected', () => {
    renderWithProviders(<SlackIntegrationCard workspaceId="ws1" />, { route: '/w/ws1/settings?tab=integrations' });
    const link = screen.getByRole('link', { name: /add to slack/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/workspaces/ws1/integrations/slack/install'));
    expect(screen.queryByText(/not configured/i)).not.toBeInTheDocument();
  });

  it('explains when Slack is not configured on the server', () => {
    overview = { available: { slack: false }, slack: null };
    renderWithProviders(<SlackIntegrationCard workspaceId="ws1" />);
    expect(screen.getByRole('note')).toHaveTextContent(/not configured on this server/i);
    expect(screen.queryByRole('link', { name: /add to slack/i })).not.toBeInTheDocument();
  });

  it('shows team, notification settings and synced channels when connected', () => {
    overview = { available: { slack: true }, slack: connected };
    renderWithProviders(<SlackIntegrationCard workspaceId="ws1" />);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    const synced = screen.getByRole('list', { name: /synced channels/i });
    expect(within(synced).getAllByRole('listitem')).toHaveLength(2);
    expect(within(synced).getByText('engineering')).toBeInTheDocument();
    expect(within(synced).getAllByRole('button', { name: 'Unsync' })).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Task assigned' })).toHaveAttribute('data-state', 'checked');
    expect(screen.getByRole('checkbox', { name: 'Task overdue' })).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });
});

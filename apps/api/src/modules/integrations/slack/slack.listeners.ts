import { features } from '../../../config/env';
import { events } from '../../../events';
import { enqueue } from '../../../jobs';
import { Integration } from '../../../models/Integration';
import './slack.jobs';

/**
 * Outbound Slack delivery: when a notification is created in a workspace whose ACTIVE Slack
 * integration has a notification channel and opts into this type, queue a `slack.notify` job.
 * Notifications without a link are never posted.
 */
events.on('notification.created', async ({ notification }) => {
  if (!features.slackIntegration) return;
  if (!notification.link) return;

  const match = await Integration.exists({
    workspaceId: notification.workspaceId,
    provider: 'slack',
    status: 'ACTIVE',
    notificationChannelId: { $ne: null },
    notifyOn: notification.type,
  });
  if (!match) return;

  await enqueue('slack.notify', { notificationId: notification.id }, { jobId: `slack.notify:${notification.id}` });
});

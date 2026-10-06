import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { defineJob } from '../../../jobs';
import { Integration } from '../../../models/Integration';
import { Notification } from '../../../models/Notification';
import * as slack from './slack.client';
import { importSlackMessage, isImportableMessage, type ImportContext } from './slack.import';
import { findSyncedChannel, tokenOf } from './slack.service';

export interface BackfillResult {
  imported: number;
  lastTs: string | null;
}

/**
 * Imports up to 200 messages newer than the channel's `lastTs` (oldest first). Idempotent thanks to
 * the `(channelId, slackTs)` unique index, so re-running after a crash is safe.
 */
export async function backfillChannel(integrationId: string, slackChannelId: string): Promise<BackfillResult> {
  const integration = await Integration.findById(integrationId).select('+accessTokenEnc').lean();
  if (!integration || integration.status !== 'ACTIVE') return { imported: 0, lastTs: null };
  const synced = await findSyncedChannel(integration, slackChannelId);
  if (!synced) return { imported: 0, lastTs: null };

  const ctx: ImportContext = { integration, token: tokenOf(integration), channel: synced.channel };
  let messages: slack.SlackMessage[];
  try {
    messages = await slack.conversationsHistory(ctx.token, slackChannelId, { oldest: synced.entry.lastTs, limit: 200 });
  } catch (err) {
    const code = err instanceof slack.SlackApiError ? err.code : 'unknown_error';
    await Integration.updateOne({ _id: integration._id }, { $set: { lastError: code } });
    throw err;
  }

  // Slack returns newest first; import oldest → newest so thread parents exist before replies.
  const ordered = [...messages].filter((m) => m.ts).sort((a, b) => Number(a.ts) - Number(b.ts));
  let imported = 0;
  let lastTs = synced.entry.lastTs;
  for (const msg of ordered) {
    if (isImportableMessage(ctx, msg) && (await importSlackMessage(ctx, msg))) imported += 1;
    if (msg.ts && (!lastTs || Number(msg.ts) > Number(lastTs))) lastTs = msg.ts;
  }

  await Integration.updateOne(
    { _id: integration._id, 'syncedChannels.slackChannelId': slackChannelId },
    { $set: { 'syncedChannels.$.lastSyncedAt': new Date(), 'syncedChannels.$.lastTs': lastTs, lastError: null } },
  );
  return { imported, lastTs };
}

defineJob('slack.backfill', async ({ integrationId, slackChannelId }) => {
  const result = await backfillChannel(integrationId, slackChannelId);
  logger.info({ integrationId, slackChannelId, ...result }, 'Slack backfill finished');
});

// ---------- outbound notifications ----------

export function buildNotificationBlocks(title: string, body: string | null, url: string): unknown[] {
  const text = body ? `*${title}*\n${body}` : `*${title}*`;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 3000) } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in NEXUS', emoji: true },
          url,
          action_id: 'open_in_nexus',
        },
      ],
    },
  ];
}

/** Posts the notification to the workspace's Slack notification channel (once). */
export async function notifySlack(notificationId: string): Promise<boolean> {
  const notification = await Notification.findById(notificationId).lean();
  if (!notification || notification.slackedAt || !notification.link) return false;

  const integration = await Integration.findOne({
    workspaceId: notification.workspaceId,
    provider: 'slack',
    status: 'ACTIVE',
    notificationChannelId: { $ne: null },
    notifyOn: notification.type,
  })
    .select('+accessTokenEnc')
    .lean();
  if (!integration?.notificationChannelId) return false;

  const url = `${env.CLIENT_URL}${notification.link}`;
  try {
    await slack.chatPostMessage(tokenOf(integration), {
      channel: integration.notificationChannelId,
      text: notification.body ? `${notification.title} — ${notification.body}` : notification.title,
      blocks: buildNotificationBlocks(notification.title, notification.body, url),
    });
  } catch (err) {
    const code = err instanceof slack.SlackApiError ? err.code : 'unknown_error';
    await Integration.updateOne({ _id: integration._id }, { $set: { lastError: code } });
    throw err;
  }

  await Notification.updateOne({ _id: notification._id }, { $set: { slackedAt: new Date() } });
  return true;
}

defineJob('slack.notify', async ({ notificationId }) => {
  await notifySlack(notificationId);
});

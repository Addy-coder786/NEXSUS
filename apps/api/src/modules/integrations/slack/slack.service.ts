import { Types } from 'mongoose';
import type {
  IntegrationsOverviewDto,
  SlackChannelOption,
  SlackIntegrationDto,
  SyncSlackChannelsInput,
  UpdateSlackIntegrationInput,
} from '@nexus/shared';
import { env, features } from '../../../config/env';
import { logger } from '../../../config/logger';
import { cache } from '../../../config/redis';
import { events } from '../../../events';
import { enqueue } from '../../../jobs';
import { Channel } from '../../../models/Channel';
import { Integration } from '../../../models/Integration';
import { Message } from '../../../models/Message';
import { WorkspaceMember } from '../../../models/WorkspaceMember';
import { recordActivity } from '../../../services/activity.service';
import { ApiError } from '../../../utils/ApiError';
import { randomToken } from '../../../utils/crypto';
import { decrypt, encrypt } from '../../../utils/encryption';
import * as slack from './slack.client';
import { toMirroredChannelDto, toSlackIntegrationDto, type ChannelLean, type IntegrationLean } from './slack.dto';

export const SLACK_BOT_SCOPES = 'channels:read,channels:history,groups:read,chat:write,users:read,users:read.email,team:read';
const STATE_TTL_SEC = 10 * 60;
const stateKey = (state: string) => `slack:oauth:${state}`;

export function slackRedirectUri(): string {
  return `${env.API_URL}/api/integrations/slack/callback`;
}

function settingsUrl(workspaceId: string, result: 'connected' | 'error'): string {
  return `${env.CLIENT_URL}/w/${workspaceId}/settings?tab=integrations&slack=${result}`;
}

function assertEnabled(): void {
  if (!features.slackIntegration) throw ApiError.notFound('Slack integration is not available');
}

// ---------- loading ----------

export async function findIntegration(workspaceId: string, withToken = false): Promise<IntegrationLean | null> {
  const query = Integration.findOne({ workspaceId, provider: 'slack' });
  if (withToken) query.select('+accessTokenEnc');
  return query.lean();
}

async function requireIntegration(workspaceId: string, withToken = false): Promise<IntegrationLean> {
  const integration = await findIntegration(workspaceId, withToken);
  if (!integration) throw ApiError.notFound('Slack integration');
  return integration;
}

export function tokenOf(integration: IntegrationLean): string {
  if (!integration.accessTokenEnc) throw ApiError.internal('Integration token not loaded');
  return decrypt(integration.accessTokenEnc);
}

/** All ACTIVE installs of a Slack team (several NEXUS workspaces may connect the same team). */
export async function findIntegrationsByTeam(teamId: string): Promise<IntegrationLean[]> {
  return Integration.find({ provider: 'slack', externalId: teamId, status: 'ACTIVE' }).select('+accessTokenEnc').lean();
}

async function markError(integration: IntegrationLean, err: unknown): Promise<void> {
  const code = err instanceof slack.SlackApiError ? err.code : 'unknown_error';
  const revoked = ['invalid_auth', 'token_revoked', 'account_inactive', 'not_authed'].includes(code);
  await Integration.updateOne(
    { _id: integration._id },
    { $set: { lastError: code, ...(revoked ? { status: 'REVOKED' } : {}) } },
  );
}

// ---------- DTOs ----------

export async function buildIntegrationDto(integration: IntegrationLean): Promise<SlackIntegrationDto> {
  const channelIds = integration.syncedChannels.map((c) => c.channelId);
  const channels = channelIds.length ? await Channel.find({ _id: { $in: channelIds } }).select('messageCount').lean() : [];
  const counts = new Map(channels.map((c) => [String(c._id), c.messageCount]));
  return toSlackIntegrationDto(integration, counts);
}

export async function getOverview(workspaceId: string): Promise<IntegrationsOverviewDto> {
  const integration = features.slackIntegration ? await findIntegration(workspaceId) : null;
  return {
    available: { slack: features.slackIntegration },
    slack: integration ? await buildIntegrationDto(integration) : null,
  };
}

// ---------- OAuth install ----------

export async function createInstallUrl(workspaceId: string, userId: string): Promise<string> {
  assertEnabled();
  const state = randomToken(24);
  await cache.set(stateKey(state), { workspaceId, userId }, STATE_TTL_SEC);
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID ?? '',
    scope: SLACK_BOT_SCOPES,
    redirect_uri: slackRedirectUri(),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface CallbackResult {
  redirectTo: string;
}

/** Exchanges the OAuth code, stores the encrypted bot token and returns where to send the browser. */
export async function completeInstall(code: string | undefined, state: string | undefined): Promise<CallbackResult> {
  if (!features.slackIntegration || !state) return { redirectTo: `${env.CLIENT_URL}/?slack=error` };
  const pending = await cache.get<{ workspaceId: string; userId: string }>(stateKey(state));
  if (!pending) return { redirectTo: `${env.CLIENT_URL}/?slack=error` };
  await cache.del(stateKey(state));

  if (!code) return { redirectTo: settingsUrl(pending.workspaceId, 'error') };

  try {
    const access = await slack.oauthAccess(code, slackRedirectUri());
    let iconUrl: string | null = null;
    try {
      const team = await slack.teamInfo(access.access_token);
      iconUrl = team.icon?.image_88 ?? team.icon?.image_132 ?? null;
    } catch (err) {
      logger.warn({ err }, 'Slack team.info failed');
    }

    await Integration.findOneAndUpdate(
      { workspaceId: pending.workspaceId, provider: 'slack' },
      {
        $set: {
          externalId: access.team.id,
          externalName: access.team.name,
          externalIconUrl: iconUrl,
          accessTokenEnc: encrypt(access.access_token),
          botUserId: access.bot_user_id ?? null,
          scopes: access.scope ? access.scope.split(',') : [],
          installedBy: new Types.ObjectId(pending.userId),
          status: 'ACTIVE',
          lastError: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await recordActivity({
      workspaceId: pending.workspaceId,
      actorId: pending.userId,
      type: 'INTEGRATION_CONNECTED',
      metadata: { provider: 'slack', teamId: access.team.id, teamName: access.team.name },
    });
    return { redirectTo: settingsUrl(pending.workspaceId, 'connected') };
  } catch (err) {
    logger.error({ err }, 'Slack OAuth callback failed');
    return { redirectTo: settingsUrl(pending.workspaceId, 'error') };
  }
}

// ---------- settings ----------

export async function updateSettings(workspaceId: string, input: UpdateSlackIntegrationInput): Promise<SlackIntegrationDto> {
  assertEnabled();
  const integration = await requireIntegration(workspaceId);
  const $set: Record<string, unknown> = {};
  if (input.notificationChannelId !== undefined) {
    $set.notificationChannelId = input.notificationChannelId;
    if (input.notificationChannelId === null) $set.notificationChannelName = null;
  }
  if (input.notificationChannelName !== undefined) $set.notificationChannelName = input.notificationChannelName;
  if (input.notifyOn !== undefined) $set.notifyOn = [...new Set(input.notifyOn)];

  const updated = Object.keys($set).length
    ? await Integration.findOneAndUpdate({ _id: integration._id }, { $set }, { new: true }).lean()
    : integration;
  return buildIntegrationDto(updated ?? integration);
}

export async function disconnect(workspaceId: string, actorId: string): Promise<void> {
  assertEnabled();
  const integration = await requireIntegration(workspaceId, true);
  try {
    await slack.authRevoke(tokenOf(integration));
  } catch (err) {
    logger.warn({ err }, 'Slack auth.revoke failed (ignored)');
  }

  const mirrored = integration.syncedChannels.map((c) => c.channelId);
  await Promise.all([
    Integration.deleteOne({ _id: integration._id }),
    mirrored.length ? Channel.updateMany({ _id: { $in: mirrored } }, { $set: { isArchived: true } }) : Promise.resolve(),
  ]);

  await recordActivity({
    workspaceId,
    actorId,
    type: 'INTEGRATION_DISCONNECTED',
    metadata: { provider: 'slack', teamId: integration.externalId, teamName: integration.externalName },
  });
}

// ---------- channels ----------

export async function listSlackChannels(workspaceId: string): Promise<SlackChannelOption[]> {
  assertEnabled();
  const integration = await requireIntegration(workspaceId, true);
  const synced = new Set(integration.syncedChannels.map((c) => c.slackChannelId));
  try {
    const channels = await slack.conversationsList(tokenOf(integration));
    return channels
      .filter((c) => !c.is_archived)
      .map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: Boolean(c.is_private),
        memberCount: c.num_members ?? 0,
        alreadySynced: synced.has(c.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    await markError(integration, err);
    throw ApiError.badRequest(err instanceof slack.SlackApiError ? `Slack error: ${err.code}` : 'Slack request failed');
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
}

async function uniqueSlug(workspaceId: Types.ObjectId, base: string, keepId?: Types.ObjectId): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await Channel.exists({ workspaceId, slug: candidate, ...(keepId ? { _id: { $ne: keepId } } : {}) })) {
    candidate = `${base.slice(0, 36)}-${n}`;
    n += 1;
  }
  return candidate;
}

async function ensureMirroredChannel(
  integration: IntegrationLean,
  actorId: string,
  slackChannel: { id: string; name: string },
): Promise<ChannelLean> {
  const name = slackChannel.name.slice(0, 60);
  const existing = await Channel.findOne({ workspaceId: integration.workspaceId, 'slack.channelId': slackChannel.id }).lean();
  if (existing) {
    const updated = await Channel.findOneAndUpdate(
      { _id: existing._id },
      { $set: { isArchived: false, isReadOnly: true, name, 'slack.teamId': integration.externalId } },
      { new: true },
    ).lean();
    return updated ?? existing;
  }

  const slug = await uniqueSlug(integration.workspaceId, `slack-${slugify(name) || slackChannel.id.toLowerCase()}`);
  const created = await Channel.create({
    workspaceId: integration.workspaceId,
    projectId: null,
    type: 'PUBLIC',
    name,
    slug,
    description: `Mirrored from Slack #${slackChannel.name}`,
    memberIds: [],
    createdBy: new Types.ObjectId(actorId),
    isReadOnly: true,
    source: 'slack',
    slack: { teamId: integration.externalId, channelId: slackChannel.id, lastSyncedAt: null },
  });
  const channel = created.toObject();
  const memberCount = await WorkspaceMember.countDocuments({ workspaceId: integration.workspaceId });
  events.emit('channel.created', { channel: toMirroredChannelDto(channel, memberCount), actorId });
  await recordActivity({
    workspaceId: integration.workspaceId,
    actorId,
    type: 'CHANNEL_CREATED',
    metadata: { channelId: String(channel._id), name, source: 'slack', slackChannelId: slackChannel.id },
  });
  return channel;
}

export async function syncChannels(workspaceId: string, actorId: string, input: SyncSlackChannelsInput): Promise<SlackIntegrationDto> {
  assertEnabled();
  const integration = await requireIntegration(workspaceId, true);
  const token = tokenOf(integration);
  const already = new Set(integration.syncedChannels.map((c) => c.slackChannelId));
  const newlySynced: string[] = [];

  for (const entry of input.channels) {
    if (already.has(entry.id)) continue;
    try {
      await slack.conversationsJoin(token, entry.id);
    } catch (err) {
      // Private channels cannot be joined via API; the bot must already be invited.
      const code = err instanceof slack.SlackApiError ? err.code : 'unknown_error';
      if (!['method_not_supported_for_channel_type', 'already_in_channel', 'is_archived'].includes(code)) {
        await markError(integration, err);
        throw ApiError.badRequest(`Could not join Slack channel #${entry.name}: ${code}`);
      }
    }

    const channel = await ensureMirroredChannel(integration, actorId, entry);
    await Integration.updateOne(
      { _id: integration._id, 'syncedChannels.slackChannelId': { $ne: entry.id } },
      {
        $push: {
          syncedChannels: {
            slackChannelId: entry.id,
            slackChannelName: entry.name,
            channelId: channel._id,
            lastSyncedAt: null,
            lastTs: null,
          },
        },
      },
    );
    already.add(entry.id);
    newlySynced.push(entry.id);
  }

  for (const slackChannelId of newlySynced) {
    await enqueue('slack.backfill', { integrationId: String(integration._id), slackChannelId }, { jobId: `slack.backfill:${String(integration._id)}:${slackChannelId}` });
  }
  return buildIntegrationDto(await requireIntegration(workspaceId));
}

export async function unsyncChannel(workspaceId: string, slackChannelId: string): Promise<SlackIntegrationDto> {
  assertEnabled();
  const integration = await requireIntegration(workspaceId);
  const entry = integration.syncedChannels.find((c) => c.slackChannelId === slackChannelId);
  if (!entry) throw ApiError.notFound('Synced channel');

  await Promise.all([
    Integration.updateOne({ _id: integration._id }, { $pull: { syncedChannels: { slackChannelId } } }),
    Channel.updateOne({ _id: entry.channelId }, { $set: { isArchived: true } }),
  ]);
  return buildIntegrationDto(await requireIntegration(workspaceId));
}

/** Resolves the synced-channel entry + mirrored channel for a Slack channel id, if any. */
export async function findSyncedChannel(
  integration: IntegrationLean,
  slackChannelId: string,
): Promise<{ entry: IntegrationLean['syncedChannels'][number]; channel: ChannelLean } | null> {
  const entry = integration.syncedChannels.find((c) => c.slackChannelId === slackChannelId);
  if (!entry) return null;
  const channel = await Channel.findById(entry.channelId).lean();
  if (!channel || channel.isArchived) return null;
  return { entry, channel };
}

/** Total imported messages for a mirrored channel (used by tests/diagnostics). */
export async function importedCount(channelId: Types.ObjectId): Promise<number> {
  return Message.countDocuments({ channelId, source: 'slack' });
}

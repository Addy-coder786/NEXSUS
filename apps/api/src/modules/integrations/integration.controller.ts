import type { SyncSlackChannelsInput, UpdateSlackIntegrationInput } from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { noContent, ok } from '../../utils/response';
import * as slackService from './slack/slack.service';

// ---- /workspaces/:id/integrations ----

export const getOverview = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  ok(res, await slackService.getOverview(ws.id));
});

export const installSlack = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  res.redirect(302, await slackService.createInstallUrl(ws.id, user.id));
});

export const updateSlack = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const input: UpdateSlackIntegrationInput = req.body;
  ok(res, await slackService.updateSettings(ws.id, input));
});

export const disconnectSlack = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  await slackService.disconnect(ws.id, user.id);
  noContent(res);
});

export const listSlackChannels = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  ok(res, await slackService.listSlackChannels(ws.id));
});

export const syncSlackChannels = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: SyncSlackChannelsInput = req.body;
  ok(res, await slackService.syncChannels(ws.id, user.id, input));
});

export const unsyncSlackChannel = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const { slackChannelId } = req.body as { slackChannelId: string };
  ok(res, await slackService.unsyncChannel(ws.id, slackChannelId));
});

// ---- /integrations/slack/callback (no auth; state carries identity) ----

export const slackCallback = asyncHandler(async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const { redirectTo } = await slackService.completeInstall(code, state);
  res.redirect(302, redirectTo);
});

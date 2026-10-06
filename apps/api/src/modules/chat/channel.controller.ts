import { z } from 'zod';
import { objectIdSchema, type CreateChannelInput, type UpdateChannelInput } from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as channelService from './channel.service';
import { getChannelContext } from './chat.access';

export const muteSchema = z.object({ muted: z.boolean() });
export const channelMemberParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });

// ---- /workspaces/:id/channels ----

export const listChannels = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await channelService.listChannels(getWorkspaceContext(req).id, user.id));
});

export const createChannel = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: CreateChannelInput = req.body;
  created(res, await channelService.createChannel(getWorkspaceContext(req).id, user.id, input));
});

export const openDm = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { userId } = req.body as { userId: string };
  ok(res, await channelService.openDm(getWorkspaceContext(req).id, user.id, userId));
});

export const workspaceUnread = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await channelService.workspaceUnread(getWorkspaceContext(req).id, user.id));
});

// ---- /channels/:id ----

export const getChannel = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await channelService.buildChannelDto(getChannelContext(req), user.id));
});

export const updateChannel = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: UpdateChannelInput = req.body;
  ok(res, await channelService.updateChannel(getChannelContext(req), user.id, getWorkspaceContext(req).role, input));
});

export const deleteChannel = asyncHandler(async (req, res) => {
  await channelService.deleteChannel(getChannelContext(req));
  noContent(res);
});

export const listMembers = asyncHandler(async (req, res) => {
  ok(res, await channelService.listChannelMembers(getChannelContext(req)));
});

export const addMembers = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { userIds } = req.body as { userIds: string[] };
  ok(res, await channelService.addChannelMembers(getChannelContext(req), user.id, getWorkspaceContext(req).role, userIds));
});

export const removeMember = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { userId } = req.params as { userId: string };
  ok(res, await channelService.removeChannelMember(getChannelContext(req), user.id, getWorkspaceContext(req).role, userId));
});

export const markRead = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { messageId } = req.body as { messageId?: string };
  ok(res, await channelService.markRead(getChannelContext(req), user.id, messageId));
});

export const setMuted = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { muted } = req.body as z.infer<typeof muteSchema>;
  ok(res, await channelService.setMuted(getChannelContext(req), user.id, muted));
});

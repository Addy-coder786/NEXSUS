import { z } from 'zod';
import { messageListQuerySchema, type EditMessageInput, type SendMessageInput } from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, ok } from '../../utils/response';
import { getChannelContext, getMessageContext } from './chat.access';
import * as messageService from './message.service';

export const repliesQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

// ---- /channels/:id/messages ----

export const listMessages = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const query = typedQuery(req, messageListQuerySchema);
  ok(res, await messageService.listMessages(getChannelContext(req), user.id, query));
});

export const sendMessage = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: SendMessageInput = req.body;
  created(res, await messageService.sendMessage(getChannelContext(req), user.id, input));
});

// ---- /messages/:id ----

export const getMessage = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await messageService.getMessage(getMessageContext(req), user.id));
});

export const listReplies = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { limit } = typedQuery(req, repliesQuerySchema);
  ok(res, await messageService.listReplies(getMessageContext(req), user.id, limit));
});

export const editMessage = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: EditMessageInput = req.body;
  ok(res, await messageService.editMessage(getMessageContext(req), user.id, input));
});

export const deleteMessage = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await messageService.deleteMessage(getMessageContext(req), user.id, getWorkspaceContext(req).role));
});

export const toggleReaction = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { emoji } = req.body as { emoji: string };
  ok(res, await messageService.toggleReaction(getMessageContext(req), user.id, emoji));
});

import { z } from 'zod';
import { notificationListQuerySchema, objectIdSchema } from '@nexus/shared';
import { getAuthUser } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { noContent, ok } from '../../utils/response';
import * as notificationService from './notification.service';

export const readAllSchema = z.object({ workspaceId: objectIdSchema.optional() });

export const listNotifications = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const query = typedQuery(req, notificationListQuerySchema);
  const { items, meta } = await notificationService.listNotifications(user.id, query);
  ok(res, items, meta);
});

export const unreadCount = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await notificationService.unreadCount(user.id));
});

export const markRead = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await notificationService.markRead(user.id, req.params.id as string));
});

export const markAllRead = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { workspaceId } = req.body as z.infer<typeof readAllSchema>;
  ok(res, await notificationService.markAllRead(user.id, workspaceId));
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  await notificationService.deleteNotification(user.id, req.params.id as string);
  noContent(res);
});

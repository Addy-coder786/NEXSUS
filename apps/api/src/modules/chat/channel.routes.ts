import { Router } from 'express';
import {
  channelMembersSchema,
  createChannelSchema,
  idParamSchema,
  markReadSchema,
  messageListQuerySchema,
  openDmSchema,
  sendMessageSchema,
  updateChannelSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as channelController from './channel.controller';
import { requireChannelAccess } from './chat.access';
import * as messageController from './message.controller';

// ---- /workspaces/:id/channels, /workspaces/:id/unread (mounted by workspace.routes under '/:id') ----

const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.get(
  '/channels',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  channelController.listChannels,
);
workspaceRouter.post(
  '/channels',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createChannelSchema }),
  requireWorkspacePermission('channel:create'),
  channelController.createChannel,
);
workspaceRouter.post(
  '/channels/dm',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: openDmSchema }),
  requireWorkspacePermission('member'),
  channelController.openDm,
);
workspaceRouter.get(
  '/unread',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  channelController.workspaceUnread,
);

export const workspaceChannelRoutes = workspaceRouter;

// ---- /channels ----

const router = Router();
router.use(authenticate);

router.get('/:id', validate({ params: idParamSchema }), requireChannelAccess(), channelController.getChannel);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateChannelSchema }),
  requireChannelAccess(), // creator or channel:manage enforced in the service
  channelController.updateChannel,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireChannelAccess('channel:manage'),
  channelController.deleteChannel,
);

router.get('/:id/members', validate({ params: idParamSchema }), requireChannelAccess(), channelController.listMembers);
router.post(
  '/:id/members',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: channelMembersSchema }),
  requireChannelAccess('member', { allowManagers: true }), // existing member or channel:manage
  channelController.addMembers,
);
router.delete(
  '/:id/members/:userId',
  requireVerifiedEmail,
  validate({ params: channelController.channelMemberParamsSchema }),
  requireChannelAccess('member', { allowManagers: true }), // self or channel:manage (service)
  channelController.removeMember,
);

router.post(
  '/:id/read',
  validate({ params: idParamSchema, body: markReadSchema }),
  requireChannelAccess(),
  channelController.markRead,
);
router.post(
  '/:id/mute',
  validate({ params: idParamSchema, body: channelController.muteSchema }),
  requireChannelAccess(),
  channelController.setMuted,
);

router.get(
  '/:id/messages',
  validate({ params: idParamSchema, query: messageListQuerySchema }),
  requireChannelAccess(),
  messageController.listMessages,
);
router.post(
  '/:id/messages',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: sendMessageSchema }),
  requireChannelAccess('message:send'),
  messageController.sendMessage,
);

export const channelRoutes = router;

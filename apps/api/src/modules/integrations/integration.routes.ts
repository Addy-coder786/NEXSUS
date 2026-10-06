import { Router } from 'express';
import {
  idParamSchema,
  syncSlackChannelsSchema,
  unsyncSlackChannelSchema,
  updateSlackIntegrationSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './integration.controller';

// ---- /integrations ----

const router = Router();

/** OAuth redirect target: no session, the `state` token identifies workspace + user. */
router.get('/slack/callback', controller.slackCallback);

export const integrationRoutes = router;

// ---- /workspaces/:id/integrations (mounted by workspace.routes with `/:id`) ----

const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.get(
  '/integrations',
  authenticate,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  controller.getOverview,
);
workspaceRouter.get(
  '/integrations/slack/install',
  authenticate,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.installSlack,
);
workspaceRouter.patch(
  '/integrations/slack',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateSlackIntegrationSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.updateSlack,
);
workspaceRouter.delete(
  '/integrations/slack',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.disconnectSlack,
);
workspaceRouter.get(
  '/integrations/slack/channels',
  authenticate,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.listSlackChannels,
);
workspaceRouter.post(
  '/integrations/slack/sync',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: syncSlackChannelsSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.syncSlackChannels,
);
workspaceRouter.post(
  '/integrations/slack/unsync',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: unsyncSlackChannelSchema }),
  requireWorkspacePermission('integration:manage'),
  controller.unsyncSlackChannel,
);

export const workspaceIntegrationRoutes = workspaceRouter;

import { Router } from 'express';
import {
  activityQuerySchema,
  createProjectSchema,
  createWorkspaceSchema,
  idParamSchema,
  inviteMemberSchema,
  transferOwnershipSchema,
  updateMemberRoleSchema,
  updateWorkspaceSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { workspaceChannelRoutes } from '../chat/channel.routes';
import { workspaceAnalyticsRoutes } from '../analytics/analytics.routes';
import { workspaceDocumentRoutes } from '../documents/document.routes';
import { workspaceFileRoutes } from '../files/file.routes';
import { workspaceIntegrationRoutes } from '../integrations/integration.routes';
import * as projectController from '../projects/project.controller';
import { workspaceSearchRoutes } from '../search/search.routes';
import * as invitationController from './invitation.controller';
import * as workspaceController from './workspace.controller';

const router = Router();
router.use(authenticate);

// ---- /workspaces ----

router.post(
  '/',
  requireVerifiedEmail,
  validate({ body: createWorkspaceSchema }),
  workspaceController.createWorkspace,
);
router.get('/', workspaceController.listWorkspaces);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  workspaceController.getWorkspace,
);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateWorkspaceSchema }),
  requireWorkspacePermission('workspace:update'),
  workspaceController.updateWorkspace,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('workspace:delete'),
  workspaceController.deleteWorkspace,
);
router.post(
  '/:id/transfer',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: transferOwnershipSchema }),
  requireWorkspacePermission('workspace:transfer'),
  workspaceController.transferOwnership,
);

// ---- /workspaces/:id/members ----

const members = Router({ mergeParams: true });
members.get(
  '/',
  validate({ params: idParamSchema, query: workspaceController.memberSearchQuerySchema }),
  requireWorkspacePermission('member'),
  workspaceController.listMembers,
);
members.patch(
  '/:userId',
  requireVerifiedEmail,
  validate({ params: workspaceController.memberParamsSchema, body: updateMemberRoleSchema }),
  requireWorkspacePermission('member:manage'),
  workspaceController.updateMemberRole,
);
members.delete(
  '/:userId',
  requireVerifiedEmail,
  validate({ params: workspaceController.memberParamsSchema }),
  requireWorkspacePermission('member'), // member:manage or self-leave: enforced in the service
  workspaceController.removeMember,
);
router.use('/:id/members', members);

// ---- /workspaces/:id/invitations ----

const invitations = Router({ mergeParams: true });
invitations.get(
  '/',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member:invite'),
  invitationController.listInvitations,
);
invitations.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: inviteMemberSchema }),
  requireWorkspacePermission('member:invite'),
  invitationController.createInvitation,
);
invitations.delete(
  '/:invitationId',
  requireVerifiedEmail,
  validate({ params: invitationController.invitationParamsSchema }),
  requireWorkspacePermission('member:invite'),
  invitationController.revokeInvitation,
);
router.use('/:id/invitations', invitations);

// ---- /workspaces/:id/activities ----

router.get(
  '/:id/activities',
  validate({ params: idParamSchema, query: activityQuerySchema }),
  requireWorkspacePermission('activity:view'),
  workspaceController.listActivities,
);

// ---- /workspaces/:id/projects ----

const projects = Router({ mergeParams: true });
projects.get(
  '/',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  projectController.listProjects,
);
projects.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createProjectSchema }),
  requireWorkspacePermission('project:create'),
  projectController.createProject,
);
router.use('/:id/projects', projects);

// ---- /workspaces/:id/channels, /workspaces/:id/unread (chat module) ----
router.use('/:id', workspaceChannelRoutes);

// ---- Phase 2 nested resources (/workspaces/:id/<resource>) ----

router.use('/:id', workspaceDocumentRoutes);
router.use('/:id', workspaceFileRoutes);
router.use('/:id', workspaceSearchRoutes);
router.use('/:id', workspaceAnalyticsRoutes);
router.use('/:id', workspaceIntegrationRoutes);

export const workspaceRoutes = router;

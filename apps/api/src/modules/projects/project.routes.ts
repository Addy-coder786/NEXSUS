import { Router } from 'express';
import {
  activityQuerySchema,
  addProjectMembersSchema,
  createLabelSchema,
  createTaskSchema,
  idParamSchema,
  taskListQuerySchema,
  updateLabelSchema,
  updateProjectSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { projectAnalyticsRoutes } from '../analytics/analytics.routes';
import * as projectController from './project.controller';

const router = Router();
router.use(authenticate);

const fromProject = { from: 'project' as const };

// ---- /projects/:id ----

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('project:view', fromProject),
  requireProjectAccess,
  projectController.getProject,
);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateProjectSchema }),
  requireWorkspacePermission('project:update', fromProject),
  projectController.updateProject,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('project:delete', fromProject),
  projectController.deleteProject,
);

// ---- /projects/:id/members ----

const members = Router({ mergeParams: true });
members.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: addProjectMembersSchema }),
  requireWorkspacePermission('project:update', fromProject),
  projectController.addMembers,
);
members.delete(
  '/:userId',
  requireVerifiedEmail,
  validate({ params: projectController.projectMemberParamsSchema }),
  requireWorkspacePermission('project:update', fromProject),
  projectController.removeMember,
);
router.use('/:id/members', members);

// ---- /projects/:id/labels ----

const labels = Router({ mergeParams: true });
labels.get(
  '/',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('project:view', fromProject),
  requireProjectAccess,
  projectController.listLabels,
);
labels.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createLabelSchema }),
  requireWorkspacePermission('task:update', fromProject),
  requireProjectAccess,
  projectController.createLabel,
);
labels.patch(
  '/:labelId',
  requireVerifiedEmail,
  validate({ params: projectController.labelParamsSchema, body: updateLabelSchema }),
  requireWorkspacePermission('task:update', fromProject),
  requireProjectAccess,
  projectController.updateLabel,
);
labels.delete(
  '/:labelId',
  requireVerifiedEmail,
  validate({ params: projectController.labelParamsSchema }),
  requireWorkspacePermission('task:update', fromProject),
  requireProjectAccess,
  projectController.deleteLabel,
);
router.use('/:id/labels', labels);

// ---- /projects/:id/tasks ----

const tasks = Router({ mergeParams: true });
tasks.get(
  '/',
  validate({ params: idParamSchema, query: taskListQuerySchema }),
  requireWorkspacePermission('task:view', fromProject),
  requireProjectAccess,
  projectController.listTasks,
);
tasks.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createTaskSchema }),
  requireWorkspacePermission('task:create', fromProject),
  requireProjectAccess,
  projectController.createTask,
);
router.use('/:id/tasks', tasks);

// ---- /projects/:id/activities ----

router.get(
  '/:id/activities',
  validate({ params: idParamSchema, query: activityQuerySchema }),
  requireWorkspacePermission('activity:view', fromProject),
  requireProjectAccess,
  projectController.listActivities,
);

// ---- /projects/:id/analytics ----

router.use('/:id', projectAnalyticsRoutes);

export const projectRoutes = router;

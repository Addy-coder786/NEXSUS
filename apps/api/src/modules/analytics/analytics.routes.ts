import { Router } from 'express';
import { analyticsQuerySchema, idParamSchema } from '@nexus/shared';
import { authenticate } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './analytics.controller';

/** `/analytics` has no top-level endpoints; kept so routes/index.ts can mount it. */
export const analyticsRoutes = Router();

// ---- /workspaces/:id/analytics (mounted by workspace.routes with `/:id`) ----

const workspaceRouter = Router({ mergeParams: true });
workspaceRouter.get(
  '/analytics',
  authenticate,
  validate({ params: idParamSchema, query: analyticsQuerySchema }),
  requireWorkspacePermission('analytics:view'),
  controller.workspaceAnalytics,
);
export const workspaceAnalyticsRoutes = workspaceRouter;

// ---- /projects/:id/analytics (mounted by project.routes with `/:id`) ----

const projectRouter = Router({ mergeParams: true });
projectRouter.get(
  '/analytics',
  authenticate,
  validate({ params: idParamSchema, query: analyticsQuerySchema }),
  requireWorkspacePermission('analytics:view', { from: 'project' }),
  requireProjectAccess,
  controller.projectAnalytics,
);
export const projectAnalyticsRoutes = projectRouter;

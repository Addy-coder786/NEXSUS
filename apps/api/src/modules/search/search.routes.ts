import { Router } from 'express';
import { idParamSchema, searchQuerySchema } from '@nexus/shared';
import { authenticate } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './search.controller';

/** `/search` has no workspace-less endpoints; kept so routes/index.ts can mount it. */
export const searchRoutes = Router();

// ---- /workspaces/:id/search (mounted by workspace.routes with `/:id`) ----

const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.get(
  '/search',
  authenticate,
  validate({ params: idParamSchema, query: searchQuerySchema }),
  requireWorkspacePermission('member'),
  controller.search,
);

export const workspaceSearchRoutes = workspaceRouter;

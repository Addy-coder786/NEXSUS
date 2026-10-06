import { analyticsQuerySchema } from '@nexus/shared';
import { getAuthUser, getProjectContext, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import * as analyticsService from './analytics.service';

export const projectAnalytics = asyncHandler(async (req, res) => {
  const { weeks } = typedQuery(req, analyticsQuerySchema);
  ok(res, await analyticsService.getProjectAnalytics(getProjectContext(req), weeks));
});

export const workspaceAnalytics = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { weeks } = typedQuery(req, analyticsQuerySchema);
  ok(res, await analyticsService.getWorkspaceAnalytics(ws.id, user.id, ws.role, weeks));
});

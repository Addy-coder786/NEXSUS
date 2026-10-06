import { paginationQuerySchema } from '@nexus/shared';
import { getAuthUser } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import { listMyActivities } from './activity.service';

export const getMyActivities = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const query = typedQuery(req, paginationQuerySchema);
  const { items, meta } = await listMyActivities(user.id, query);
  ok(res, items, meta);
});

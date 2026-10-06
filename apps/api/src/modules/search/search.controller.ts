import { searchQuerySchema } from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok } from '../../utils/response';
import * as searchService from './search.service';

export const search = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const query = typedQuery(req, searchQuerySchema);
  ok(res, await searchService.search(ws.id, user.id, ws.role, query));
});

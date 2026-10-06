import type { UpdateCommentInput } from '@nexus/shared';
import {
  getAuthUser,
  getCommentContext,
  getTaskContext,
  getWorkspaceContext,
} from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { noContent, ok } from '../../utils/response';
import * as commentService from './comment.service';

export const updateComment = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: UpdateCommentInput = req.body;
  ok(
    res,
    await commentService.updateComment(getCommentContext(req), getTaskContext(req), user.id, input),
  );
});

export const deleteComment = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  await commentService.deleteComment(getCommentContext(req), getTaskContext(req), user.id, ws.role);
  noContent(res);
});

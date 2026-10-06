import {
  paginationQuerySchema,
  type CreateCommentInput,
  type MoveTaskInput,
  type UpdateTaskInput,
} from '@nexus/shared';
import {
  getAuthUser,
  getProjectContext,
  getTaskContext,
  getWorkspaceContext,
} from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as commentService from '../comments/comment.service';
import * as taskService from './task.service';

export const getTask = asyncHandler(async (req, res) => {
  ok(res, await taskService.buildTaskDto(getTaskContext(req), getProjectContext(req)));
});

export const updateTask = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: UpdateTaskInput = req.body;
  ok(res, await taskService.updateTask(getTaskContext(req), getProjectContext(req), user.id, input));
});

export const moveTask = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: MoveTaskInput = req.body;
  ok(res, await taskService.moveTask(getTaskContext(req), getProjectContext(req), user.id, input));
});

export const deleteTask = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  await taskService.deleteTask(getTaskContext(req), getProjectContext(req), user.id, ws.role);
  noContent(res);
});

export const listSubtasks = asyncHandler(async (req, res) => {
  ok(res, await taskService.listSubtasks(getTaskContext(req), getProjectContext(req)));
});

export const listComments = asyncHandler(async (req, res) => {
  const query = typedQuery(req, paginationQuerySchema);
  const { items, meta } = await commentService.listComments(getTaskContext(req), query);
  ok(res, items, meta);
});

export const createComment = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: CreateCommentInput = req.body;
  created(
    res,
    await commentService.createComment(getTaskContext(req), getProjectContext(req), user.id, input),
  );
});

import { z } from 'zod';
import {
  activityQuerySchema,
  objectIdSchema,
  type CreateWorkspaceInput,
  type UpdateMemberRoleInput,
  type UpdateWorkspaceInput,
} from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import { listWorkspaceActivities } from '../activity/activity.service';
import * as workspaceService from './workspace.service';

export const memberParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });
export const memberSearchQuerySchema = z.object({ search: z.string().trim().max(100).optional() });

type MemberParams = z.infer<typeof memberParamsSchema>;

export const createWorkspace = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const input: CreateWorkspaceInput = req.body;
  created(res, await workspaceService.createWorkspace(user.id, input));
});

export const listWorkspaces = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  ok(res, await workspaceService.listWorkspaces(user.id));
});

export const getWorkspace = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  ok(res, await workspaceService.getWorkspace(ws.id, ws.role));
});

export const updateWorkspace = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: UpdateWorkspaceInput = req.body;
  ok(res, await workspaceService.updateWorkspace(ws.id, user.id, ws.role, input));
});

export const deleteWorkspace = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  await workspaceService.deleteWorkspace(ws.id);
  noContent(res);
});

export const transferOwnership = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { userId } = req.body as { userId: string };
  ok(res, await workspaceService.transferOwnership(ws.id, user.id, userId));
});

export const listMembers = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const { search } = typedQuery(req, memberSearchQuerySchema);
  ok(res, await workspaceService.listMembers(ws.id, search));
});

export const updateMemberRole = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { userId } = req.params as MemberParams;
  const input: UpdateMemberRoleInput = req.body;
  ok(res, await workspaceService.updateMemberRole(ws.id, user.id, ws.role, userId, input.role));
});

export const removeMember = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { userId } = req.params as MemberParams;
  await workspaceService.removeMember(ws.id, user.id, ws.role, userId);
  noContent(res);
});

export const listActivities = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const query = typedQuery(req, activityQuerySchema);
  const { items, meta } = await listWorkspaceActivities(ws.id, query);
  ok(res, items, meta);
});

import type { Request, RequestHandler } from 'express';
import {
  hasPermission,
  meetingListQuerySchema,
  type ConvertActionItemsInput,
  type CreateMeetingInput,
  type Permission,
} from '@nexus/shared';
import { getAuthUser, getMemberRole, getWorkspaceContext, hasProjectAccess } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { Project } from '../../models/Project';
import type { MeetingLean } from '../../models/Meeting';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as meetingService from './meeting.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      meeting?: MeetingLean;
    }
  }
}

function getMeetingContext(req: Request): MeetingLean {
  if (!req.meeting) throw ApiError.internal('Meeting context missing');
  return req.meeting;
}

/**
 * Loads `/meetings/:id`, checks workspace membership (404 for outsiders), `permission` and
 * project access, then attaches `req.meeting` and `req.workspace`.
 */
export function requireMeetingPermission(permission: Permission | 'member'): RequestHandler {
  return async (req, _res, next) => {
    try {
      const user = getAuthUser(req);
      const meeting = await meetingService.loadMeeting(req.params.id ?? '');
      const workspaceId = String(meeting.workspaceId);
      const role = await getMemberRole(workspaceId, user.id);
      if (!role) throw ApiError.notFound('Meeting');
      if (permission !== 'member' && !hasPermission(role, permission)) throw ApiError.forbidden();
      await meetingService.assertMeetingAccess(meeting, role, user.id);
      req.workspace = { id: workspaceId, role };
      req.meeting = meeting;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const listMeetings = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { items, meta } = await meetingService.listMeetings(ws.id, user.id, ws.role, typedQuery(req, meetingListQuerySchema));
  ok(res, items, meta);
});

export const createMeeting = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  created(res, await meetingService.createMeeting(ws.id, user.id, ws.role, req.body as CreateMeetingInput));
});

export const getMeeting = asyncHandler(async (req, res) => {
  ok(res, await meetingService.buildMeetingDetail(getMeetingContext(req)));
});

export const analyzeMeeting = asyncHandler(async (req, res) => {
  ok(res, await meetingService.reanalyzeMeeting(getMeetingContext(req)));
});

export const convertActionItems = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const meeting = getMeetingContext(req);
  const body = req.body as ConvertActionItemsInput;
  const project = await Project.findOne({ _id: body.projectId, workspaceId: meeting.workspaceId }).lean();
  if (!project) throw ApiError.notFound('Project');
  if (!hasProjectAccess(project, ws.role, user.id)) throw ApiError.forbidden('You are not a member of this project');
  created(res, await meetingService.convertActionItems(meeting, project, user.id, body.actionItemIds));
});

export const deleteMeeting = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const meeting = getMeetingContext(req);
  if (!meetingService.canDeleteMeeting(meeting, user.id, hasPermission(ws.role, 'meeting:delete'))) throw ApiError.forbidden();
  await meetingService.deleteMeeting(meeting);
  noContent(res);
});


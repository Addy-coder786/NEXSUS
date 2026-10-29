import { Router } from 'express';
import { convertActionItemsSchema, createMeetingSchema, idParamSchema, meetingListQuerySchema } from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { requireAi } from '../ai/ai.client';
import * as controller from './meeting.controller';

export const meetingRoutes = Router();
meetingRoutes.use(authenticate);

// ---- /meetings/workspaces/:id ----

meetingRoutes.get(
  '/workspaces/:id',
  validate({ params: idParamSchema, query: meetingListQuerySchema }),
  requireWorkspacePermission('member'),
  controller.listMeetings,
);
// Works without AI: the meeting is saved as FAILED ("AI is not configured") and stays searchable.
meetingRoutes.post(
  '/workspaces/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createMeetingSchema }),
  requireWorkspacePermission('meeting:create'),
  controller.createMeeting,
);

// ---- /meetings/:id ----

meetingRoutes.get('/:id', validate({ params: idParamSchema }), controller.requireMeetingPermission('member'), controller.getMeeting);
meetingRoutes.post(
  '/:id/analyze',
  requireVerifiedEmail,
  requireAi,
  validate({ params: idParamSchema }),
  controller.requireMeetingPermission('meeting:create'),
  controller.analyzeMeeting,
);
meetingRoutes.post(
  '/:id/convert',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: convertActionItemsSchema }),
  controller.requireMeetingPermission('task:create'),
  controller.convertActionItems,
);
meetingRoutes.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  controller.requireMeetingPermission('member'), // creator or meeting:delete: checked in the controller
  controller.deleteMeeting,
);

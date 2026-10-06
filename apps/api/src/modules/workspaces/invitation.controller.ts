import { z } from 'zod';
import { objectIdSchema, type InviteMemberInput } from '@nexus/shared';
import { getAuthUser, getWorkspaceContext } from '../../middleware/authorize';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import * as invitationService from './invitation.service';

export const invitationParamsSchema = z.object({
  id: objectIdSchema,
  invitationId: objectIdSchema,
});
export const tokenParamsSchema = z.object({ token: z.string().min(1).max(200) });

type InvitationParams = z.infer<typeof invitationParamsSchema>;
type TokenParams = z.infer<typeof tokenParamsSchema>;

// Workspace-scoped (/workspaces/:id/invitations)

export const listInvitations = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  ok(res, await invitationService.listInvitations(ws.id));
});

export const createInvitation = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const input: InviteMemberInput = req.body;
  created(res, await invitationService.createInvitation(ws.id, user.id, ws.role, input));
});

export const revokeInvitation = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { invitationId } = req.params as InvitationParams;
  await invitationService.revokeInvitation(ws.id, user.id, invitationId);
  noContent(res);
});

// Token-based (/invitations/:token)

export const previewInvitation = asyncHandler(async (req, res) => {
  const { token } = req.params as TokenParams;
  ok(res, await invitationService.previewInvitation(token));
});

export const acceptInvitation = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const { token } = req.params as TokenParams;
  ok(res, await invitationService.acceptInvitation(token, user));
});

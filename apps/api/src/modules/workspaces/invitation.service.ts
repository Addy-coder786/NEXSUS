import { Types } from 'mongoose';
import {
  ERROR_CODES,
  INVITATION_TTL_SEC,
  canAssignRole,
  type InvitationDto,
  type InvitationPreviewDto,
  type InviteMemberInput,
  type WorkspaceDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { events } from '../../events';
import { invalidateMembership } from '../../middleware/authorize';
import {
  Invitation,
  effectiveInvitationStatus,
  toInvitationDto,
  toInvitationPreviewDto,
  type InvitationLean,
} from '../../models/Invitation';
import { User } from '../../models/User';
import { Workspace } from '../../models/Workspace';
import { WorkspaceMember } from '../../models/WorkspaceMember';
import { recordActivity } from '../../services/activity.service';
import { sendEmail } from '../../services/email';
import { ApiError } from '../../utils/ApiError';
import { randomToken, sha256 } from '../../utils/crypto';
import { loadUserMap } from './user.lookup';
import { buildInvitationEmail } from './workspace.emails';
import { findWorkspaceOrThrow, workspaceDtoFor } from './workspace.service';

/** PENDING invitations that have not yet expired. */
export async function listInvitations(workspaceId: string): Promise<InvitationDto[]> {
  const invitations = await Invitation.find({
    workspaceId,
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  const users = await loadUserMap(invitations.map((i) => i.invitedBy));
  return invitations.map((i) => toInvitationDto(i, users.get(i.invitedBy)));
}

export async function createInvitation(
  workspaceId: string,
  actorId: string,
  actorRole: WorkspaceRole,
  input: InviteMemberInput,
): Promise<InvitationDto> {
  if (!canAssignRole(actorRole, input.role)) throw ApiError.forbidden('You cannot invite with this role');

  const ws = await findWorkspaceOrThrow(workspaceId);
  const email = input.email.toLowerCase();

  const existingUser = await User.findOne({ email }).select('_id').lean();
  if (existingUser) {
    const member = await WorkspaceMember.exists({ workspaceId: ws._id, userId: existingUser._id });
    if (member) throw ApiError.conflict('This user is already a member of the workspace');
  }

  const pending = await Invitation.exists({
    workspaceId: ws._id,
    email,
    status: 'PENDING',
    expiresAt: { $gt: new Date() },
  });
  if (pending) throw ApiError.conflict('An invitation is already pending for this email');

  const token = randomToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_SEC * 1000);
  const invitation = await Invitation.create({
    workspaceId: ws._id,
    email,
    role: input.role,
    tokenHash: sha256(token),
    status: 'PENDING',
    invitedBy: new Types.ObjectId(actorId),
    expiresAt,
  });

  const users = await loadUserMap([actorId]);
  const inviter = users.get(actorId);

  await sendEmail(
    buildInvitationEmail({
      to: email,
      token,
      workspaceName: ws.name,
      inviterName: inviter.name,
      role: input.role,
      expiresAt,
    }),
  );

  await recordActivity({
    workspaceId: ws._id,
    actorId,
    type: 'INVITATION_SENT',
    target: { type: 'workspace', id: ws._id, title: ws.name },
    metadata: { email, role: input.role, invitationId: String(invitation._id) },
  });

  return toInvitationDto(invitation.toObject(), inviter);
}

export async function revokeInvitation(
  workspaceId: string,
  actorId: string,
  invitationId: string,
): Promise<void> {
  const invitation = await Invitation.findOne({ _id: invitationId, workspaceId, status: 'PENDING' });
  if (!invitation) throw ApiError.notFound('Invitation');

  invitation.status = 'REVOKED';
  await invitation.save();

  await recordActivity({
    workspaceId,
    actorId,
    type: 'INVITATION_REVOKED',
    metadata: { email: invitation.email, role: invitation.role, invitationId: String(invitation._id) },
  });
}

// ---------- public / token based ----------

async function findByToken(token: string): Promise<InvitationLean | null> {
  if (!token || token.length > 200) return null;
  return Invitation.findOne({ tokenHash: sha256(token) }).lean();
}

export async function previewInvitation(token: string): Promise<InvitationPreviewDto> {
  const invitation = await findByToken(token);
  if (!invitation) throw ApiError.notFound('Invitation');
  const ws = await Workspace.findById(invitation.workspaceId).lean();
  if (!ws) throw ApiError.notFound('Invitation');
  const users = await loadUserMap([invitation.invitedBy]);
  return toInvitationPreviewDto(invitation, ws, users.get(invitation.invitedBy).name);
}

export async function acceptInvitation(
  token: string,
  user: { id: string; email: string },
): Promise<WorkspaceDto> {
  const invitation = await findByToken(token);
  if (!invitation || invitation.status === 'REVOKED') throw ApiError.notFound('Invitation');

  const status = effectiveInvitationStatus(invitation);
  if (status === 'EXPIRED') throw new ApiError(410, ERROR_CODES.BAD_REQUEST, 'Invitation expired');
  if (status === 'ACCEPTED') throw ApiError.conflict('Invitation already accepted');

  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw ApiError.forbidden('This invitation was sent to a different email address');
  }

  const ws = await Workspace.findById(invitation.workspaceId).lean();
  if (!ws) throw ApiError.notFound('Invitation');

  const already = await WorkspaceMember.exists({ workspaceId: ws._id, userId: user.id });
  if (already) throw ApiError.conflict('You are already a member of this workspace');

  await WorkspaceMember.create({
    workspaceId: ws._id,
    userId: new Types.ObjectId(user.id),
    role: invitation.role,
  });
  await Invitation.updateOne(
    { _id: invitation._id },
    { $set: { status: 'ACCEPTED', acceptedAt: new Date() } },
  );
  await invalidateMembership(String(ws._id), user.id);

  const users = await loadUserMap([user.id]);
  await recordActivity({
    workspaceId: ws._id,
    actorId: user.id,
    type: 'MEMBER_JOINED',
    target: { type: 'member', id: user.id, title: users.get(user.id).name },
    metadata: { role: invitation.role, invitationId: String(invitation._id) },
  });

  events.emit('member.joined', { workspaceId: String(ws._id), userId: user.id, role: invitation.role, actorId: user.id });
  return workspaceDtoFor(ws, invitation.role);
}

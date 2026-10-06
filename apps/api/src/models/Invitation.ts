import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  INVITATION_STATUSES,
  WORKSPACE_ROLES,
  type InvitationDto,
  type InvitationPreviewDto,
  type InvitationStatus,
  type UserPublicDto,
  type WorkspaceRole,
} from '@nexus/shared';
import type { WorkspaceLean } from './Workspace';

export interface IInvitation {
  workspaceId: Types.ObjectId;
  email: string;
  role: WorkspaceRole;
  tokenHash: string;
  status: InvitationStatus;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InvitationDocument = HydratedDocument<IInvitation>;
export type InvitationLean = IInvitation & { _id: Types.ObjectId };

const invitationSchema = new Schema<IInvitation>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: 'MEMBER' },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: INVITATION_STATUSES, required: true, default: 'PENDING' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

invitationSchema.index({ workspaceId: 1, email: 1, status: 1 });

export const Invitation =
  (mongoose.models.Invitation as Model<IInvitation>) ??
  mongoose.model<IInvitation>('Invitation', invitationSchema);

/** PENDING invitations past their expiry read as EXPIRED. */
export function effectiveInvitationStatus(
  inv: Pick<IInvitation, 'status' | 'expiresAt'>,
): InvitationStatus {
  if (inv.status === 'PENDING' && inv.expiresAt.getTime() < Date.now()) return 'EXPIRED';
  return inv.status;
}

export function toInvitationDto(inv: InvitationLean, invitedBy: UserPublicDto): InvitationDto {
  return {
    id: String(inv._id),
    email: inv.email,
    role: inv.role,
    status: effectiveInvitationStatus(inv),
    invitedBy,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  };
}

export function toInvitationPreviewDto(
  inv: InvitationLean,
  workspace: WorkspaceLean,
  invitedByName: string,
): InvitationPreviewDto {
  return {
    workspace: {
      id: String(workspace._id),
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoUrl ?? null,
    },
    email: inv.email,
    role: inv.role,
    invitedBy: { name: invitedByName },
    expiresAt: inv.expiresAt.toISOString(),
    status: effectiveInvitationStatus(inv),
  };
}

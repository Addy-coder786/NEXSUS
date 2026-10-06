import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  WORKSPACE_ROLES,
  type UserPublicDto,
  type WorkspaceMemberDto,
  type WorkspaceRole,
} from '@nexus/shared';

export interface IWorkspaceMember {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceMemberDocument = HydratedDocument<IWorkspaceMember>;
export type WorkspaceMemberLean = IWorkspaceMember & { _id: Types.ObjectId };

const workspaceMemberSchema = new Schema<IWorkspaceMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: WORKSPACE_ROLES, required: true, default: 'MEMBER' },
  },
  { timestamps: true },
);

workspaceMemberSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const WorkspaceMember =
  (mongoose.models.WorkspaceMember as Model<IWorkspaceMember>) ??
  mongoose.model<IWorkspaceMember>('WorkspaceMember', workspaceMemberSchema);

export function toWorkspaceMemberDto(
  m: WorkspaceMemberLean,
  user: UserPublicDto,
): WorkspaceMemberDto {
  return {
    id: String(m._id),
    user,
    role: m.role,
    joinedAt: m.createdAt.toISOString(),
  };
}

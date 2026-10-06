import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { WorkspaceDto, WorkspaceRole } from '@nexus/shared';

export interface IWorkspace {
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  ownerId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type WorkspaceDocument = HydratedDocument<IWorkspace>;
export type WorkspaceLean = IWorkspace & { _id: Types.ObjectId };

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: null, maxlength: 300 },
    logoUrl: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

export const Workspace =
  (mongoose.models.Workspace as Model<IWorkspace>) ??
  mongoose.model<IWorkspace>('Workspace', workspaceSchema);

export function toWorkspaceDto(
  ws: WorkspaceLean,
  myRole: WorkspaceRole,
  memberCount: number,
): WorkspaceDto {
  return {
    id: String(ws._id),
    name: ws.name,
    slug: ws.slug,
    description: ws.description ?? null,
    logoUrl: ws.logoUrl ?? null,
    ownerId: String(ws.ownerId),
    memberCount,
    myRole,
    createdAt: ws.createdAt.toISOString(),
  };
}

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  PROJECT_STATUSES,
  type LabelDto,
  type ProjectDto,
  type ProjectStatus,
  type UserPublicDto,
} from '@nexus/shared';

export interface ILabel {
  _id: Types.ObjectId;
  name: string;
  color: string;
}

export interface IProject {
  workspaceId: Types.ObjectId;
  name: string;
  key: string;
  description: string | null;
  color: string;
  status: ProjectStatus;
  startDate: Date | null;
  dueDate: Date | null;
  createdBy: Types.ObjectId;
  memberIds: Types.ObjectId[];
  labels: ILabel[];
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectDocument = HydratedDocument<IProject>;
export type ProjectLean = IProject & { _id: Types.ObjectId };

export const DEFAULT_PROJECT_COLOR = '#6366f1';

const labelSchema = new Schema<ILabel>({
  name: { type: String, required: true, trim: true, maxlength: 30 },
  color: { type: String, required: true },
});

const projectSchema = new Schema<IProject>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    key: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, default: null, maxlength: 2000 },
    color: { type: String, default: DEFAULT_PROJECT_COLOR },
    status: { type: String, enum: PROJECT_STATUSES, default: 'ACTIVE' },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    memberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    labels: { type: [labelSchema], default: [] },
  },
  { timestamps: true },
);

projectSchema.index({ workspaceId: 1, key: 1 }, { unique: true });
projectSchema.index({ workspaceId: 1, memberIds: 1 });

export const Project =
  (mongoose.models.Project as Model<IProject>) ?? mongoose.model<IProject>('Project', projectSchema);

export function toLabelDto(label: ILabel): LabelDto {
  return { id: String(label._id), name: label.name, color: label.color };
}

export function toProjectDto(
  p: ProjectLean,
  createdBy: UserPublicDto,
  members: UserPublicDto[],
  taskCounts: Record<string, number>,
): ProjectDto {
  return {
    id: String(p._id),
    workspaceId: String(p.workspaceId),
    name: p.name,
    key: p.key,
    description: p.description ?? null,
    color: p.color,
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString() : null,
    dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    createdBy,
    members,
    labels: p.labels.map(toLabelDto),
    taskCounts,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

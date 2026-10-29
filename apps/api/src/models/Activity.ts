import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  ACTIVITY_TYPES,
  type ActivityDto,
  type ActivityTargetType,
  type ActivityType,
  type UserPublicDto,
} from '@nexus/shared';

export interface IActivityTarget {
  type: ActivityTargetType;
  id: string;
  title: string;
}

export interface IActivity {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  actorId: Types.ObjectId;
  type: ActivityType;
  /** Stored inline so the feed survives deletion of the target. */
  target: IActivityTarget | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type ActivityDocument = HydratedDocument<IActivity>;
export type ActivityLean = IActivity & { _id: Types.ObjectId };

const ACTIVITY_TARGET_TYPES: ActivityTargetType[] = [
  'task',
  'project',
  'workspace',
  'comment',
  'member',
  'meeting',
];

const targetSchema = new Schema<IActivityTarget>(
  {
    type: { type: String, enum: ACTIVITY_TARGET_TYPES, required: true },
    id: { type: String, required: true },
    title: { type: String, default: '' },
  },
  { _id: false },
);

const activitySchema = new Schema<IActivity>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    target: { type: targetSchema, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ workspaceId: 1, createdAt: -1 });
activitySchema.index({ projectId: 1, createdAt: -1 });

export const Activity =
  (mongoose.models.Activity as Model<IActivity>) ??
  mongoose.model<IActivity>('Activity', activitySchema);

export function toActivityDto(a: ActivityLean, actor: UserPublicDto): ActivityDto {
  return {
    id: String(a._id),
    workspaceId: String(a.workspaceId),
    projectId: a.projectId ? String(a.projectId) : null,
    type: a.type,
    actor,
    target: a.target ? { type: a.target.type, id: a.target.id, title: a.target.title } : null,
    metadata: a.metadata ?? {},
    createdAt: a.createdAt.toISOString(),
  };
}

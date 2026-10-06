import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { CommentDto, UserPublicDto } from '@nexus/shared';

export interface IComment {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId: Types.ObjectId;
  authorId: Types.ObjectId;
  body: string;
  mentions: Types.ObjectId[];
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<IComment>;
export type CommentLean = IComment & { _id: Types.ObjectId };

const commentSchema = new Schema<IComment>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    mentions: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

commentSchema.index({ taskId: 1, createdAt: 1 });

export const Comment =
  (mongoose.models.Comment as Model<IComment>) ?? mongoose.model<IComment>('Comment', commentSchema);

export function toCommentDto(c: CommentLean, author: UserPublicDto): CommentDto {
  return {
    id: String(c._id),
    taskId: String(c.taskId),
    author,
    body: c.body,
    mentions: c.mentions.map((m) => String(m)),
    editedAt: c.editedAt ? c.editedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

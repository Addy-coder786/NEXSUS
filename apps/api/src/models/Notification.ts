import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { NOTIFICATION_TYPES, type NotificationType } from '@nexus/shared';

export type NotificationEntityType = 'task' | 'project' | 'comment' | 'message' | 'document' | 'file' | 'workspace' | 'meeting';

export interface INotification {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  actorId: Types.ObjectId | null;
  entity: { type: NotificationEntityType; id: Types.ObjectId } | null;
  readAt: Date | null;
  /** Delivery bookkeeping so the same event is not emailed/Slacked twice. */
  emailedAt: Date | null;
  slackedAt: Date | null;
  createdAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: null, maxlength: 1000 },
    link: { type: String, default: null, maxlength: 500 },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    entity: {
      // A sub-schema (not an inline object) so Mongoose does not read the inner `type` key as a nested path.
      type: new Schema<{ type: NotificationEntityType; id: Types.ObjectId }>(
        { type: { type: String, required: true }, id: { type: Schema.Types.ObjectId, required: true } },
        { _id: false },
      ),
      default: null,
    },
    readAt: { type: Date, default: null },
    emailedAt: { type: Date, default: null },
    slackedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ workspaceId: 1, createdAt: -1 });
// Auto-expire after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const Notification =
  (mongoose.models.Notification as Model<INotification>) ??
  mongoose.model<INotification>('Notification', notificationSchema);

import mongoose, { Schema, type Model, type Types } from 'mongoose';

/** Per-user read cursor for a channel. Unread count = messages created after lastReadAt. */
export interface IChannelRead {
  channelId: Types.ObjectId;
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  lastReadAt: Date;
  lastReadMessageId: Types.ObjectId | null;
  /** Notification muting for the channel */
  muted: boolean;
  updatedAt: Date;
}

const channelReadSchema = new Schema<IChannelRead>(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    lastReadAt: { type: Date, required: true, default: () => new Date() },
    lastReadMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    muted: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

channelReadSchema.index({ channelId: 1, userId: 1 }, { unique: true });
channelReadSchema.index({ userId: 1, workspaceId: 1 });

export const ChannelRead =
  (mongoose.models.ChannelRead as Model<IChannelRead>) ??
  mongoose.model<IChannelRead>('ChannelRead', channelReadSchema);

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { CHANNEL_TYPES, type ChannelType } from '@nexus/shared';

export interface IChannel {
  workspaceId: Types.ObjectId;
  /** Set for the auto-created project channel and any channel scoped to a project. */
  projectId: Types.ObjectId | null;
  type: ChannelType;
  name: string;
  slug: string;
  description: string | null;
  /** Participants for PRIVATE / DM / GROUP. Empty for PUBLIC (membership = workspace membership). */
  memberIds: Types.ObjectId[];
  /** Sorted, joined DM participant ids ("a:b") so a DM pair is unique. */
  dmKey: string | null;
  createdBy: Types.ObjectId | null;
  isArchived: boolean;
  /** Mirrored from Slack; no posting from NEXUS. */
  isReadOnly: boolean;
  source: 'nexus' | 'slack';
  slack: { teamId: string; channelId: string; lastSyncedAt: Date | null } | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export type ChannelDocument = HydratedDocument<IChannel>;

const channelSchema = new Schema<IChannel>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    type: { type: String, enum: CHANNEL_TYPES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: null, maxlength: 300 },
    memberIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [], index: true },
    dmKey: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isArchived: { type: Boolean, default: false },
    isReadOnly: { type: Boolean, default: false },
    source: { type: String, enum: ['nexus', 'slack'], default: 'nexus' },
    slack: {
      type: { teamId: String, channelId: String, lastSyncedAt: { type: Date, default: null } },
      default: null,
    },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null, maxlength: 200 },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

channelSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });
channelSchema.index({ workspaceId: 1, dmKey: 1 }, { unique: true, partialFilterExpression: { dmKey: { $type: 'string' } } });
channelSchema.index({ workspaceId: 1, 'slack.channelId': 1 }, { unique: true, partialFilterExpression: { 'slack.channelId': { $type: 'string' } } });
channelSchema.index({ workspaceId: 1, lastMessageAt: -1 });

export const Channel =
  (mongoose.models.Channel as Model<IChannel>) ?? mongoose.model<IChannel>('Channel', channelSchema);

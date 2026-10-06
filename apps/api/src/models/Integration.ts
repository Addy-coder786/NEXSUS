import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { INTEGRATION_PROVIDERS, NOTIFICATION_TYPES, type IntegrationProvider, type NotificationType } from '@nexus/shared';

export interface ISlackSyncedChannel {
  slackChannelId: string;
  slackChannelName: string;
  /** The mirrored NEXUS channel */
  channelId: Types.ObjectId;
  lastSyncedAt: Date | null;
  /** Latest Slack ts imported, for incremental backfill */
  lastTs: string | null;
}

export interface IIntegration {
  workspaceId: Types.ObjectId;
  provider: IntegrationProvider;
  /** Slack team (workspace) id */
  externalId: string;
  externalName: string;
  externalIconUrl: string | null;
  /** AES-256-GCM encrypted bot token (see utils/encryption.ts) */
  accessTokenEnc: string;
  botUserId: string | null;
  scopes: string[];
  installedBy: Types.ObjectId;
  notificationChannelId: string | null;
  notificationChannelName: string | null;
  notifyOn: NotificationType[];
  syncedChannels: ISlackSyncedChannel[];
  status: 'ACTIVE' | 'REVOKED' | 'ERROR';
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type IntegrationDocument = HydratedDocument<IIntegration>;

const integrationSchema = new Schema<IIntegration>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    provider: { type: String, enum: INTEGRATION_PROVIDERS, required: true },
    externalId: { type: String, required: true },
    externalName: { type: String, required: true },
    externalIconUrl: { type: String, default: null },
    accessTokenEnc: { type: String, required: true, select: false },
    botUserId: { type: String, default: null },
    scopes: { type: [String], default: [] },
    installedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notificationChannelId: { type: String, default: null },
    notificationChannelName: { type: String, default: null },
    notifyOn: { type: [String], enum: NOTIFICATION_TYPES, default: ['TASK_ASSIGNED', 'TASK_DUE_SOON', 'MENTION', 'AI_TASK_CREATED'] },
    syncedChannels: {
      type: [
        {
          _id: false,
          slackChannelId: { type: String, required: true },
          slackChannelName: { type: String, required: true },
          channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
          lastSyncedAt: { type: Date, default: null },
          lastTs: { type: String, default: null },
        },
      ],
      default: [],
    },
    status: { type: String, enum: ['ACTIVE', 'REVOKED', 'ERROR'], default: 'ACTIVE' },
    lastError: { type: String, default: null },
  },
  { timestamps: true },
);

integrationSchema.index({ workspaceId: 1, provider: 1 }, { unique: true });
integrationSchema.index({ provider: 1, externalId: 1 });

export const Integration =
  (mongoose.models.Integration as Model<IIntegration>) ??
  mongoose.model<IIntegration>('Integration', integrationSchema);

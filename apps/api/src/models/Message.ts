import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { MESSAGE_SOURCES, type MessageSource } from '@nexus/shared';

export interface IReaction {
  emoji: string;
  userIds: Types.ObjectId[];
}

export interface IMessage {
  workspaceId: Types.ObjectId;
  channelId: Types.ObjectId;
  /** null for system messages and Slack messages without a linked NEXUS account */
  authorId: Types.ObjectId | null;
  externalAuthor: { name: string; avatarUrl: string | null; slackUserId: string | null } | null;
  body: string;
  mentions: Types.ObjectId[];
  attachmentIds: Types.ObjectId[];
  parentMessageId: Types.ObjectId | null;
  replyCount: number;
  lastReplyAt: Date | null;
  reactions: IReaction[];
  source: MessageSource;
  /** Slack message timestamp ("1712345678.000100") for de-duplication of synced messages */
  slackTs: string | null;
  clientId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<IMessage>;

const messageSchema = new Schema<IMessage>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    externalAuthor: {
      type: { name: String, avatarUrl: { type: String, default: null }, slackUserId: { type: String, default: null } },
      default: null,
    },
    body: { type: String, default: '', maxlength: 8000 },
    mentions: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    attachmentIds: { type: [Schema.Types.ObjectId], ref: 'File', default: [] },
    parentMessageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    replyCount: { type: Number, default: 0 },
    lastReplyAt: { type: Date, default: null },
    reactions: {
      type: [{ _id: false, emoji: { type: String, required: true }, userIds: { type: [Schema.Types.ObjectId], default: [] } }],
      default: [],
    },
    source: { type: String, enum: MESSAGE_SOURCES, default: 'nexus' },
    slackTs: { type: String, default: null },
    clientId: { type: String, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Channel timeline (top-level) and thread replies
messageSchema.index({ channelId: 1, parentMessageId: 1, createdAt: -1 });
messageSchema.index({ parentMessageId: 1, createdAt: 1 });
messageSchema.index({ channelId: 1, slackTs: 1 }, { unique: true, partialFilterExpression: { slackTs: { $type: 'string' } } });
messageSchema.index({ workspaceId: 1, mentions: 1 });
messageSchema.index({ body: 'text' });

export const Message =
  (mongoose.models.Message as Model<IMessage>) ?? mongoose.model<IMessage>('Message', messageSchema);

import mongoose, { Schema, type Model, type Types } from 'mongoose';
import {
  AI_SCOPES,
  type AiConversationDto,
  type AiMessageDto,
  type AiScope,
  type AiSourceDto,
  type AiToolCallDto,
} from '@nexus/shared';

// ---------- conversation ----------

export interface IAiConversation {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  scope: AiScope;
  /** projectId or documentId for project/document scopes */
  scopeId: Types.ObjectId | null;
  title: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AiConversationLean = IAiConversation & { _id: Types.ObjectId };

const conversationSchema = new Schema<IAiConversation>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    scope: { type: String, enum: AI_SCOPES, default: 'workspace' },
    scopeId: { type: Schema.Types.ObjectId, default: null },
    title: { type: String, default: 'New conversation', maxlength: 120 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ workspaceId: 1, userId: 1, updatedAt: -1 });

export const AiConversation =
  (mongoose.models.AiConversation as Model<IAiConversation>) ??
  mongoose.model<IAiConversation>('AiConversation', conversationSchema);

export function toAiConversationDto(c: AiConversationLean): AiConversationDto {
  return {
    id: String(c._id),
    workspaceId: String(c.workspaceId),
    scope: c.scope,
    scopeId: c.scopeId ? String(c.scopeId) : null,
    title: c.title,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

// ---------- message ----------

export interface IAiMessage {
  conversationId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  sources: AiSourceDto[];
  toolCalls: AiToolCallDto[];
  suggestedAction: AiMessageDto['suggestedAction'];
  status: AiMessageDto['status'];
  error: string | null;
  createdAt: Date;
}

export type AiMessageLean = IAiMessage & { _id: Types.ObjectId };

const aiMessageSchema = new Schema<IAiMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'AiConversation', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    // Plain objects; shapes are owned by the shared DTOs.
    sources: { type: Schema.Types.Mixed, default: [] },
    toolCalls: { type: Schema.Types.Mixed, default: [] },
    suggestedAction: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ['complete', 'error', 'refused'], default: 'complete' },
    error: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

aiMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const AiMessage =
  (mongoose.models.AiMessage as Model<IAiMessage>) ?? mongoose.model<IAiMessage>('AiMessage', aiMessageSchema);

export function toAiMessageDto(m: AiMessageLean): AiMessageDto {
  return {
    id: String(m._id),
    conversationId: String(m.conversationId),
    role: m.role,
    content: m.content,
    sources: m.sources ?? [],
    toolCalls: m.toolCalls ?? [],
    suggestedAction: m.suggestedAction ?? null,
    status: m.status,
    error: m.error ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

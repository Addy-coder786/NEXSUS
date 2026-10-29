import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const AI_FEATURES = [
  'assistant',
  'generate_tasks',
  'meeting_analysis',
  'document_summary',
  'project_insights',
  'workspace_digest',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** One row per LLM call, for cost tracking. */
export interface IAiUsage {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId | null;
  feature: AiFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  createdAt: Date;
}

const aiUsageSchema = new Schema<IAiUsage>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    feature: { type: String, enum: AI_FEATURES, required: true },
    model: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    cacheWriteTokens: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

aiUsageSchema.index({ workspaceId: 1, createdAt: -1 });

export const AiUsage =
  (mongoose.models.AiUsage as Model<IAiUsage>) ?? mongoose.model<IAiUsage>('AiUsage', aiUsageSchema);

import mongoose, { Schema, type Model, type Types } from 'mongoose';

export const CHUNK_SOURCE_TYPES = ['document', 'message', 'task', 'meeting', 'file'] as const;
export type ChunkSourceType = (typeof CHUNK_SOURCE_TYPES)[number];

/** A retrievable slice of workspace content (RAG). */
export interface IChunk {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  sourceType: ChunkSourceType;
  sourceId: Types.ObjectId;
  /** Messages only: used to filter by channel visibility */
  channelId: Types.ObjectId | null;
  title: string;
  text: string;
  ordinal: number;
  tokenEstimate: number;
  embedding: number[] | null;
  embeddingModel: string | null;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ChunkLean = IChunk & { _id: Types.ObjectId };

const chunkSchema = new Schema<IChunk>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    sourceType: { type: String, enum: CHUNK_SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
    title: { type: String, default: '' },
    text: { type: String, required: true },
    ordinal: { type: Number, required: true },
    tokenEstimate: { type: Number, default: 0 },
    embedding: { type: [Number], default: null },
    embeddingModel: { type: String, default: null },
    contentHash: { type: String, required: true },
  },
  { timestamps: true },
);

chunkSchema.index({ workspaceId: 1, sourceType: 1, sourceId: 1 });
chunkSchema.index({ sourceType: 1, sourceId: 1, ordinal: 1 }, { unique: true });
chunkSchema.index({ text: 'text', title: 'text' }, { weights: { title: 5, text: 1 } });

export const Chunk = (mongoose.models.Chunk as Model<IChunk>) ?? mongoose.model<IChunk>('Chunk', chunkSchema);

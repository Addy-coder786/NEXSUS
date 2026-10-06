import mongoose, { Schema, type Model, type Types } from 'mongoose';
import type { RichContent } from '@nexus/shared';

/** Snapshot of a document at a given version. Only the latest DOCUMENT_VERSIONS_KEPT are retained. */
export interface IDocumentVersion {
  documentId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  version: number;
  title: string;
  content: RichContent;
  savedBy: Types.ObjectId;
  createdAt: Date;
}

const documentVersionSchema = new Schema<IDocumentVersion>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    version: { type: Number, required: true },
    title: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
    savedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

documentVersionSchema.index({ documentId: 1, version: -1 }, { unique: true });

export const DocumentVersion =
  (mongoose.models.DocumentVersion as Model<IDocumentVersion>) ??
  mongoose.model<IDocumentVersion>('DocumentVersion', documentVersionSchema);

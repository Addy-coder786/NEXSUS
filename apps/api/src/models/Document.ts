import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import type { RichContent } from '@nexus/shared';

export interface IDocument {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  title: string;
  icon: string | null;
  /** Tiptap JSON */
  content: RichContent;
  /** Plain text projection for search and excerpts */
  contentText: string;
  version: number;
  isArchived: boolean;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentDocument = HydratedDocument<IDocument>;

export const EMPTY_DOC: RichContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const documentSchema = new Schema<IDocument>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200, default: 'Untitled' },
    icon: { type: String, default: null, maxlength: 8 },
    content: { type: Schema.Types.Mixed, required: true, default: () => EMPTY_DOC },
    contentText: { type: String, default: '' },
    version: { type: Number, default: 1 },
    isArchived: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, minimize: false },
);

documentSchema.index({ workspaceId: 1, isArchived: 1, updatedAt: -1 });
documentSchema.index({ title: 'text', contentText: 'text' }, { weights: { title: 10, contentText: 1 } });

export const DocumentModel =
  (mongoose.models.Document as Model<IDocument>) ?? mongoose.model<IDocument>('Document', documentSchema);

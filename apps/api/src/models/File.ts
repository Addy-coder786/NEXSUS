import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { FILE_KINDS, type FileKind } from '@nexus/shared';

export interface IFile {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  taskId: Types.ObjectId | null;
  channelId: Types.ObjectId | null;
  messageId: Types.ObjectId | null;
  documentId: Types.ObjectId | null;
  uploadedBy: Types.ObjectId;
  name: string;
  mimeType: string;
  size: number;
  kind: FileKind;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  /** Provider handle (Cloudinary public_id or local relative path) for deletion */
  storageKey: string;
  provider: 'cloudinary' | 'local';
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FileDocument = HydratedDocument<IFile>;

const fileSchema = new Schema<IFile>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', default: null },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: FILE_KINDS, required: true },
    url: { type: String, required: true },
    thumbnailUrl: { type: String, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    storageKey: { type: String, required: true },
    provider: { type: String, enum: ['cloudinary', 'local'], required: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

fileSchema.index({ workspaceId: 1, deletedAt: 1, createdAt: -1 });
fileSchema.index({ name: 'text' });

export const FileModel = (mongoose.models.File as Model<IFile>) ?? mongoose.model<IFile>('File', fileSchema);

/** Map a MIME type to a coarse kind for filtering and icons. */
export function fileKindFromMime(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (/zip|rar|7z|tar|gzip|x-compressed/.test(mime)) return 'archive';
  if (/msword|officedocument|text\/|csv|json|markdown|rtf|presentation|spreadsheet/.test(mime)) return 'document';
  return 'other';
}

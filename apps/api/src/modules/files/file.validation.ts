import path from 'node:path';
import { ApiError } from '../../utils/ApiError';

/** Allowed MIME types and the file extensions each may carry. */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  // images
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/svg+xml': ['svg'],
  // pdf
  'application/pdf': ['pdf'],
  // video
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
  // audio
  'audio/mpeg': ['mp3'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/ogg': ['ogg', 'oga'],
  // documents
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt', 'md', 'log'],
  'text/csv': ['csv'],
  'text/markdown': ['md', 'markdown'],
  'application/json': ['json'],
  'application/rtf': ['rtf'],
  'text/rtf': ['rtf'],
  // archives
  'application/zip': ['zip'],
  'application/x-zip-compressed': ['zip'],
  'application/vnd.rar': ['rar'],
  'application/x-rar-compressed': ['rar'],
  'application/x-7z-compressed': ['7z'],
  'application/gzip': ['gz', 'tgz'],
  'application/x-gzip': ['gz', 'tgz'],
  'application/x-tar': ['tar'],
};

/** Magic-byte signatures for formats where a cheap check is unambiguous. */
const SIGNATURES: Readonly<Record<string, readonly (readonly [number, Buffer])[]>> = {
  'image/png': [[0, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]],
  'image/jpeg': [[0, Buffer.from([0xff, 0xd8, 0xff])]],
  'image/gif': [[0, Buffer.from('GIF87a')], [0, Buffer.from('GIF89a')]],
  'image/webp': [[0, Buffer.from('RIFF')], [8, Buffer.from('WEBP')]],
  'application/pdf': [[0, Buffer.from('%PDF')]],
  'application/zip': [[0, Buffer.from([0x50, 0x4b])]],
  'application/x-zip-compressed': [[0, Buffer.from([0x50, 0x4b])]],
  'application/gzip': [[0, Buffer.from([0x1f, 0x8b])]],
  'application/x-gzip': [[0, Buffer.from([0x1f, 0x8b])]],
};

export interface IncomingFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export function fileExtension(filename: string): string {
  return path.extname(filename).replace(/^\./, '').toLowerCase();
}

export function isAllowedMime(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mime);
}

function matchesSignature(mime: string, buffer: Buffer): boolean {
  const sigs = SIGNATURES[mime];
  if (!sigs) return true;
  if (mime === 'image/webp') {
    return sigs.every(([offset, bytes]) => buffer.subarray(offset, offset + bytes.length).equals(bytes));
  }
  return sigs.some(([offset, bytes]) => buffer.subarray(offset, offset + bytes.length).equals(bytes));
}

/** SVG is XML and may carry scripts; reject anything that could execute when opened inline. */
export function svgHasScript(buffer: Buffer): boolean {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 2 * 1024 * 1024)).toLowerCase();
  return text.includes('<script') || text.includes('javascript:');
}

/**
 * Validates MIME allowlist, extension/MIME agreement, magic bytes (where known) and SVG safety.
 * Throws a 400 ApiError describing the first failed check.
 */
export function validateIncomingFile(file: IncomingFile): void {
  const mime = file.mimetype.toLowerCase();
  if (!isAllowedMime(mime)) throw ApiError.badRequest(`File type ${file.mimetype} is not allowed`);

  const ext = fileExtension(file.originalname);
  const allowedExt = ALLOWED_MIME_TYPES[mime] ?? [];
  if (!ext || !allowedExt.includes(ext)) {
    throw ApiError.badRequest(`File extension .${ext || '?'} does not match type ${file.mimetype}`);
  }
  if (file.size === 0 || file.buffer.length === 0) throw ApiError.badRequest('File is empty');
  if (!matchesSignature(mime, file.buffer)) {
    throw ApiError.badRequest(`File content does not look like ${file.mimetype}`);
  }
  if (mime === 'image/svg+xml' && svgHasScript(file.buffer)) {
    throw ApiError.badRequest('SVG files containing scripts are not allowed');
  }
}

/** Strips path separators and control characters from a client-provided file name. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (cleaned || 'file').slice(0, 255);
}

import { FILE_KINDS, MAX_FILE_SIZE_BYTES, type FileKind } from '@nexus/shared';

/** Allowlist from the Phase 2 contract (Files section). Extensions cover browsers that report an empty MIME. */
export const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/rtf',
  'text/rtf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
];

export const ALLOWED_EXTENSIONS: readonly string[] = [
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'pdf',
  'mp4', 'webm', 'mov',
  'mp3', 'wav', 'ogg',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'json', 'rtf',
  'zip', 'rar', '7z', 'gz', 'tar',
];

/** `accept` attribute value for file inputs. */
export const ACCEPT_ATTRIBUTE = [...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS.map((e) => `.${e}`)].join(',');

export function extensionOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(decimals);
  return `${fixed.replace(/\.0+$/, '')} ${units[unit]}`;
}

/** Mirrors the server's `kind` classification for client-side previews before upload. */
export function kindFromMime(mime: string, name = ''): FileKind {
  const ext = extensionOf(name);
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg'].includes(ext)) return 'audio';
  if (
    /zip|rar|7z|gzip|tar/.test(mime) ||
    ['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)
  ) {
    return 'archive';
  }
  if (
    /msword|officedocument|ms-excel|ms-powerpoint|text\/|json|rtf/.test(mime) ||
    ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'json', 'rtf'].includes(ext)
  ) {
    return 'document';
  }
  return 'other';
}

export function isFileKind(value: string): value is FileKind {
  return (FILE_KINDS as readonly string[]).includes(value);
}

export type PrecheckResult = { ok: true } | { ok: false; reason: string };

/** Client-side guard so obviously invalid files never hit the network. */
export function precheckFile(file: Pick<File, 'name' | 'size' | 'type'>, maxBytes = MAX_FILE_SIZE_BYTES): PrecheckResult {
  if (file.size > maxBytes) {
    return { ok: false, reason: `File is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(maxBytes, 0)}.` };
  }
  if (file.size === 0) return { ok: false, reason: 'File is empty.' };
  const ext = extensionOf(file.name);
  const mimeOk = file.type !== '' && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
  const extOk = ext !== '' && ALLOWED_EXTENSIONS.includes(ext);
  if (!mimeOk && !extOk) {
    return { ok: false, reason: `This file type is not allowed${ext ? ` (.${ext})` : ''}.` };
  }
  return { ok: true };
}

export const KIND_LABELS: Record<FileKind, string> = {
  image: 'Images',
  pdf: 'PDFs',
  video: 'Videos',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  other: 'Other',
};

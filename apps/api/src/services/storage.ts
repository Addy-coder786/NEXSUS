import { randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { env, features } from '../config/env';
import { logger } from '../config/logger';

export interface UploadImageOptions {
  /** Logical folder, e.g. "avatars". */
  folder: string;
  /** Stable id within the folder (no extension). */
  publicId: string;
  /** Used to pick the file extension for local storage. Defaults to png. */
  mimeType?: string;
}

export interface UploadResult {
  url: string;
}

export type StorageProvider = 'cloudinary' | 'local';

export interface UploadFileOptions {
  workspaceId: string;
  /** Original file name; only its extension is used for the stored object. */
  filename: string;
  mimeType: string;
}

export interface UploadFileResult {
  url: string;
  /** Provider handle used for deletion (local relative path or "<resource_type>:<public_id>"). */
  storageKey: string;
  provider: StorageProvider;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Resolved at call time so tests can point `process.cwd()` at a temp directory. */
function uploadsRoot(): string {
  return path.resolve(process.cwd(), 'uploads');
}

/** True when `target` is inside `root` (path traversal guard). */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

let cloudinaryConfigured = false;
function getCloudinary() {
  if (!cloudinaryConfigured) {
    // The SDK reads CLOUDINARY_URL from the environment; we only force https URLs.
    cloudinary.config({ secure: true });
    cloudinaryConfigured = true;
  }
  return cloudinary;
}

// ---------- images (avatars, logos) ----------

async function uploadToCloudinary(buffer: Buffer, opts: UploadImageOptions): Promise<UploadResult> {
  const client = getCloudinary();
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: sanitizeSegment(opts.publicId),
        overwrite: true,
        resource_type: 'image',
      },
      (error, response) => {
        if (error || !response) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(response);
      },
    );
    stream.end(buffer);
  });
  return { url: result.secure_url };
}

async function uploadToDisk(buffer: Buffer, opts: UploadImageOptions): Promise<UploadResult> {
  const ext = EXT_BY_MIME[opts.mimeType ?? ''] ?? 'png';
  const folder = sanitizeSegment(opts.folder);
  const fileName = `${sanitizeSegment(opts.publicId)}.${ext}`;
  const dir = path.join(uploadsRoot(), folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buffer);
  return { url: `${env.API_URL}/uploads/${folder}/${fileName}` };
}

/** Stores an image and returns its public URL. */
export async function uploadImage(buffer: Buffer, opts: UploadImageOptions): Promise<UploadResult> {
  if (features.cloudinary) return uploadToCloudinary(buffer, opts);
  return uploadToDisk(buffer, opts);
}

/** Extracts the Cloudinary public id ("folder/name") from a delivery URL. */
function cloudinaryPublicId(url: string): string | null {
  const match = /\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)\.[a-zA-Z0-9]+$/.exec(url);
  return match?.[1] ?? null;
}

/**
 * Deletes a previously uploaded file by its URL. Never throws: failing to clean up an old avatar
 * must not fail the user's request. URLs we did not produce are ignored.
 */
export async function deleteByUrl(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    const localPrefix = `${env.API_URL}/uploads/`;
    if (url.startsWith(localPrefix)) {
      const relative = decodeURIComponent(url.slice(localPrefix.length));
      const root = uploadsRoot();
      const target = path.resolve(root, relative);
      if (!isInside(root, target)) return; // path traversal guard
      await unlink(target).catch(() => undefined);
      return;
    }
    if (features.cloudinary && url.includes('res.cloudinary.com')) {
      const publicId = cloudinaryPublicId(url);
      if (publicId) await getCloudinary().uploader.destroy(publicId, { resource_type: 'image' });
    }
  } catch (err) {
    logger.warn({ err, url }, 'Failed to delete stored file');
  }
}

// ---------- generic files (attachments) ----------

/** Reads intrinsic pixel dimensions for PNG / GIF / JPEG; null for anything else. */
export function imageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) return null;
        const marker = buffer[offset + 1] ?? 0;
        const length = buffer.readUInt16BE(offset + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extensionOf(filename: string, mimeType: string): string {
  const fromName = path.extname(filename).replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName) return fromName.slice(0, 10);
  return EXT_BY_MIME[mimeType] ?? 'bin';
}

async function uploadFileToDisk(buffer: Buffer, opts: UploadFileOptions): Promise<UploadFileResult> {
  const folder = sanitizeSegment(opts.workspaceId);
  const fileName = `${randomBytes(16).toString('hex')}.${extensionOf(opts.filename, opts.mimeType)}`;
  const root = uploadsRoot();
  const dir = path.join(root, folder);
  const target = path.join(dir, fileName);
  if (!isInside(root, target)) throw new Error('Invalid storage path');

  await mkdir(dir, { recursive: true });
  await writeFile(target, buffer);

  const dims = opts.mimeType.startsWith('image/') ? imageDimensions(buffer, opts.mimeType) : null;
  return {
    url: `${env.API_URL}/uploads/${folder}/${fileName}`,
    storageKey: `${folder}/${fileName}`,
    provider: 'local',
    ...(dims ? { width: dims.width, height: dims.height } : {}),
  };
}

async function uploadFileToCloudinary(buffer: Buffer, opts: UploadFileOptions): Promise<UploadFileResult> {
  const client = getCloudinary();
  const isImage = opts.mimeType.startsWith('image/');
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = client.uploader.upload_stream(
      {
        folder: `nexus/${sanitizeSegment(opts.workspaceId)}`,
        public_id: randomBytes(16).toString('hex'),
        resource_type: 'auto',
        use_filename: false,
        ...(isImage ? { eager: [{ width: 400, height: 400, crop: 'limit' }] } : {}),
      },
      (error, response) => {
        if (error || !response) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(response);
      },
    );
    stream.end(buffer);
  });

  const eager = (result.eager as Array<{ secure_url?: string }> | undefined)?.[0];
  return {
    url: result.secure_url,
    storageKey: `${result.resource_type}:${result.public_id}`,
    provider: 'cloudinary',
    ...(eager?.secure_url ? { thumbnailUrl: eager.secure_url } : {}),
    ...(isImage && result.width && result.height ? { width: result.width, height: result.height } : {}),
  };
}

/**
 * Stores an arbitrary file under the workspace. Cloudinary when configured (resource_type auto,
 * 400px eager thumbnail for images), otherwise local disk at uploads/<workspaceId>/<random>.<ext>.
 */
export async function uploadFile(buffer: Buffer, opts: UploadFileOptions): Promise<UploadFileResult> {
  if (features.cloudinary) return uploadFileToCloudinary(buffer, opts);
  return uploadFileToDisk(buffer, opts);
}

/** Deletes a stored file by its storage key. Never throws. */
export async function deleteFile(storageKey: string, provider: StorageProvider): Promise<void> {
  try {
    if (provider === 'local') {
      const root = uploadsRoot();
      const target = path.resolve(root, storageKey);
      if (!isInside(root, target)) return; // path traversal guard
      await unlink(target).catch(() => undefined);
      return;
    }
    if (!features.cloudinary) return;
    const sep = storageKey.indexOf(':');
    const resourceType = sep > 0 ? storageKey.slice(0, sep) : 'image';
    const publicId = sep > 0 ? storageKey.slice(sep + 1) : storageKey;
    await getCloudinary().uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    logger.warn({ err, storageKey, provider }, 'Failed to delete stored file');
  }
}

/**
 * Reads a stored file's bytes (local disk or the provider URL), or null when it is missing or
 * larger than `maxBytes`. Never throws. Used for text extraction (RAG indexing).
 */
export async function readStoredFile(
  file: { storageKey: string; provider: StorageProvider; url: string; size: number },
  maxBytes: number,
): Promise<Buffer | null> {
  if (file.size > maxBytes) return null;
  try {
    if (file.provider === 'local') {
      const root = uploadsRoot();
      const target = path.resolve(root, file.storageKey);
      if (!isInside(root, target)) return null;
      if ((await stat(target)).size > maxBytes) return null;
      return await readFile(target);
    }
    const res = await fetch(file.url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > maxBytes ? null : buffer;
  } catch (err) {
    logger.warn({ err, storageKey: file.storageKey }, 'Failed to read stored file');
    return null;
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env, isProd } from '../config/env';

/**
 * AES-256-GCM for secrets at rest (integration tokens). Key: ENCRYPTION_KEY (64 hex chars).
 * Outside production a key is derived from the access secret so local setups need no extra config.
 */
function key(): Buffer {
  if (env.ENCRYPTION_KEY) return Buffer.from(env.ENCRYPTION_KEY, 'hex');
  if (isProd) throw new Error('ENCRYPTION_KEY is required in production');
  return createHash('sha256').update(`${env.JWT_ACCESS_SECRET}:enc`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`;
}

export function decrypt(payload: string): string {
  const [v, ivB64, tagB64, dataB64] = payload.split('.');
  if (v !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

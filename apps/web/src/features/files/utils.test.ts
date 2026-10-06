import { describe, expect, it } from 'vitest';
import { MAX_FILE_SIZE_BYTES } from '@nexus/shared';
import { formatBytes, kindFromMime, precheckFile } from './utils';

describe('formatBytes', () => {
  it('formats using binary units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(25 * 1024 * 1024, 0)).toBe('25 MB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('precheckFile', () => {
  it('rejects files over the size limit', () => {
    const res = precheckFile({ name: 'big.pdf', size: MAX_FILE_SIZE_BYTES + 1, type: 'application/pdf' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/too large/i);
  });

  it('rejects disallowed types and accepts allowlisted ones (by MIME or extension)', () => {
    expect(precheckFile({ name: 'app.exe', size: 10, type: 'application/x-msdownload' }).ok).toBe(false);
    expect(precheckFile({ name: 'script.sh', size: 10, type: '' }).ok).toBe(false);
    expect(precheckFile({ name: 'photo.png', size: 10, type: 'image/png' }).ok).toBe(true);
    // Browsers often report no MIME for markdown; the extension allowlist covers it.
    expect(precheckFile({ name: 'notes.md', size: 10, type: '' }).ok).toBe(true);
    expect(precheckFile({ name: 'empty.txt', size: 0, type: 'text/plain' }).ok).toBe(false);
  });
});

describe('kindFromMime', () => {
  it('mirrors the server classification', () => {
    expect(kindFromMime('image/webp')).toBe('image');
    expect(kindFromMime('application/pdf')).toBe('pdf');
    expect(kindFromMime('video/mp4')).toBe('video');
    expect(kindFromMime('audio/mpeg')).toBe('audio');
    expect(kindFromMime('application/zip')).toBe('archive');
    expect(kindFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document');
    expect(kindFromMime('', 'readme.md')).toBe('document');
    expect(kindFromMime('application/octet-stream', 'blob.bin')).toBe('other');
  });
});

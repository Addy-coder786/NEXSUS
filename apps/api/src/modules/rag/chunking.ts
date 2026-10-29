import { createHash } from 'node:crypto';

/** ~800 tokens at ~4 characters per token. */
export const CHUNK_MAX_CHARS = 3200;
/** 15 % of a chunk is repeated at the start of the next one. */
export const CHUNK_OVERLAP_CHARS = Math.round(CHUNK_MAX_CHARS * 0.15);

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function contentHash(parts: string[]): string {
  const hash = createHash('sha256');
  for (const p of parts) hash.update(p).update('\u0000');
  return hash.digest('hex');
}

/** Splits an over-long paragraph at sentence ends, falling back to hard cuts. */
function splitLong(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > max) {
      if (current) out.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max).trim());
      continue;
    }
    if (current.length + sentence.length > max) {
      out.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

/**
 * Packs paragraphs (newline-separated; headings are their own lines) into chunks of at most
 * `max` characters. Each new chunk starts with the trailing paragraphs of the previous one, up
 * to `overlap` characters, so context that straddles a boundary is retrievable from both sides.
 */
export function chunkText(text: string, max = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP_CHARS): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, max));
  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  for (const paragraph of paragraphs) {
    if (length + paragraph.length + 1 > max && current.length) {
      chunks.push(current.join('\n'));
      // Carry the tail of this chunk forward as overlap.
      const carried: string[] = [];
      let carriedLength = 0;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        const p = current[i] as string;
        if (carriedLength + p.length > overlap) break;
        carried.unshift(p);
        carriedLength += p.length + 1;
      }
      // Never carry so much that the new paragraph no longer fits.
      while (carried.length && carriedLength + paragraph.length + 1 > max) {
        carriedLength -= (carried.shift() as string).length + 1;
      }
      current = carried;
      length = carriedLength;
    }
    current.push(paragraph);
    length += paragraph.length + 1;
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

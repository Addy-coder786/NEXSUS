import { env, features } from '../../config/env';

/**
 * Voyage AI embeddings (`POST /v1/embeddings`). `document` for indexing, `query` for search.
 * Batched at 128 inputs per request. Tests replace the embedder with setEmbedder().
 */
export type EmbeddingInputType = 'document' | 'query';
export type Embedder = (texts: string[], inputType: EmbeddingInputType) => Promise<number[][]>;

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const EMBED_BATCH_SIZE = 128;

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

const voyageEmbedder: Embedder = async (texts, inputType) => {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.VOYAGE_API_KEY}` },
      body: JSON.stringify({
        input: batch,
        model: env.VOYAGE_MODEL,
        input_type: inputType,
        ...(env.VOYAGE_DIMENSIONS ? { output_dimension: env.VOYAGE_DIMENSIONS } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed with status ${res.status}`);
    const body = (await res.json()) as VoyageResponse;
    const sorted = [...body.data].sort((a, b) => a.index - b.index);
    out.push(...sorted.map((d) => d.embedding));
  }
  return out;
};

let embedder: Embedder = voyageEmbedder;

export function setEmbedder(fake: Embedder | null): void {
  embedder = fake ?? voyageEmbedder;
}

export function embeddingsEnabled(): boolean {
  return features.embeddings;
}

export function embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
  if (texts.length === 0) return Promise.resolve([]);
  return embedder(texts, inputType);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

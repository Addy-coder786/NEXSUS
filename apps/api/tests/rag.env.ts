/**
 * Imported first by rag.test.ts so `features.embeddings` is true when config/env loads.
 * The Voyage client is replaced by a fake embedder, so the key is never used.
 */
process.env.VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? 'voyage-test';

export {};

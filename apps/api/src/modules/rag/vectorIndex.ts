import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Chunk } from '../../models/Chunk';

export const VECTOR_INDEX_NAME = 'nexus_chunks_vector';
/** Default output size of voyage-3.5; set VOYAGE_DIMENSIONS for other models or sizes. */
const DEFAULT_DIMENSIONS = 1024;

export function vectorIndexDefinition(dimensions = env.VOYAGE_DIMENSIONS ?? DEFAULT_DIMENSIONS) {
  return {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: dimensions, similarity: 'cosine' },
      { type: 'filter', path: 'workspaceId' },
      { type: 'filter', path: 'projectId' },
      { type: 'filter', path: 'sourceType' },
    ],
  };
}

/**
 * With VECTOR_SEARCH=atlas, creates the Atlas Vector Search index on `chunks` when it is missing.
 * Never throws: on clusters without Atlas Search (or without permission) it logs how to create
 * the index by hand, and retrieval keeps working on keyword results.
 */
export async function ensureVectorIndex(): Promise<void> {
  if (env.VECTOR_SEARCH !== 'atlas') return;
  try {
    const existing = await Chunk.listSearchIndexes();
    if (existing.some((i) => i.name === VECTOR_INDEX_NAME)) return;
    await Chunk.createSearchIndex({ name: VECTOR_INDEX_NAME, type: 'vectorSearch', definition: vectorIndexDefinition() });
    logger.info({ index: VECTOR_INDEX_NAME }, 'Created Atlas Vector Search index (it builds in the background)');
  } catch (err) {
    logger.warn(
      { err, index: VECTOR_INDEX_NAME, definition: vectorIndexDefinition() },
      'Could not create the Atlas Vector Search index; create it in Atlas (see docs/DEPLOYMENT.md)',
    );
  }
}

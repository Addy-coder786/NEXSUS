import { DOCUMENT_VERSIONS_KEPT } from '@nexus/shared';
import { logger } from '../../config/logger';
import { defineJob } from '../../jobs';
import { DocumentModel } from '../../models/Document';
import { DocumentVersion } from '../../models/DocumentVersion';

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * Stores a snapshot of the document at `version` and prunes snapshots beyond
 * DOCUMENT_VERSIONS_KEPT. Idempotent: a snapshot for an existing version is skipped, and the
 * job is a no-op when the document has already moved on to a newer version.
 */
export async function snapshotDocument(documentId: string, version: number): Promise<void> {
  const doc = await DocumentModel.findById(documentId).lean();
  if (!doc) return;
  if (doc.version !== version) {
    logger.debug({ documentId, version, current: doc.version }, 'Skipping stale document snapshot');
    return;
  }

  try {
    await DocumentVersion.create({
      documentId: doc._id,
      workspaceId: doc.workspaceId,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      savedBy: doc.updatedBy,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }

  const stale = await DocumentVersion.find({ documentId: doc._id })
    .sort({ version: -1 })
    .skip(DOCUMENT_VERSIONS_KEPT)
    .select('_id')
    .lean();
  if (stale.length) await DocumentVersion.deleteMany({ _id: { $in: stale.map((v) => v._id) } });
}

defineJob('document.snapshot', async ({ documentId, version }) => {
  await snapshotDocument(documentId, version);
});

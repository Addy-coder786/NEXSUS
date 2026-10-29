import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { events } from '../../events';
import { defineJob, enqueue } from '../../jobs';
import { Chunk } from '../../models/Chunk';
import { indexSource, reindexWorkspace, removeSource } from './rag.service';

/**
 * Event-driven RAG indexing. Writes enqueue `rag.index` / `rag.remove`; the job rebuilds the
 * source's chunks (skipping unchanged content by hash).
 */

defineJob('rag.index', async ({ sourceType, sourceId }) => {
  await indexSource(sourceType, sourceId);
});

defineJob('rag.remove', async ({ sourceType, sourceId }) => {
  await removeSource(sourceType, sourceId);
});

defineJob('rag.reindexWorkspace', async ({ workspaceId }) => {
  const count = await reindexWorkspace(workspaceId);
  logger.info({ workspaceId, chunks: count }, 'Workspace reindexed');
});

const index = (sourceType: 'document' | 'message' | 'task' | 'meeting' | 'file', sourceId: string) =>
  enqueue('rag.index', { sourceType, sourceId }, { jobId: `rag:${sourceType}:${sourceId}` });

events.on('task.created', ({ task }) => index('task', task.id));
events.on('task.updated', ({ task }) => index('task', task.id));
events.on('task.moved', ({ task }) => index('task', task.id));
events.on('task.deleted', ({ taskId }) => enqueue('rag.remove', { sourceType: 'task', sourceId: taskId }));

// Archived or deleted documents are removed by the index job when it finds nothing to index.
events.on('document.updated', ({ document }) => index('document', document.id));

// Replies are folded into their top-level message's chunk.
events.on('message.created', ({ message }) => index('message', message.parentMessageId ?? message.id));
events.on('message.updated', ({ message }) => index('message', message.parentMessageId ?? message.id));
events.on('message.deleted', ({ messageId, parentMessageId }) =>
  parentMessageId ? index('message', parentMessageId) : enqueue('rag.remove', { sourceType: 'message', sourceId: messageId }),
);

events.on('file.uploaded', ({ file }) => index('file', file.id));

events.on('project.deleted', async ({ projectId }) => {
  await Chunk.deleteMany({ projectId: new Types.ObjectId(projectId) });
});

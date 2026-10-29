import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import type { AiSourceDto, WorkspaceRole } from '@nexus/shared';
import { env, features } from '../../config/env';
import { logger } from '../../config/logger';
import { canSeeAllProjects, hasProjectAccess } from '../../middleware/authorize';
import { Channel } from '../../models/Channel';
import { Chunk, type ChunkLean, type ChunkSourceType, type IChunk } from '../../models/Chunk';
import { DocumentModel } from '../../models/Document';
import { FileModel } from '../../models/File';
import { Meeting } from '../../models/Meeting';
import { Message } from '../../models/Message';
import { Project } from '../../models/Project';
import { Task } from '../../models/Task';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { readStoredFile } from '../../services/storage';
import { links } from '../ai/links';
import { makeSnippet, search } from '../search/search.service';
import { chunkText, contentHash, estimateTokens } from './chunking';
import { cosine, embed } from './embeddings';
import { VECTOR_INDEX_NAME } from './vectorIndex';

// ---------- building chunks per source ----------

interface SourceContent {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId | null;
  channelId: Types.ObjectId | null;
  title: string;
  pieces: string[];
}

const MIN_MESSAGE_CHARS = 20;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
/** Upper bound on extracted text per file (about 125 chunks). */
const MAX_FILE_TEXT_CHARS = 400_000;
const TEXT_MIMES = new Set(['application/json']);
const PDF_MIME = 'application/pdf';

async function documentContent(id: Types.ObjectId): Promise<SourceContent | null> {
  const doc = await DocumentModel.findById(id).lean();
  if (!doc || doc.isArchived) return null;
  const text = doc.contentText.trim();
  if (!text) return null;
  return { workspaceId: doc.workspaceId, projectId: doc.projectId, channelId: null, title: doc.title, pieces: chunkText(text) };
}

async function taskContent(id: Types.ObjectId): Promise<SourceContent | null> {
  const task = await Task.findById(id).lean();
  if (!task) return null;
  const lines = [`${task.key}: ${task.title}`, `Status: ${task.status}. Priority: ${task.priority}.`];
  if (task.description) lines.push(task.description);
  if (task.checklist.length) lines.push(`Checklist: ${task.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`).join('; ')}`);
  return { workspaceId: task.workspaceId, projectId: task.projectId, channelId: null, title: `${task.key} ${task.title}`, pieces: [lines.join('\n')] };
}

/** One chunk per top-level message with its thread replies appended. */
async function messageContent(id: Types.ObjectId): Promise<SourceContent | null> {
  const message = await Message.findById(id).lean();
  if (!message || message.deletedAt || message.parentMessageId) return null;
  const channel = await Channel.findById(message.channelId).select('name projectId').lean();
  if (!channel) return null;
  const replies = message.replyCount
    ? await Message.find({ parentMessageId: message._id, deletedAt: null }).sort({ createdAt: 1 }).limit(50).select('body').lean()
    : [];
  const text = [message.body, ...replies.map((r) => `Reply: ${r.body}`)].join('\n').trim();
  if (text.length < MIN_MESSAGE_CHARS) return null;
  return {
    workspaceId: message.workspaceId,
    projectId: channel.projectId ?? null,
    channelId: message.channelId,
    title: `#${channel.name}`,
    pieces: chunkText(text),
  };
}

async function meetingContent(id: Types.ObjectId): Promise<SourceContent | null> {
  const meeting = await Meeting.findById(id).lean();
  if (!meeting) return null;
  const pieces = chunkText(meeting.transcript);
  if (meeting.analysis) {
    const a = meeting.analysis;
    pieces.push(
      [
        `Meeting summary: ${a.summary}`,
        ...a.decisions.map((d) => `Decision: ${d.text}`),
        ...a.actionItems.map((i) => `Action item: ${i.text}${i.ownerName ? ` (owner: ${i.ownerName})` : ''}`),
        ...a.openQuestions.map((q) => `Open question: ${q}`),
        ...a.risks.map((r) => `Risk: ${r}`),
      ].join('\n'),
    );
  }
  return { workspaceId: meeting.workspaceId, projectId: meeting.projectId, channelId: null, title: meeting.title, pieces };
}

/** Text from a PDF, or '' when it has no text layer (e.g. a scan) or cannot be parsed. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // An exact copy: pooled Buffers have a non-zero byteOffset, which this pdf.js build ignores.
    const result = await pdfParse(new Uint8Array(buffer) as Buffer, { max: MAX_PDF_PAGES });
    return result.text;
  } catch (err) {
    logger.warn({ err }, 'PDF text extraction failed');
    return '';
  }
}

/** Text-like files (`text/*`, JSON) and PDFs with a text layer. Other files are not indexed. */
async function fileContent(id: Types.ObjectId): Promise<SourceContent | null> {
  const file = await FileModel.findById(id).lean();
  if (!file || file.deletedAt) return null;
  const isPdf = file.mimeType === PDF_MIME;
  if (!isPdf && !file.mimeType.startsWith('text/') && !TEXT_MIMES.has(file.mimeType)) return null;
  const buffer = await readStoredFile(file, isPdf ? MAX_PDF_BYTES : MAX_TEXT_FILE_BYTES);
  if (!buffer) return null;
  const raw = isPdf ? await extractPdfText(buffer) : buffer.toString('utf8');
  const text = raw.replaceAll('\u0000', '').slice(0, MAX_FILE_TEXT_CHARS).trim();
  if (!text) return null;
  return { workspaceId: file.workspaceId, projectId: file.projectId, channelId: file.channelId, title: file.name, pieces: chunkText(text) };
}

const builders: Record<ChunkSourceType, (id: Types.ObjectId) => Promise<SourceContent | null>> = {
  document: documentContent,
  task: taskContent,
  message: messageContent,
  meeting: meetingContent,
  file: fileContent,
};

// ---------- indexing ----------

export async function removeSource(sourceType: ChunkSourceType, sourceId: string): Promise<void> {
  if (!Types.ObjectId.isValid(sourceId)) return;
  await Chunk.deleteMany({ sourceType, sourceId: new Types.ObjectId(sourceId) });
}

/**
 * (Re)builds the chunks for one source. Unchanged content (same hash, embedded when embeddings
 * are on) is skipped. Missing, deleted or empty sources have their chunks removed.
 */
export async function indexSource(sourceType: ChunkSourceType, sourceId: string): Promise<number> {
  if (!Types.ObjectId.isValid(sourceId)) return 0;
  const id = new Types.ObjectId(sourceId);
  const content = await builders[sourceType](id);
  if (!content || content.pieces.length === 0) {
    await Chunk.deleteMany({ sourceType, sourceId: id });
    return 0;
  }

  const hash = contentHash([content.title, String(content.projectId), ...content.pieces]);
  const existing = await Chunk.findOne({ sourceType, sourceId: id }).select('contentHash embedding').lean();
  const wantsEmbedding = features.embeddings;
  if (existing && existing.contentHash === hash && (!wantsEmbedding || existing.embedding?.length)) {
    return 0;
  }

  let vectors: number[][] | null = null;
  if (wantsEmbedding) {
    try {
      vectors = await embed(content.pieces.map((p) => `${content.title}\n${p}`), 'document');
    } catch (err) {
      // Keyword retrieval still works; the next change to the source retries the embedding.
      logger.warn({ err, sourceType, sourceId }, 'Embedding failed; indexing without vectors');
    }
  }

  const now = new Date();
  const docs: IChunk[] = content.pieces.map((text, ordinal) => ({
    workspaceId: content.workspaceId,
    projectId: content.projectId,
    sourceType,
    sourceId: id,
    channelId: content.channelId,
    title: content.title,
    text,
    ordinal,
    tokenEstimate: estimateTokens(text),
    embedding: vectors?.[ordinal] ?? null,
    embeddingModel: vectors ? env.VOYAGE_MODEL : null,
    contentHash: hash,
    createdAt: now,
    updatedAt: now,
  }));
  // Upsert by (source, ordinal) then trim, so overlapping runs for one source cannot collide.
  await Chunk.bulkWrite(
    docs.map((doc) => ({
      replaceOne: { filter: { sourceType, sourceId: id, ordinal: doc.ordinal }, replacement: doc, upsert: true },
    })),
  );
  await Chunk.deleteMany({ sourceType, sourceId: id, ordinal: { $gte: docs.length } });
  return docs.length;
}

/** Rebuilds every chunk in a workspace (OWNER/ADMIN "reindex"). */
export async function reindexWorkspace(workspaceId: string): Promise<number> {
  const ws = new Types.ObjectId(workspaceId);
  await Chunk.deleteMany({ workspaceId: ws });
  const [docs, tasks, messages, meetings, files] = await Promise.all([
    DocumentModel.find({ workspaceId: ws, isArchived: false }).select('_id').lean(),
    Task.find({ workspaceId: ws }).select('_id').lean(),
    Message.find({ workspaceId: ws, parentMessageId: null, deletedAt: null }).select('_id').lean(),
    Meeting.find({ workspaceId: ws }).select('_id').lean(),
    FileModel.find({ workspaceId: ws, deletedAt: null }).select('_id').lean(),
  ]);
  const work: [ChunkSourceType, Types.ObjectId[]][] = [
    ['document', docs.map((d) => d._id)],
    ['task', tasks.map((d) => d._id)],
    ['message', messages.map((d) => d._id)],
    ['meeting', meetings.map((d) => d._id)],
    ['file', files.map((d) => d._id)],
  ];
  let total = 0;
  for (const [type, ids] of work) {
    for (const id of ids) {
      try {
        total += await indexSource(type, String(id));
      } catch (err) {
        logger.warn({ err, type, id: String(id) }, 'Reindex of source failed');
      }
    }
  }
  return total;
}

// ---------- retrieval ----------

export interface RetrieveInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  query: string;
  projectId?: string | null;
  sourceTypes?: ChunkSourceType[];
  limit?: number;
}

export interface RetrievedItem {
  sourceType: ChunkSourceType;
  sourceId: string;
  projectId: string | null;
  title: string;
  text: string;
  link: string;
  score: number;
}

const RRF_K = 60;
const CANDIDATES = 50;
const LOCAL_VECTOR_CAP = 5000;
const ITEM_TEXT_CHARS = 1500;

/** The chunk filter for what `userId` may see: project access for project content, channel access for messages. */
async function visibilityFilter(input: RetrieveInput): Promise<FilterQuery<IChunk>> {
  const ws = new Types.ObjectId(input.workspaceId);
  const user = new Types.ObjectId(input.userId);
  const types = input.sourceTypes?.length ? input.sourceTypes : undefined;

  let projectScope: FilterQuery<IChunk> = {};
  if (input.projectId) {
    projectScope = { projectId: new Types.ObjectId(input.projectId) };
  } else if (!canSeeAllProjects(input.role)) {
    const projects = await Project.find({ workspaceId: ws, memberIds: user }).select('_id').lean();
    projectScope = { $or: [{ projectId: null }, { projectId: { $in: projects.map((p) => p._id) } }] };
  }

  const channels = await Channel.find({ workspaceId: ws, $or: [{ type: 'PUBLIC' }, { memberIds: user }] }).select('_id').lean();
  const channelIds = channels.map((c) => c._id);

  return {
    workspaceId: ws,
    ...(types ? { sourceType: { $in: types } } : {}),
    ...(input.projectId ? projectScope : {}),
    $or: [
      { sourceType: 'message', channelId: { $in: channelIds } },
      { sourceType: { $ne: 'message' }, ...(input.projectId ? {} : projectScope) },
    ],
  };
}

function linkFor(c: Pick<ChunkLean, 'sourceType' | 'sourceId' | 'workspaceId' | 'projectId' | 'channelId'>): string {
  const ws = String(c.workspaceId);
  switch (c.sourceType) {
    case 'task':
      return links.task(ws, String(c.projectId), String(c.sourceId));
    case 'document':
      return links.document(ws, String(c.sourceId));
    case 'message':
      return links.message(ws, String(c.channelId));
    case 'meeting':
      return links.meeting(ws, String(c.sourceId));
    case 'file':
      return links.file(ws);
  }
}

async function keywordCandidates(filter: FilterQuery<IChunk>, query: string): Promise<ChunkLean[]> {
  if (query.length >= 3) {
    const hits = await Chunk.find({ ...filter, $text: { $search: query } }, { score: { $meta: 'textScore' }, embedding: 0 })
      .sort({ score: { $meta: 'textScore' } })
      .limit(CANDIDATES)
      .lean();
    if (hits.length) return hits;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Chunk.find({ ...filter, text: new RegExp(escaped, 'i') }, { embedding: 0 }).sort({ updatedAt: -1 }).limit(CANDIDATES).lean();
}

async function vectorCandidates(filter: FilterQuery<IChunk>, input: RetrieveInput): Promise<ChunkLean[]> {
  const [vector] = await embed([input.query], 'query');
  if (!vector) return [];

  if (env.VECTOR_SEARCH === 'atlas') {
    const prefilter: Record<string, unknown> = { workspaceId: new Types.ObjectId(input.workspaceId) };
    if (input.projectId) prefilter.projectId = new Types.ObjectId(input.projectId);
    if (input.sourceTypes?.length) prefilter.sourceType = { $in: input.sourceTypes };
    const pipeline: PipelineStage[] = [
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'embedding',
          queryVector: vector,
          numCandidates: CANDIDATES * 10,
          limit: CANDIDATES * 2,
          filter: prefilter,
        },
      } as unknown as PipelineStage,
      { $match: filter },
      { $limit: CANDIDATES },
      { $project: { embedding: 0 } },
    ];
    return Chunk.aggregate<ChunkLean>(pipeline);
  }

  const rows = await Chunk.find({ ...filter, embedding: { $ne: null } }).sort({ updatedAt: -1 }).limit(LOCAL_VECTOR_CAP).lean();
  return rows
    .map((row) => ({ row, score: cosine(vector, row.embedding ?? []) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES)
    .map(({ row }) => ({ ...row, embedding: null }));
}

/** Reciprocal-rank fusion of several ranked lists, keyed by chunk id. */
function fuse(lists: ChunkLean[][]): { chunk: ChunkLean; score: number }[] {
  const scores = new Map<string, { chunk: ChunkLean; score: number }>();
  for (const list of lists) {
    list.forEach((chunk, rank) => {
      const key = String(chunk._id);
      const entry = scores.get(key) ?? { chunk, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      scores.set(key, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}

/** Phase 2 keyword search mapped to retrieval items (used when embeddings are not configured). */
async function searchFallback(input: RetrieveInput, limit: number): Promise<RetrievedItem[]> {
  const wanted = new Set(input.sourceTypes?.length ? input.sourceTypes : ['task', 'document', 'message', 'file', 'meeting']);
  const types = (['tasks', 'documents', 'messages', 'files'] as const).filter((t) => wanted.has(t.slice(0, -1) as ChunkSourceType));
  const q = input.query.slice(0, 100);
  const ws = input.workspaceId;
  const items: RetrievedItem[] = [];

  if (types.length) {
    const res = await search(ws, input.userId, input.role, { q, types: [...types], projectId: input.projectId ?? undefined, limit: Math.min(limit, 25) });
    for (const t of res.tasks) {
      items.push({ sourceType: 'task', sourceId: t.id, projectId: t.projectId, title: `${t.key} ${t.title}`, text: [t.title, t.description ?? ''].join('\n').slice(0, ITEM_TEXT_CHARS), link: links.task(ws, t.projectId, t.id), score: 0 });
    }
    for (const d of res.documents) {
      items.push({ sourceType: 'document', sourceId: d.id, projectId: d.projectId, title: d.title, text: d.excerpt, link: links.document(ws, d.id), score: 0 });
    }
    for (const m of res.messages) {
      items.push({ sourceType: 'message', sourceId: m.id, projectId: null, title: `#${m.channelName}`, text: `${m.author?.name ?? 'Someone'}: ${m.snippet}`, link: links.message(ws, m.channelId), score: 0 });
    }
    for (const f of res.files) {
      items.push({ sourceType: 'file', sourceId: f.id, projectId: f.projectId, title: f.name, text: f.name, link: links.file(ws), score: 0 });
    }
  }
  // Meetings are not covered by Phase 2 search; their chunks are always indexed.
  if (wanted.has('meeting')) {
    const filter = await visibilityFilter({ ...input, sourceTypes: ['meeting'] });
    for (const c of (await keywordCandidates(filter, q)).slice(0, limit)) items.push(toItem(c, 0, q));
  }
  return items.slice(0, limit);
}

function toItem(c: ChunkLean, score: number, query: string): RetrievedItem {
  return {
    sourceType: c.sourceType,
    sourceId: String(c.sourceId),
    projectId: c.projectId ? String(c.projectId) : null,
    title: c.title,
    text: c.text.length > ITEM_TEXT_CHARS ? makeSnippet(c.text, query, ITEM_TEXT_CHARS) : c.text,
    link: linkFor(c),
    score,
  };
}

/**
 * Ranked workspace content for `query`, limited to what the caller may see. Hybrid (vector +
 * keyword, reciprocal-rank fusion) when embeddings are configured; otherwise Phase 2 search.
 */
export async function retrieve(input: RetrieveInput): Promise<RetrievedItem[]> {
  const limit = Math.min(input.limit ?? 8, 25);
  const query = input.query.trim();
  if (!query) return [];
  if (input.projectId) {
    const project = await Project.findOne({ _id: input.projectId, workspaceId: input.workspaceId }).select('memberIds').lean();
    if (!project || !hasProjectAccess(project, input.role, input.userId)) return [];
  }
  if (!features.embeddings) return searchFallback(input, limit);

  const filter = await visibilityFilter(input);
  const [keyword, vector] = await Promise.all([
    keywordCandidates(filter, query),
    vectorCandidates(filter, input).catch((err) => {
      logger.warn({ err }, 'Vector retrieval failed; using keyword results only');
      return [] as ChunkLean[];
    }),
  ]);

  // One item per source: the best-scoring chunk represents it.
  const seen = new Set<string>();
  const out: RetrievedItem[] = [];
  for (const { chunk, score } of fuse([vector, keyword])) {
    const key = `${chunk.sourceType}:${String(chunk.sourceId)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toItem(chunk, score, query));
    if (out.length >= limit) break;
  }
  return out;
}

export function toSourceDto(item: RetrievedItem): AiSourceDto {
  return {
    type: item.sourceType,
    id: item.sourceId,
    title: item.title,
    link: item.link,
    snippet: item.text.length > 160 ? `${item.text.slice(0, 159)}…` : item.text,
  };
}

import { z } from 'zod';
import type { summarizeSchema } from '@nexus/shared';
import {
  aiUsageQuerySchema,
  conversationListQuerySchema,
  hasPermission,
  type AiStatusDto,
  type AiStreamEvent,
  type CommitGeneratedTasksInput,
  type CreateConversationInput,
  type GenerateTasksInput,
  type SendAiMessageInput,
} from '@nexus/shared';
import { env, features } from '../../config/env';
import { logger } from '../../config/logger';
import { captureError } from '../../config/sentry';
import { getAuthUser, getMemberRole, getProjectContext, getWorkspaceContext } from '../../middleware/authorize';
import { typedQuery } from '../../middleware/validate';
import { enqueue } from '../../jobs';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { created, noContent, ok } from '../../utils/response';
import { assertAiEnabled, consumeAiQuota } from './ai.client';
import * as assistant from './assistant.service';
import * as insights from './insights.service';
import * as taskgen from './taskgen.service';
import { workspaceUsage } from './usage.service';

export const insightQuerySchema = z.object({ refresh: z.enum(['true', 'false']).optional() });
export const digestQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
export const renameConversationSchema = z.object({ title: z.string().trim().min(1).max(120) });

const HEARTBEAT_MS = 15_000;

export const status = asyncHandler(async (_req, res) => {
  const dto: AiStatusDto = { enabled: features.ai, semanticSearch: features.embeddings, model: env.AI_MODEL };
  ok(res, dto);
});

// ---------- conversations ----------

export const listConversations = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { items, meta } = await assistant.listConversations(ws.id, user.id, typedQuery(req, conversationListQuerySchema));
  ok(res, items, meta);
});

export const createConversation = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  created(res, await assistant.createConversation(ws.id, user.id, ws.role, req.body as CreateConversationInput));
});

/** The conversation's owner must still be a workspace member with ai:use. */
async function loadOwnedConversation(req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) {
  const user = getAuthUser(req);
  const conversation = await assistant.loadOwnConversation(req.params.id ?? '', user.id);
  const role = await getMemberRole(String(conversation.workspaceId), user.id);
  if (!role) throw ApiError.notFound('Conversation');
  if (!hasPermission(role, 'ai:use')) throw ApiError.forbidden();
  return { conversation, role };
}

export const getConversation = asyncHandler(async (req, res) => {
  const { conversation } = await loadOwnedConversation(req);
  ok(res, await assistant.getConversationDetail(conversation));
});

export const renameConversation = asyncHandler(async (req, res) => {
  const { conversation } = await loadOwnedConversation(req);
  ok(res, await assistant.renameConversation(conversation, (req.body as z.infer<typeof renameConversationSchema>).title));
});

export const deleteConversation = asyncHandler(async (req, res) => {
  const { conversation } = await loadOwnedConversation(req);
  await assistant.deleteConversation(conversation);
  noContent(res);
});

/**
 * Streams one assistant turn as Server-Sent Events. Access, scope and quota are checked before
 * the stream opens, so those failures are ordinary JSON errors; later failures are `error` events.
 */
export const sendMessage = asyncHandler(async (req, res) => {
  assertAiEnabled();
  const { conversation, role } = await loadOwnedConversation(req);
  await assistant.assertConversationAccess(conversation, role);
  await consumeAiQuota(String(conversation.workspaceId));

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  // `close` on the response fires when the client goes away before we finish.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  const emit = (event: AiStreamEvent) => {
    if (!res.writableEnded && !abort.signal.aborted) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    await assistant.runTurn({ conversation, role, content: (req.body as SendAiMessageInput).content, emit, signal: abort.signal });
  } catch (err) {
    // Headers are already sent, so failures outside the model loop (e.g. a database error)
    // become a stream event instead of reaching the JSON error handler.
    logger.error({ err }, 'Assistant turn failed');
    captureError(err, { conversationId: String(conversation._id) });
    emit({ type: 'error', code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ---------- task generation ----------

export const generateTasks = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  ok(res, await taskgen.generateTasks(getProjectContext(req), user.id, ws.role, req.body as GenerateTasksInput));
});

export const commitTasks = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  created(res, await taskgen.commitTasks(getProjectContext(req), user.id, req.body as CommitGeneratedTasksInput));
});

// ---------- summaries, insights, digest ----------

export const summarizeDocument = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  if (!req.document) throw ApiError.internal('Document context missing');
  const { length } = req.body as z.infer<typeof summarizeSchema>;
  ok(res, await insights.summarizeDocument(req.document, user.id, length));
});

export const projectInsights = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { refresh } = typedQuery(req, insightQuerySchema);
  ok(res, await insights.projectInsights(getProjectContext(req), user.id, ws.role, refresh === 'true'));
});

export const workspaceDigest = asyncHandler(async (req, res) => {
  const user = getAuthUser(req);
  const ws = getWorkspaceContext(req);
  const { days } = typedQuery(req, digestQuerySchema);
  ok(res, await insights.workspaceDigest(ws.id, user.id, ws.role, days));
});

export const usage = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  const { days } = typedQuery(req, aiUsageQuerySchema);
  ok(res, await workspaceUsage(ws.id, days));
});

export const reindexWorkspace = asyncHandler(async (req, res) => {
  const ws = getWorkspaceContext(req);
  await enqueue('rag.reindexWorkspace', { workspaceId: ws.id }, { jobId: `rag:reindex:${ws.id}` });
  res.status(202).json({ success: true, data: { queued: true } });
});

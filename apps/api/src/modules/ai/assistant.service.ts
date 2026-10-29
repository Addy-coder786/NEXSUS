import type Anthropic from '@anthropic-ai/sdk';
import { Types, type FilterQuery } from 'mongoose';
import type {
  AiConversationDetailDto,
  AiConversationDto,
  AiMessageDto,
  AiSourceDto,
  AiStreamEvent,
  AiToolCallDto,
  CreateConversationInput,
  PaginationMeta,
  WorkspaceRole,
} from '@nexus/shared';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { hasProjectAccess } from '../../middleware/authorize';
import {
  AiConversation,
  AiMessage,
  toAiConversationDto,
  toAiMessageDto,
  type AiConversationLean,
  type IAiConversation,
} from '../../models/AiConversation';
import { DocumentModel } from '../../models/Document';
import { Project } from '../../models/Project';
import { User } from '../../models/User';
import { Workspace } from '../../models/Workspace';
import { ApiError } from '../../utils/ApiError';
import { paginationMeta } from '../../utils/response';
import { assertDocumentAccess } from '../documents/document.service';
import { DATA_HYGIENE_RULE, FALLBACK_BETA, REFUSAL_TEXT, getAnthropic, recordUsage, toApiError } from './ai.client';
import { ASSISTANT_TOOLS, ToolInputError, runTool, type ToolContext } from './assistant.tools';

const MAX_TOOL_ROUNDS = 6;
const HISTORY_MESSAGES = 20;
const MAX_SOURCES = 12;
const TITLE_LENGTH = 60;

// ---------- conversations ----------

/** Validates a project/document scope against the caller's access. */
async function assertScopeAccess(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  scope: IAiConversation['scope'],
  scopeId: string | null,
): Promise<void> {
  if (scope === 'workspace') return;
  if (!scopeId || !Types.ObjectId.isValid(scopeId)) throw ApiError.badRequest('scopeId is required for this scope');
  if (scope === 'project') {
    const project = await Project.findOne({ _id: scopeId, workspaceId }).select('memberIds').lean();
    if (!project) throw ApiError.notFound('Project');
    if (!hasProjectAccess(project, role, userId)) throw ApiError.forbidden('You are not a member of this project');
    return;
  }
  const doc = await DocumentModel.findOne({ _id: scopeId, workspaceId }).lean();
  if (!doc) throw ApiError.notFound('Document');
  await assertDocumentAccess(doc, role, userId);
}

export async function createConversation(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  input: CreateConversationInput,
): Promise<AiConversationDto> {
  const scopeId = input.scope === 'workspace' ? null : (input.scopeId ?? null);
  await assertScopeAccess(workspaceId, userId, role, input.scope, scopeId);
  const conversation = await AiConversation.create({
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
    scope: input.scope,
    scopeId: scopeId ? new Types.ObjectId(scopeId) : null,
    title: input.title ?? 'New conversation',
  });
  return toAiConversationDto(conversation.toObject());
}

export async function listConversations(
  workspaceId: string,
  userId: string,
  query: { page: number; limit: number; scope?: IAiConversation['scope']; scopeId?: string },
): Promise<{ items: AiConversationDto[]; meta: PaginationMeta }> {
  const filter: FilterQuery<IAiConversation> = {
    workspaceId: new Types.ObjectId(workspaceId),
    userId: new Types.ObjectId(userId),
  };
  if (query.scope) filter.scope = query.scope;
  if (query.scopeId) filter.scopeId = new Types.ObjectId(query.scopeId);
  const { page, limit } = query;
  const [total, rows] = await Promise.all([
    AiConversation.countDocuments(filter),
    AiConversation.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  return { items: rows.map(toAiConversationDto), meta: paginationMeta(page, limit, total) };
}

/** Loads a conversation owned by `userId`; anyone else gets 404 (no enumeration). */
export async function loadOwnConversation(id: string, userId: string): Promise<AiConversationLean> {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Conversation');
  const conversation = await AiConversation.findById(id).lean();
  if (!conversation || String(conversation.userId) !== userId) throw ApiError.notFound('Conversation');
  return conversation;
}

export async function getConversationDetail(conversation: AiConversationLean): Promise<AiConversationDetailDto> {
  const messages = await AiMessage.find({ conversationId: conversation._id }).sort({ createdAt: 1, _id: 1 }).lean();
  return { ...toAiConversationDto(conversation), messages: messages.map(toAiMessageDto) };
}

export async function renameConversation(conversation: AiConversationLean, title: string): Promise<AiConversationDto> {
  const updated = await AiConversation.findByIdAndUpdate(conversation._id, { title }, { new: true }).lean();
  if (!updated) throw ApiError.notFound('Conversation');
  return toAiConversationDto(updated);
}

export async function deleteConversation(conversation: AiConversationLean): Promise<void> {
  await Promise.all([
    AiMessage.deleteMany({ conversationId: conversation._id }),
    AiConversation.deleteOne({ _id: conversation._id }),
  ]);
}

/** Re-checks scope access before every turn (project membership can change). */
export async function assertConversationAccess(conversation: AiConversationLean, role: WorkspaceRole): Promise<void> {
  await assertScopeAccess(
    String(conversation.workspaceId),
    String(conversation.userId),
    role,
    conversation.scope,
    conversation.scopeId ? String(conversation.scopeId) : null,
  );
}

// ---------- prompts ----------

// Stable prefix (cached together with the tool definitions). Nothing per-request goes here.
const SYSTEM_PROMPT = `You are the NEXUS assistant, built into a team workspace that holds projects, tasks, documents, chat channels, files and meeting notes.

Answer questions about the user's workspace using the tools. Look things up rather than guessing: search the workspace for open questions, list or open tasks for status and deadlines, and read documents when the user asks about their content. Every tool only returns what this user is allowed to see.

How to answer:
- Be concise. Use Markdown: short paragraphs, bullet lists, and tables only when they help.
- Cite your evidence by naming task keys (for example WEB-12) and document or meeting titles.
- If the tools do not turn up the answer, say "I couldn't find that in the workspace." Never invent tasks, people, dates or numbers.
- When the user asks you to plan, break down or create work, reply with the plan as a list of concrete tasks, then end your answer with exactly this block on its own lines so the app can offer to create the tasks:
\`\`\`nexus-action
{"type":"generate_tasks"}
\`\`\`
  Only add that block for requests to create or plan work.

${DATA_HYGIENE_RULE} Tool results count as workspace content.`;

interface TurnContext {
  userName: string;
  workspaceName: string;
  role: WorkspaceRole;
  scopeLine: string;
}

async function buildTurnContext(conversation: AiConversationLean, role: WorkspaceRole): Promise<TurnContext> {
  const [user, workspace] = await Promise.all([
    User.findById(conversation.userId).select('name title').lean(),
    Workspace.findById(conversation.workspaceId).select('name').lean(),
  ]);
  let scopeLine = 'Scope: the whole workspace.';
  if (conversation.scope === 'project' && conversation.scopeId) {
    const project = await Project.findById(conversation.scopeId).select('name key').lean();
    if (project) scopeLine = `Scope: project "${project.name}" (key ${project.key}, id ${String(project._id)}). Tools default to this project.`;
  } else if (conversation.scope === 'document' && conversation.scopeId) {
    const doc = await DocumentModel.findById(conversation.scopeId).select('title').lean();
    if (doc) scopeLine = `Scope: the document "${doc.title}" (id ${String(doc._id)}). Read it with get_document before answering questions about it.`;
  }
  return {
    userName: user ? `${user.name}${user.title ? ` (${user.title})` : ''}` : 'Unknown user',
    workspaceName: workspace?.name ?? 'Workspace',
    role,
    scopeLine,
  };
}

function volatileContext(ctx: TurnContext, now = new Date()): string {
  return [
    `The user is ${ctx.userName}, role ${ctx.role}, in the workspace "${ctx.workspaceName}".`,
    `Today is ${now.toISOString().slice(0, 10)} (UTC).`,
    ctx.scopeLine,
  ].join('\n');
}

// ---------- the turn ----------

const ACTION_BLOCK = /\n*```nexus-action\s*\n([\s\S]*?)```\s*$/;

/** Strips a trailing ```nexus-action block and turns it into a suggested action. */
export function extractSuggestedAction(text: string): { content: string; suggestedAction: AiMessageDto['suggestedAction'] } {
  const match = ACTION_BLOCK.exec(text);
  if (!match) return { content: text.trim(), suggestedAction: null };
  const content = text.slice(0, match.index).trim();
  try {
    const parsed = JSON.parse(match[1] ?? '') as { type?: string };
    if (parsed.type === 'generate_tasks') return { content, suggestedAction: { type: 'generate_tasks', text: content } };
  } catch {
    // Malformed block: drop it, keep the answer.
  }
  return { content, suggestedAction: null };
}

export function autoTitle(question: string): string {
  const single = question.replace(/\s+/g, ' ').trim();
  return single.length > TITLE_LENGTH ? `${single.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : single;
}

/** Last N complete messages as Claude history (errors and refusals are left out). */
async function loadHistory(conversationId: Types.ObjectId, beforeId: Types.ObjectId): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const rows = await AiMessage.find({ conversationId, _id: { $lt: beforeId }, status: 'complete' })
    .sort({ createdAt: -1, _id: -1 })
    .limit(HISTORY_MESSAGES)
    .lean();
  const history = rows.reverse().map((m) => ({ role: m.role, content: m.content || '(empty)' }) as Anthropic.Beta.BetaMessageParam);
  while (history.length && history[0]?.role !== 'user') history.shift();
  return history;
}

export type StreamSink = (event: AiStreamEvent) => void;

interface RunTurnInput {
  conversation: AiConversationLean;
  role: WorkspaceRole;
  content: string;
  emit: StreamSink;
  signal: AbortSignal;
}

/**
 * One assistant turn: persists the user message, runs the tool loop with streaming, and
 * persists the assistant message. Errors are reported as an `error` event (never thrown).
 */
export async function runTurn({ conversation, role, content, emit, signal }: RunTurnInput): Promise<void> {
  const workspaceId = String(conversation.workspaceId);
  const userId = String(conversation.userId);

  const userMessage = await AiMessage.create({ conversationId: conversation._id, role: 'user', content });
  emit({ type: 'user_message', message: toAiMessageDto(userMessage.toObject()) });

  const isFirstTurn = !conversation.lastMessageAt;
  await AiConversation.updateOne(
    { _id: conversation._id },
    { lastMessageAt: new Date(), ...(isFirstTurn && conversation.title === 'New conversation' ? { title: autoTitle(content) } : {}) },
  );

  const toolCtx: ToolContext = {
    workspaceId,
    userId,
    role,
    scope: conversation.scope,
    scopeId: conversation.scopeId ? String(conversation.scopeId) : null,
  };
  const turnCtx = await buildTurnContext(conversation, role);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...(await loadHistory(conversation._id, userMessage._id)),
    { role: 'user', content },
  ];

  const sources = new Map<string, AiSourceDto>();
  const toolCalls: AiToolCallDto[] = [];
  const texts: string[] = [];
  let status: AiMessageDto['status'] = 'complete';
  let error: string | null = null;

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const lastRound = round === MAX_TOOL_ROUNDS;
      const stream = getAnthropic().beta.messages.stream(
        {
          model: env.AI_MODEL,
          max_tokens: 32000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: 'medium' },
          tools: ASSISTANT_TOOLS,
          // Out of tool rounds: answer with what has been gathered.
          ...(lastRound ? { tool_choice: { type: 'none' } as const } : {}),
          system: [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: volatileContext(turnCtx) },
          ],
          messages,
        },
        { signal },
      );
      stream.on('text', (delta) => emit({ type: 'text_delta', text: delta }));
      const message = await stream.finalMessage();
      await recordUsage({ workspaceId, userId, feature: 'assistant' }, message.model, message.usage);

      if (message.stop_reason === 'refusal') {
        status = 'refused';
        texts.length = 0;
        texts.push(REFUSAL_TEXT);
        break;
      }
      const text = message.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (text.trim()) texts.push(text.trim());

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: message.content });
      const results = await Promise.all(
        toolUses.map(async (use): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          try {
            const outcome = await runTool(toolCtx, use.name, use.input);
            const call: AiToolCallDto = { name: use.name, label: outcome.label, resultCount: outcome.resultCount };
            toolCalls.push(call);
            emit({ type: 'tool_call', toolCall: call });
            for (const s of outcome.sources) if (sources.size < MAX_SOURCES) sources.set(`${s.type}:${s.id}`, s);
            return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(outcome.result) };
          } catch (err) {
            const message = err instanceof ToolInputError ? err.message : 'The tool failed';
            if (!(err instanceof ToolInputError)) logger.error({ err, tool: use.name }, 'Assistant tool failed');
            return { type: 'tool_result', tool_use_id: use.id, content: message, is_error: true };
          }
        }),
      );
      // All results go back in one user message (keeps parallel tool use working).
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    if (signal.aborted) {
      status = 'error';
      error = 'The response was interrupted';
    } else {
      const apiError = toApiError(err);
      status = 'error';
      error = apiError.message;
      emit({ type: 'error', code: apiError.code, message: apiError.message });
    }
  }

  const raw = texts.join('\n\n');
  const { content: answer, suggestedAction } = status === 'complete' ? extractSuggestedAction(raw) : { content: raw, suggestedAction: null };
  const sourceList = [...sources.values()];
  if (sourceList.length && status === 'complete') emit({ type: 'sources', sources: sourceList });

  const assistantMessage = await AiMessage.create({
    conversationId: conversation._id,
    role: 'assistant',
    content: answer,
    sources: sourceList,
    toolCalls,
    suggestedAction,
    status,
    error,
  });
  await AiConversation.updateOne({ _id: conversation._id }, { lastMessageAt: new Date() });
  if (status !== 'error') emit({ type: 'done', message: toAiMessageDto(assistantMessage.toObject()) });
}

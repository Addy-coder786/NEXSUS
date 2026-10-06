import { z } from 'zod';
import { TASK_PRIORITIES, type ProjectHealth, type TaskPriority } from '../constants';
import { objectIdSchema, paginationQuerySchema } from './common';
import type { UserPublicDto } from './user';

// ---------- availability ----------

export interface AiStatusDto {
  /** LLM configured (ANTHROPIC_API_KEY or AI_ENABLED). When false every AI endpoint returns 503 AI_NOT_CONFIGURED. */
  enabled: boolean;
  /** Semantic retrieval (embeddings) configured; otherwise retrieval is keyword-based. */
  semanticSearch: boolean;
  model: string;
}

// ---------- assistant ----------

export const AI_SCOPES = ['workspace', 'project', 'document'] as const;
export type AiScope = (typeof AI_SCOPES)[number];

export const createConversationSchema = z.object({
  scope: z.enum(AI_SCOPES).default('workspace'),
  /** projectId or documentId when scope is project/document */
  scopeId: objectIdSchema.optional(),
  title: z.string().trim().max(120).optional(),
});
export const sendAiMessageSchema = z.object({
  content: z.string().trim().min(1).max(8000),
});
export const conversationListQuerySchema = paginationQuerySchema.extend({
  scope: z.enum(AI_SCOPES).optional(),
  scopeId: objectIdSchema.optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

/** A workspace entity the assistant used as evidence. Rendered as a chip that links to it. */
export interface AiSourceDto {
  type: 'task' | 'project' | 'document' | 'message' | 'file' | 'meeting';
  id: string;
  title: string;
  /** Client route, e.g. /w/:ws/projects/:p/board?task=:id */
  link: string;
  snippet: string | null;
}

/** A tool the assistant called while answering (shown as a collapsible "Looked at..." row). */
export interface AiToolCallDto {
  name: string;
  /** Short human description, e.g. "Searched tasks for “oauth”" */
  label: string;
  resultCount: number | null;
}

export interface AiMessageDto {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: AiSourceDto[];
  toolCalls: AiToolCallDto[];
  /** Suggested follow-up action the UI can offer, e.g. generate tasks from the answer. */
  suggestedAction: { type: 'generate_tasks'; text: string } | null;
  status: 'complete' | 'error' | 'refused';
  error: string | null;
  createdAt: string;
}

export interface AiConversationDto {
  id: string;
  workspaceId: string;
  scope: AiScope;
  scopeId: string | null;
  title: string;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface AiConversationDetailDto extends AiConversationDto {
  messages: AiMessageDto[];
}

/**
 * Server-Sent Events from POST /ai/conversations/:id/messages (Content-Type: text/event-stream).
 * Each SSE `data:` line is one JSON object of this union.
 */
export type AiStreamEvent =
  | { type: 'user_message'; message: AiMessageDto }
  | { type: 'tool_call'; toolCall: AiToolCallDto }
  | { type: 'text_delta'; text: string }
  | { type: 'sources'; sources: AiSourceDto[] }
  | { type: 'done'; message: AiMessageDto }
  | { type: 'error'; code: string; message: string };

// ---------- task generation ----------

export const generateTasksSchema = z.object({
  /** Free text: a feature description, a pasted discussion, or an assistant answer. */
  text: z.string().trim().min(10).max(20000).optional(),
  /** Alternatively generate from a document or a chat thread. */
  documentId: objectIdSchema.optional(),
  messageId: objectIdSchema.optional(),
  /** Extra steering, e.g. "focus on backend" */
  instructions: z.string().trim().max(500).optional(),
  maxTasks: z.number().int().min(1).max(25).default(10),
}).refine((v) => Boolean(v.text || v.documentId || v.messageId), {
  message: 'Provide text, a document or a message',
  path: ['text'],
});
export type GenerateTasksInput = z.infer<typeof generateTasksSchema>;

export interface GeneratedTaskDraft {
  /** Client-side key for selection; not persisted. */
  draftId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  /** Suggested assignee (must be a project member) or null. */
  assigneeId: string | null;
  assigneeReason: string | null;
  estimateHours: number | null;
  /** Draft ids of tasks in this batch this one depends on. */
  dependsOnDraftIds: string[];
  /** Draft id of the parent when this is a subtask. */
  parentDraftId: string | null;
  labels: string[];
}

export interface GenerateTasksResultDto {
  /** Short plan title, e.g. "Payment System" */
  summary: string;
  tasks: GeneratedTaskDraft[];
}

export const commitGeneratedTasksSchema = z.object({
  tasks: z
    .array(
      z.object({
        draftId: z.string().min(1).max(64),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().max(10000).optional(),
        priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
        assigneeId: objectIdSchema.nullable().optional(),
        estimateHours: z.number().min(0).max(1000).nullable().optional(),
        dependsOnDraftIds: z.array(z.string()).max(20).optional(),
        parentDraftId: z.string().nullable().optional(),
        dueDate: z.coerce.date().nullable().optional(),
      }),
    )
    .min(1)
    .max(25),
  /** Provenance shown on each task and in notifications */
  source: z.object({ type: z.enum(['text', 'document', 'message', 'meeting', 'assistant']), id: z.string().optional() }).optional(),
});
export type CommitGeneratedTasksInput = z.infer<typeof commitGeneratedTasksSchema>;

// ---------- meetings ----------

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  projectId: objectIdSchema.nullable().optional(),
  occurredAt: z.coerce.date().optional(),
  /** Raw transcript or notes ("Name: line" per line works best). */
  transcript: z.string().trim().min(20).max(200_000),
  attendeeIds: z.array(objectIdSchema).max(100).optional(),
});
export const meetingListQuerySchema = paginationQuerySchema.extend({
  projectId: objectIdSchema.optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export interface MeetingActionItemDto {
  id: string;
  text: string;
  ownerName: string | null;
  /** Resolved workspace member, when the owner name matches one */
  ownerId: string | null;
  dueHint: string | null;
  priority: TaskPriority;
  /** Set once converted to a task */
  taskId: string | null;
}

export interface MeetingAnalysisDto {
  summary: string;
  decisions: { text: string; context: string | null }[];
  actionItems: MeetingActionItemDto[];
  openQuestions: string[];
  risks: string[];
}

export interface MeetingDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  occurredAt: string;
  attendees: UserPublicDto[];
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  error: string | null;
  analysis: MeetingAnalysisDto | null;
  createdBy: UserPublicDto;
  createdAt: string;
}

export interface MeetingDetailDto extends MeetingDto {
  transcript: string;
}

export const convertActionItemsSchema = z.object({
  actionItemIds: z.array(z.string().min(1)).min(1).max(50),
  projectId: objectIdSchema,
});

// ---------- summaries & insights ----------

export const summarizeSchema = z.object({
  length: z.enum(['short', 'detailed']).default('short'),
});

export interface DocumentSummaryResultDto {
  documentId: string;
  version: number;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  generatedAt: string;
}

export interface ProjectInsightDto {
  projectId: string;
  health: ProjectHealth;
  score: number;
  /** One paragraph, plain language */
  narrative: string;
  blockers: { taskId: string | null; text: string }[];
  risks: string[];
  recommendations: string[];
  /** "This week" digest */
  recentHighlights: string[];
  generatedAt: string;
  /** True when served from the cache */
  cached: boolean;
}

export interface WorkspaceDigestDto {
  workspaceId: string;
  periodDays: number;
  summary: string;
  highlights: string[];
  atRiskProjects: { projectId: string; name: string; reason: string }[];
  generatedAt: string;
}

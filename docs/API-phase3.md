# NEXUS API Contract — Phase 3 (AI, RAG, production)

Extends `docs/API.md` and `docs/API-phase2.md`. DTOs and Zod schemas: `packages/shared/src/schemas/ai.ts`.
Permissions: `ai:use`, `ai:generate`, `meeting:create`, `meeting:delete` (+ existing ones).

## AI configuration

| Env | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Enables AI (`features.ai`). `AI_ENABLED=true` force-enables when credentials come from an `ant auth login` profile or workload identity. |
| `AI_MODEL` | Default `claude-opus-5-5`. |
| `AI_DAILY_LIMIT` | Per-workspace AI requests per day (assistant turns, generations, analyses, summaries). 429 `RATE_LIMITED` beyond it. Counter in `cache` keyed by workspace + UTC date. |
| `VOYAGE_API_KEY`, `VOYAGE_MODEL` | Enables embeddings (`features.embeddings`) via Voyage AI `POST https://api.voyageai.com/v1/embeddings` (`input_type: document` for indexing, `query` for search). |
| `VECTOR_SEARCH` | `local` (default): cosine similarity in-process over the workspace's chunk embeddings (cap 5000 candidates, prefilter by workspace + visibility). `atlas`: `$vectorSearch` on index `nexus_chunks_vector` (path `embedding`, filter fields `workspaceId`, `projectId`, `sourceType`). |

When `features.ai` is false, every `/ai/*` and meeting-analysis endpoint returns **503** `{ code: 'AI_NOT_CONFIGURED' }` except `GET /ai/status`. Without embeddings, retrieval falls back to the Phase 2 search service (Mongo `$text` / regex) — the assistant still works.

### Claude API usage rules (from the claude-api skill; do not deviate)

- Official SDK `@anthropic-ai/sdk` (installed, 0.131). Model from `env.AI_MODEL`.
- Thinking: omit `thinking` (Opus 5.5 always runs adaptive; `{type:'disabled'}` and `budget_tokens` return 400). Set `output_config.effort` **explicitly**: `medium` for the assistant and insights, `low` for summaries and classification-like extraction, `high` for task generation and meeting analysis.
- **No forced `tool_choice`** (`any`/`tool` return 400 on Opus 5.5). Use `auto` with the instruction in the prompt.
- Structured outputs via `output_config.format` (JSON schema) for task generation, meeting analysis, summaries and insights. Never assistant prefill (400).
- Refusal handling: always check `stop_reason` before reading content; `refusal` → message status `refused`, user-facing text "I can't help with that request." Enable server-side fallbacks by default: `client.beta.messages.*` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`.
- Streaming for the assistant (`client.beta.messages.stream(...)`), `max_tokens` 16000 for non-streaming calls, 32000 for the streamed assistant.
- Prompt caching: stable system prompt + tool definitions first with `cache_control: { type: 'ephemeral' }`; volatile context (workspace snapshot, retrieved chunks, date) after the breakpoint.
- Typed SDK errors: `Anthropic.RateLimitError` → 429 to client, `Anthropic.APIConnectionError`/5xx → 502 `AI_UNAVAILABLE`, others → 500. Never leak provider messages.
- Prompt-injection hygiene: workspace content (messages, documents, transcripts) is wrapped in clearly delimited `<workspace_data>` blocks and the system prompt says to treat it as data, never as instructions.
- Every LLM call logs `usage` (input/output/cache tokens) to `AiUsage` (workspaceId, userId, feature, tokens, model, createdAt) for cost tracking.

## RAG

Model `Chunk` (`apps/api/src/models/Chunk.ts`): `{ workspaceId, projectId|null, sourceType: 'document'|'message'|'task'|'meeting'|'file', sourceId, channelId|null (messages), title, text, ordinal, tokenEstimate, embedding: number[] | null, embeddingModel|null, contentHash, updatedAt }`. Indexes: `{ workspaceId, sourceType, sourceId }`, text index on `text`+`title`, unique `{ sourceType, sourceId, ordinal }`.

- Chunking: documents by heading/paragraph boundaries, ~800 tokens (≈3200 chars) with 15 % overlap; tasks = one chunk (title + description + checklist + key); messages = one chunk per top-level message with thread replies appended (skip < 20 chars); meetings = transcript chunks + one analysis chunk; files = PDF/text extraction only for `text/*`, `application/json`, and PDFs (via `pdf-parse`; scanned PDFs without a text layer yield nothing).
- Indexing is event-driven (`modules/rag/rag.listeners.ts`): `task.created/updated`, `document.updated`, `message.created/updated`, `file.uploaded`, `meeting analyzed` → `enqueue('rag.index', …)`; deletes → `rag.remove`. `contentHash` skips unchanged content. Embeddings batched (≤ 128 inputs/request). In tests, embeddings are mocked.
- `retrieve({ workspaceId, userId, query, projectId?, limit })` returns ranked chunks **filtered by what the user may see** (project access via `hasProjectAccess`, channel access via `canAccessChannel` rules, workspace membership). Hybrid when embeddings exist: vector score + keyword score with reciprocal-rank fusion.
- `POST /ai/workspaces/:workspaceId/reindex` (OWNER/ADMIN) → 202, enqueues `rag.reindexWorkspace`.

## Assistant

Tool-using agent over the workspace. Manual loop (the SDK tool runner is acceptable if typed cleanly), max 6 tool rounds per turn. Tools, all scoped to the caller's visibility:

| Tool | Does |
|---|---|
| `search_workspace` | RAG `retrieve` across all sources (query, optional sourceTypes, projectId) |
| `list_tasks` | Filters: projectId, status, assignee (name or `me`), overdue, dueWithinDays, priority, limit ≤ 50 |
| `get_task` | By key (`WEB-12`) or id, with comments (last 10) and dependencies |
| `get_project_overview` | Project details + analytics summary + health (reuse analytics service) |
| `get_workload` | Per-member open/in-progress/overdue (analytics service) |
| `recent_activity` | Activity feed for workspace or project, sinceDays ≤ 30 |
| `get_document` | Document title + plain text (truncate to 20k chars, say so) |

Tool results are compact JSON. Every entity surfaced by a tool is collected into `sources` (deduped, max 12) with client links using the formats from Phase 2. System prompt: who the user is, their role, the workspace name, current date, scope (workspace/project/document), answer concisely in Markdown, cite by mentioning task keys/document titles, say "I couldn't find that in the workspace" rather than guess, and when the user asks to create/plan work return the plan and set `suggestedAction: { type: 'generate_tasks', text }` (the model signals this by ending its answer with a fenced block ```` ```nexus-action\n{"type":"generate_tasks"}\n``` ```` which the server strips).

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| GET | /ai/status | | auth | `AiStatusDto` |
| GET | /ai/workspaces/:workspaceId/conversations | conversationListQuerySchema | ai:use | `AiConversationDto[]` + meta (caller's own only) |
| POST | /ai/workspaces/:workspaceId/conversations | createConversationSchema | ai:use (+ project/document access for the scope) | `AiConversationDto` 201 |
| GET | /ai/conversations/:id | | owner of conversation | `AiConversationDetailDto` |
| PATCH | /ai/conversations/:id | `{ title }` | owner | `AiConversationDto` |
| DELETE | /ai/conversations/:id | | owner | 204 |
| POST | /ai/conversations/:id/messages | sendAiMessageSchema | owner + ai:use | **SSE stream** of `AiStreamEvent` (see shared type). Headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; heartbeat comment every 15 s; abort the Anthropic stream when the client disconnects. Persist user message first, assistant message on `done`. First turn auto-titles the conversation (≤ 60 chars, from the question, no extra LLM call). History sent to the model: last 20 messages. |

## Task generation

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| POST | /ai/projects/:projectId/generate-tasks | generateTasksSchema | ai:generate + project access | `GenerateTasksResultDto` (drafts only, nothing saved). Context given to the model: project name/description, member list (id, name, title, current open-task count) so it can suggest assignees, existing open task titles (to avoid duplicates), labels. `assigneeId` must be validated against project members (drop otherwise). |
| POST | /ai/projects/:projectId/commit-tasks | commitGeneratedTasksSchema | task:create | `TaskDto[]` 201. Creates via the Phase 1 task service (so events/activity/notifications fire), maps `parentDraftId`/`dependsOnDraftIds` to real ids in dependency order, records one `AI_TASKS_GENERATED` activity with count + source, and an `AI_TASK_CREATED` notification for assignees (via `createNotification`). |

## Meetings

Model `Meeting`: workspaceId, projectId|null, title, occurredAt, transcript, attendeeIds, status, error, analysis (shape of `MeetingAnalysisDto`, action items with generated ids), createdBy, timestamps.

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| GET | /meetings/workspaces/:workspaceId | meetingListQuerySchema | member | `MeetingDto[]` + meta (project-scoped meetings only when the caller has project access) |
| POST | /meetings/workspaces/:workspaceId | createMeetingSchema | meeting:create | `MeetingDto` 201, status PENDING, `enqueue('meeting.analyze')`; records MEETING_CREATED. When AI is off the meeting is saved with status FAILED, error "AI is not configured". |
| GET | /meetings/:id | | access | `MeetingDetailDto` |
| POST | /meetings/:id/analyze | | meeting:create | `MeetingDto` (re-runs analysis) |
| POST | /meetings/:id/convert | convertActionItemsSchema | task:create + project access | `TaskDto[]` (sets `actionItem.taskId`; owners resolved to members become assignees) |
| DELETE | /meetings/:id | | creator or meeting:delete | 204 |

`meeting.analyze` job: status PROCESSING → call Claude with structured output → resolve `ownerName` to workspace members (case-insensitive first-name / full-name match) → READY + MEETING_ANALYZED activity + RAG index; on failure FAILED with a safe error string. Emits a `notification` (`AI_TASK_CREATED` type is fine; title "Meeting notes ready: <title>") to the creator.

## Summaries & insights

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| POST | /ai/documents/:documentId/summarize | summarizeSchema | ai:use + document:view | `DocumentSummaryResultDto`, cached per (document, version, length) for 24 h |
| GET | /ai/projects/:projectId/insights | `?refresh=true` | ai:use + project access | `ProjectInsightDto`. Built from the analytics service (health, overdue, blocked, workload) + recent activity (7 d) + retrieved context; cached 30 min (refresh bypasses). Health/score come from the deterministic analytics health, never from the model; the model writes narrative/blockers/risks/recommendations grounded in the provided data. |
| GET | /ai/workspaces/:workspaceId/digest | `?days=7` | ai:use | `WorkspaceDigestDto`, cached 1 h |

`ai.listeners.ts`: invalidate the project insight cache on `task.*` for that project; nothing else.

## Production engineering (details in docs/DEPLOYMENT.md)

- Dockerfiles for api (multi-stage, non-root, `node dist/server.js`) and web (build → nginx serving `dist` with SPA fallback and `/api` + `/socket.io` proxy), root `docker-compose.yml` for api + web + mongo + redis.
- GitHub Actions: install → lint → typecheck → API tests → web tests → build, then Docker image builds. Then Playwright e2e against a started stack with a mock Anthropic API.
- Readiness `GET /api/health/ready` (Mongo ping + Redis ping when configured) alongside the existing liveness `/api/health`. Optional Sentry via `SENTRY_DSN` (errors only, no request or AI data). Prometheus-style `GET /api/metrics` guarded by `METRICS_TOKEN`.
- Redis-backed rate limiting store when Redis is configured; production checks in env (secure cookies, `ENCRYPTION_KEY` required, `CLIENT_URL` https).

## Implementation notes

- Files: `text/*` and `application/json` uploads (up to 1 MB) and PDFs (up to 25 MB and 300 pages) are indexed. Extracted text is capped at 400k characters per file.
- `GET /ai/workspaces/:id/usage?days=30` (OWNER/ADMIN) returns `AiUsageDto`: per-feature and per-day token totals from `AiUsage`, plus today's quota use.
- `POST /meetings/:id/convert` converts into the meeting's own project when it has one (400 otherwise). Converting an item twice returns 409.
- Meeting creation also indexes the transcript immediately, so it is searchable before (or without) analysis.
- Assistant tools use strict schemas. `eager_input_streaming` is off because tool inputs are small and strict validation is kept server-side; inputs are still re-validated before running.

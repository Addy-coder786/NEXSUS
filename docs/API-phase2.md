# NEXUS API Contract — Phase 2 (realtime, chat, notifications, documents, files, search, analytics, Slack)

Extends `docs/API.md`. Same envelope, validation (schemas in `packages/shared/src/schemas/*`), DTOs,
auth cookies and permission model (`PERMISSIONS` in `@nexus/shared`). All routes require
`authenticate`; mutations also `requireVerifiedEmail`, except where noted.

## Architecture rules

- **REST mutates, sockets push.** Every write goes through REST. After a successful write the
  service emits a domain event on `events` (`apps/api/src/events/index.ts`). Listeners push
  Socket.IO events via `realtime.toUser/toWorkspace/toProject/toChannel` (`apps/api/src/sockets`),
  create notifications, send email, post to Slack. Services never call Socket.IO directly.
- Socket contract (event names, payloads, rooms) lives in `packages/shared/src/socket.ts`.
- Background work goes through `enqueue()` / `scheduleRepeating()` in `apps/api/src/jobs`.
  Handlers are registered with `defineJob()`. In tests, `enqueue` runs inline.
- Listener and job registration files are fixed paths imported by `src/jobs/register.ts`:
  `modules/notifications/notification.listeners.ts`, `modules/chat/chat.listeners.ts`,
  `modules/realtime/realtime.listeners.ts`, `modules/integrations/slack/slack.listeners.ts`,
  `modules/analytics/deadline.job.ts`. Do not edit `register.ts`.

### Events Phase 1 services must emit (added in Phase 2)

| Service | After | Emit |
|---|---|---|
| workspace.service | create | `workspace.created` |
| workspace/invitation.service | member added (accept invite) / removed / role changed | `member.joined`, `member.removed` |
| project.service | create / update / delete | `project.created`, `project.updated` (with `changes`), `project.deleted` |
| task.service | create / update / move / delete | `task.created`, `task.updated` (with `changes`), `task.moved`, `task.deleted` |
| comment.service | create | `comment.created` (payload includes the task DTO) |
| activity.service | record | `activity.recorded` |

### Realtime listeners (modules/realtime/realtime.listeners.ts)

| Event | Push |
|---|---|
| `task.created/updated/moved/deleted` | `task:*` to `project:{id}` room |
| `project.created/updated/deleted` | `project:updated` / `project:deleted` to `workspace:{id}` |
| `activity.recorded` | `activity:new` to `project:{id}` if projectId, else `workspace:{id}` |
| `channel.created/updated` | `channel:created/updated` to each participant's `user:{id}` (private/DM/group) or `workspace:{id}` (public) |
| `message.created/updated/deleted` | `message:*` to `channel:{id}`; plus `channel:unread` to each other participant's `user:{id}` |
| `notification.created` | `notification:new` to `user:{id}` |
| `document.updated` | `document:updated` to `workspace:{id}` |
| `file.uploaded` | `file:uploaded` to `project:{id}` if any, else `workspace:{id}` |
| `member.joined` / `member.removed` | call `joinUserToWorkspace` / `removeUserFromWorkspace` from `sockets/index.ts` |

### Notification rules (modules/notifications/notification.listeners.ts)

Create a `Notification` (never for the actor themself), then emit `notification.created`, then
`enqueue('notification.deliver', { notificationId })`. The deliver job emails the user through
`enqueue('email.send', ...)` when `user.preferences.notifications.email` and the type-specific
preference are true, and sets `emailedAt`. Slack delivery is handled by the Slack listener.

| Event | Recipients | Type | Link |
|---|---|---|---|
| `task.updated` with assignee change | new assignee | TASK_ASSIGNED | `/w/:ws/projects/:p/board?task=:id` |
| `task.updated` status → DONE | task creator (if not actor) | TASK_COMPLETED | same |
| `task.due_soon` | assignee | TASK_DUE_SOON | same |
| `task.overdue` | assignee | TASK_OVERDUE | same |
| `comment.created` | task assignee + creator; `mentions` get MENTION instead | COMMENT_ADDED / MENTION | same |
| `message.created` | `mentions` → MENTION; DM/GROUP participants → NEW_MESSAGE (skip when `ChannelRead.muted`) | MENTION / NEW_MESSAGE | `/w/:ws/chat/:channelId` |
| `member.joined` | workspace OWNER/ADMIN | MEMBER_JOINED | `/w/:ws/members` |
| `file.uploaded` with taskId | task assignee (if not actor) | FILE_UPLOADED | task link |

Preference mapping: TASK_ASSIGNED→`taskAssigned`, TASK_COMPLETED→`taskCompleted`,
MENTION→`mentions`, COMMENT_ADDED→`comments`, TASK_DUE_SOON/TASK_OVERDUE→`deadlines`, others→`inApp` only.

## Chat

Channel access: PUBLIC → any workspace member; PRIVATE/GROUP/DM → listed `memberIds`. Slack-mirrored
channels (`source: 'slack'`, `isReadOnly: true`) reject posting with 403. Every workspace gets a
`#general` PUBLIC channel on `workspace.created`; every project gets a PUBLIC channel named after the
project (`projectId` set, slug `proj-<key lowercase>`) on `project.created` (chat.listeners.ts). Archived channels reject posting.

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| GET | /workspaces/:id/channels | | member | `ChannelDto[]` the caller can see (PUBLIC + ones they belong to), with `unreadCount`, sorted: project channels, then by lastMessageAt desc |
| POST | /workspaces/:id/channels | createChannelSchema | channel:create | `ChannelDto` (slug from name, unique per workspace; creator always a member of PRIVATE/GROUP) |
| POST | /workspaces/:id/channels/dm | openDmSchema | member | `ChannelDto` — finds or creates the DM (dmKey = sorted ids joined with ':'; name = other user's name) |
| GET | /channels/:id | | access | `ChannelDto` |
| PATCH | /channels/:id | updateChannelSchema | creator or channel:manage | `ChannelDto` |
| DELETE | /channels/:id | | channel:manage; not the project/general channel | 204 (cascade messages, reads) |
| GET | /channels/:id/members | | access | `WorkspaceMemberDto[]`-shaped `{ user, role, joinedAt }` (for PUBLIC: all workspace members) |
| POST | /channels/:id/members | channelMembersSchema | PRIVATE/GROUP: existing member or channel:manage | `ChannelDto` |
| DELETE | /channels/:id/members/:userId | | self or channel:manage | `ChannelDto` |
| POST | /channels/:id/read | markReadSchema | access | `ChannelReadStateDto` (sets lastReadAt = now or the message's createdAt) |
| POST | /channels/:id/mute | `{ muted: boolean }` | access | `ChannelReadStateDto` |
| GET | /channels/:id/messages | messageListQuerySchema | access | `MessageDto[]` top-level only (parentMessageId null), newest first; `meta` omitted, client paginates with `before` |
| POST | /channels/:id/messages | sendMessageSchema | message:send + access, channel not read-only/archived | `MessageDto` (201). `attachmentIds` must be files in the workspace uploaded by the caller and not yet attached; sets `file.channelId/messageId`. With `parentMessageId`: reply in thread (parent must be top-level in the same channel); increments parent `replyCount`, sets `lastReplyAt`. Updates `channel.lastMessageAt/lastMessagePreview/messageCount` (top-level only). Marks the channel read for the author. |
| GET | /messages/:id | | access | `MessageDto` |
| GET | /messages/:id/replies | `?limit` (default 100) | access | `MessageDto[]` oldest first |
| PATCH | /messages/:id | editMessageSchema | author only | `MessageDto` (sets editedAt) |
| DELETE | /messages/:id | | author or channel:manage | `MessageDto` soft-deleted: `deletedAt` set, body '' , attachments cleared (files unlinked, not deleted) |
| POST | /messages/:id/reactions | reactionSchema | access | `MessageDto` (toggle: adds caller; if present, removes) |
| GET | /workspaces/:id/unread | | member | `{ channels: ChannelReadStateDto[]; total: number }` |

`MessageDto.reactions[].reacted` is relative to the caller. Deleted messages are returned in lists
with `deletedAt` set and `body: ''` so threads keep their shape.

## Notifications

| Method | Path | Query/Body | Response |
|---|---|---|---|
| GET | /notifications | notificationListQuerySchema | `NotificationDto[]` + meta, newest first |
| GET | /notifications/unread-count | | `UnreadCountDto` |
| PATCH | /notifications/:id/read | | `NotificationDto` |
| POST | /notifications/read-all | `{ workspaceId? }` | `{ updated: number }`; emits `notification:read { ids: [], all: true }` to the user |
| DELETE | /notifications/:id | | 204 |

## Documents

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| GET | /workspaces/:id/documents | documentListQuerySchema | document:view (+ project access when `projectId` is set) | `DocumentSummaryDto[]` + meta. VIEWER/MEMBER only see docs with `projectId: null` or in projects they can access. |
| POST | /workspaces/:id/documents | createDocumentSchema | document:create | `DocumentDto` (201); records DOCUMENT_CREATED |
| GET | /documents/:id | | document:view | `DocumentDto` |
| PATCH | /documents/:id | updateDocumentSchema | document:update | `DocumentDto`. If `baseVersion` is given and `< current version` → **409** `{ code: CONFLICT, details: { currentVersion } }`. Otherwise increments `version`, sets `updatedBy`, and when `content` changed enqueues `document.snapshot` (which writes a `DocumentVersion` and prunes beyond DOCUMENT_VERSIONS_KEPT). Emits `document.updated`. Records DOCUMENT_UPDATED at most once per 10 minutes per document/user (debounce via `cache`). |
| DELETE | /documents/:id | | document:delete or creator | 204 (removes versions and unlinks files); records DOCUMENT_DELETED |
| GET | /documents/:id/versions | | document:view | `DocumentVersionDto[]` newest first |
| GET | /documents/:id/versions/:version | | document:view | `{ version, title, content, savedBy, createdAt }` |
| POST | /documents/:id/versions/:version/restore | | document:update | `DocumentDto` (new version with that content) |
| POST | /documents/:id/duplicate | | document:create | `DocumentDto` |

`excerpt` = first 160 chars of `contentText`. Server computes `contentText` from the Tiptap JSON when the client does not send one (walk nodes, join `text` fields with spaces/newlines).

## Files

Storage: `services/storage.ts` gains `uploadFile(buffer, { workspaceId, filename, mimeType })` →
`{ url, storageKey, provider, thumbnailUrl?, width?, height? }` and `deleteFile(storageKey, provider)`.
Cloudinary when configured (resource_type 'auto'; for images request an eager 400px thumbnail), else local disk
under `uploads/<workspaceId>/<random>.<ext>`. Allowed MIME: images (png, jpeg, webp, gif, svg),
pdf, video (mp4, webm, quicktime), audio (mpeg, wav, ogg), documents (doc/docx, xls/xlsx, ppt/pptx,
txt, csv, md, json, rtf), archives (zip, rar, 7z, gz, tar). Max `MAX_FILE_SIZE_BYTES`. Per-workspace
quota `env.STORAGE_LIMIT_BYTES` → 413 when exceeded. Reject MIME/extension mismatch and svg containing `<script`.

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| POST | /workspaces/:id/files | multipart `file` + uploadFileFieldsSchema | file:upload (+ task/project/channel access when provided) | `FileDto` (201); emits `file.uploaded`; records FILE_UPLOADED (projectId when set) |
| GET | /workspaces/:id/files | fileListQuerySchema | file:view | `FileDto[]` + meta (not deleted; VIEWER/MEMBER limited to accessible projects + unscoped files) |
| GET | /workspaces/:id/files/usage | | member | `StorageUsageDto` |
| GET | /files/:id | | file:view | `FileDto` |
| PATCH | /files/:id | updateFileSchema | uploader or file:delete | `FileDto` (rename; keeps extension) |
| DELETE | /files/:id | | uploader or file:delete | 204 soft delete (`deletedAt`), provider deletion best-effort via a job-less direct call; unlink from message/task; records FILE_DELETED |
| GET | /tasks/:id/files | | task:view | `FileDto[]` for the task (attachments) |

## Search

| Method | Path | Query | Response |
|---|---|---|---|
| GET | /workspaces/:id/search | searchQuerySchema | `SearchResultsDto` |

Per type, up to `limit` results, scoped to the workspace **and to what the caller may see**
(project access for tasks/projects/documents/files; channel access for messages; workspace
members for users). Use `$text` where a text index exists, falling back to case-insensitive regex on
the primary name field for short queries (< 3 chars) or when `$text` yields nothing. `counts` holds the
total matches per type (capped at 100). Message hits include a 160-char `snippet` around the match.

## Analytics

| Method | Path | Query | Permission | Response |
|---|---|---|---|---|
| GET | /projects/:id/analytics | analyticsQuerySchema | analytics:view + project access | `ProjectAnalyticsDto` |
| GET | /workspaces/:id/analytics | analyticsQuerySchema | analytics:view | `WorkspaceAnalyticsDto` (projects limited to accessible ones) |

All numbers via MongoDB aggregation pipelines (`$facet` for the summary, `$group` by ISO week for
velocity, `$group` by assignee for workload). Cache results in `cache` for 60 s keyed by
`(scope, id, weeks)`; invalidate on `task.*` events (listener in `deadline.job.ts` is fine).

Health score (0..100), start at 100: −8 per overdue task (max −40), −5 per blocked task (a task
with an unfinished dependency; max −20), −10 if > 25 % of open tasks are unassigned, −15 if project
`dueDate` passed and progress < 100, −10 if completed-last-7-days is 0 while open tasks > 5.
Status: ≥ 75 ON_TRACK, ≥ 45 AT_RISK, else OFF_TRACK. `reasons` are human sentences for each deduction
that fired; `recommendation` names the most impactful fix (e.g. the oldest overdue URGENT task).

### Deadline job (modules/analytics/deadline.job.ts)

`defineJob('deadline.scan')` + `scheduleRepeating('deadline.scan', {}, 60 * 60 * 1000)` on import
(skipped in tests automatically). For tasks not DONE with an assignee: `dueDate` within the next 24 h
and not flagged → emit `task.due_soon`; `dueDate` in the past and not flagged → `task.overdue`. Flags
are stored on the task as `reminders: { dueSoonAt, overdueAt }` (add these optional fields to the
Task model) so each fires once.

## Integrations — Slack

Feature-gated by `features.slackIntegration` (client id + secret + signing secret). When disabled,
`/integrations` reports `available.slack = false` and install returns 404. The OAuth v2 install uses
bot scopes `channels:read,channels:history,groups:read,chat:write,users:read,users:read.email,team:read`
and redirect `${API_URL}/api/integrations/slack/callback`. Store the bot token with
`encrypt()` from `utils/encryption.ts`. Talk to Slack with plain `fetch` against
`https://slack.com/api/*`; put the thin client in `integrations/slack/slack.client.ts` so tests can mock `fetch`.

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| GET | /workspaces/:id/integrations | | member | `IntegrationsOverviewDto` |
| GET | /workspaces/:id/integrations/slack/install | | integration:manage | 302 to Slack authorize (state in `cache`, 10 min: `{ workspaceId, userId }`) |
| GET | /integrations/slack/callback | `?code&state` | (no auth; state carries identity) | 302 `${CLIENT_URL}/w/:ws/settings?tab=integrations&slack=connected` or `&slack=error` |
| PATCH | /workspaces/:id/integrations/slack | updateSlackIntegrationSchema | integration:manage | `SlackIntegrationDto` |
| DELETE | /workspaces/:id/integrations/slack | | integration:manage | 204 — revoke token (`auth.revoke`, best-effort), delete integration, mark mirrored channels `isArchived: true`; records INTEGRATION_DISCONNECTED |
| GET | /workspaces/:id/integrations/slack/channels | | integration:manage | `SlackChannelOption[]` (conversations.list, public + private the bot can see) |
| POST | /workspaces/:id/integrations/slack/sync | syncSlackChannelsSchema | integration:manage | `SlackIntegrationDto`. For each channel: join it (`conversations.join`), create a mirrored NEXUS channel (`type: PUBLIC`, `source: 'slack'`, `isReadOnly: true`, slug `slack-<name>`), add to `syncedChannels`, `enqueue('slack.backfill', ...)` |
| POST | /workspaces/:id/integrations/slack/unsync | unsyncSlackChannelSchema | integration:manage | `SlackIntegrationDto` (archives the mirrored channel) |
| POST | /integrations/slack/events | Slack Events API | signature check (`X-Slack-Signature`, `X-Slack-Request-Timestamp`, `req.rawBody`, 5 min window) | `url_verification` → `{ challenge }`; `event_callback` with `message` (no subtype, or `file_share`) in a synced channel → import as a `Message` (`source: 'slack'`, `slackTs`, `externalAuthor` from a cached `users.info` lookup; if the Slack email matches a NEXUS workspace member set `authorId`), update the channel preview, emit `message.created`. Thread replies (`thread_ts`) map to `parentMessageId` when the parent is known. `message_changed`/`message_deleted` subtypes update/soft-delete by `slackTs`. Always 200 quickly. |

**Backfill job** (`slack.backfill`): `conversations.history` (limit 200, oldest = `lastTs`), import oldest→newest with the same mapping, set `lastSyncedAt/lastTs`. Idempotent via the `(channelId, slackTs)` unique index.

**Outbound** (`slack.listeners.ts`): on `notification.created`, if the workspace has an ACTIVE
integration with `notificationChannelId` and `notifyOn` includes the type, `enqueue('slack.notify')`;
the job posts a compact Block Kit message (title, body, link button to `CLIENT_URL + link`) via `chat.postMessage` and sets `slackedAt`. Never post for notifications whose `link` is null.

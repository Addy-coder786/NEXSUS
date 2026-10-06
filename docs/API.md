# NEXUS API Contract (Phase 1)

Base URL: `/api`. All responses use the envelope from `@nexus/shared`:

```json
{ "success": true, "data": ..., "meta": { "page", "limit", "total", "totalPages" } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

Request bodies are validated with the Zod schemas in `packages/shared/src/schemas/*`. Response
shapes are the `*Dto` interfaces in the same files. Dates are ISO strings. Ids are 24-hex strings.

## Auth (cookies)

- Access token: `nx_access` cookie, 15 min, path `/`. Also accepted as `Authorization: Bearer`.
- Refresh token: `nx_refresh` cookie, 7 d (30 d with `rememberMe`), path `/api/auth`. Rotated on every refresh. Reuse of an old refresh token revokes the session.
- On `401` with code `TOKEN_EXPIRED`, the client calls `POST /auth/refresh` once and retries.
- `403` with code `EMAIL_NOT_VERIFIED` is returned for write actions by unverified users.

| Method | Path | Body / Query | Response |
|---|---|---|---|
| POST | /auth/register | registerSchema | `{ user: UserDto }` + cookies. Sends verification email. |
| POST | /auth/login | loginSchema | `{ user: UserDto }` + cookies |
| POST | /auth/logout | | 204, clears cookies, deletes session |
| POST | /auth/logout-all | | 204, bumps tokenVersion, deletes all sessions |
| POST | /auth/refresh | (refresh cookie) | `{ user: UserDto }` + new cookies |
| GET | /auth/me | | `UserDto` |
| POST | /auth/forgot-password | forgotPasswordSchema | 200 always (no user enumeration) |
| POST | /auth/reset-password | resetPasswordSchema | 204. Bumps tokenVersion. |
| POST | /auth/verify-email | verifyEmailSchema | `{ user: UserDto }` |
| POST | /auth/resend-verification | | 204 |
| GET | /auth/sessions | | `SessionDto[]` |
| DELETE | /auth/sessions/:id | | 204 |
| GET | /auth/providers | | `{ google: boolean, slack: boolean }` (which OAuth buttons to show) |
| GET | /auth/google | `?redirect=/path` | 302 to Google |
| GET | /auth/google/callback | | 302 to `CLIENT_URL/auth/callback?redirect=...` with cookies set, or `CLIENT_URL/login?error=oauth_failed` |
| GET | /auth/slack | `?redirect=/path` | 302 to Slack (OpenID Connect, scopes `openid email profile`) |
| GET | /auth/slack/callback | | same as Google |

OAuth account linking: if a user with the same verified email exists, link the provider to that
user. Otherwise create a new user with `emailVerified: true`.

## Users

| Method | Path | Body | Response |
|---|---|---|---|
| GET | /users/me | | `UserDto` |
| PATCH | /users/me | updateProfileSchema | `UserDto` |
| PATCH | /users/me/preferences | updatePreferencesSchema | `UserDto` |
| PATCH | /users/me/password | changePasswordSchema | 204. Bumps tokenVersion except current session. |
| POST | /users/me/avatar | multipart `file` (png/jpg/webp ≤ 2 MB) | `UserDto` |
| DELETE | /users/me/avatar | | `UserDto` |
| GET | /users/:id | | `UserPublicDto` (must share a workspace with the caller) |

## Workspaces

Role checks use `PERMISSIONS` from `@nexus/shared`. Membership is cached per `(workspaceId, userId)`
for 60 s and invalidated on any membership change.

| Method | Path | Body / Query | Permission | Response |
|---|---|---|---|---|
| POST | /workspaces | createWorkspaceSchema | any verified user | `WorkspaceDto` (creator becomes OWNER; slug auto-generated from name if omitted) |
| GET | /workspaces | | | `WorkspaceDto[]` the caller belongs to |
| GET | /workspaces/:id | | member | `WorkspaceDto` |
| PATCH | /workspaces/:id | updateWorkspaceSchema | workspace:update | `WorkspaceDto` |
| DELETE | /workspaces/:id | | workspace:delete | 204 (cascades projects, tasks, comments, activities, members, invitations) |
| POST | /workspaces/:id/transfer | transferOwnershipSchema | workspace:transfer | `WorkspaceDto` (old owner becomes ADMIN) |
| GET | /workspaces/:id/members | `?search=` | member | `WorkspaceMemberDto[]` |
| PATCH | /workspaces/:id/members/:userId | updateMemberRoleSchema | member:manage + canAssignRole | `WorkspaceMemberDto` |
| DELETE | /workspaces/:id/members/:userId | | member:manage, or self (leave; OWNER cannot leave) | 204 |
| GET | /workspaces/:id/invitations | | member:invite | `InvitationDto[]` (PENDING only) |
| POST | /workspaces/:id/invitations | inviteMemberSchema | member:invite + canAssignRole | `InvitationDto`. Sends email with link `CLIENT_URL/invite/:token`. 409 if already a member or pending. |
| DELETE | /workspaces/:id/invitations/:invitationId | | member:invite | 204 (status REVOKED) |
| GET | /workspaces/:id/activities | activityQuerySchema | activity:view | `ActivityDto[]` + meta |
| GET | /workspaces/:id/projects | | member | `ProjectDto[]` (VIEWER/MEMBER see only projects they are members of; MANAGER+ see all) |
| POST | /workspaces/:id/projects | createProjectSchema | project:create | `ProjectDto` (creator auto-added as member; key auto-generated from name if omitted, unique per workspace) |

## Invitations (public + auth)

| Method | Path | Response |
|---|---|---|
| GET | /invitations/:token | `InvitationPreviewDto` (no auth) |
| POST | /invitations/:token/accept | auth required; email must match invitation email (case-insensitive). `WorkspaceDto`. |

## Projects

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| GET | /projects/:id | | project:view + project member (or MANAGER+) | `ProjectDto` |
| PATCH | /projects/:id | updateProjectSchema | project:update | `ProjectDto` |
| DELETE | /projects/:id | | project:delete | 204 (cascades tasks, comments) |
| POST | /projects/:id/members | addProjectMembersSchema | project:update | `ProjectDto` (users must be workspace members) |
| DELETE | /projects/:id/members/:userId | | project:update | `ProjectDto` |
| GET | /projects/:id/labels | | project:view | `LabelDto[]` |
| POST | /projects/:id/labels | createLabelSchema | task:update | `LabelDto` |
| PATCH | /projects/:id/labels/:labelId | updateLabelSchema | task:update | `LabelDto` |
| DELETE | /projects/:id/labels/:labelId | | task:update | 204 (removed from tasks) |
| GET | /projects/:id/tasks | taskListQuerySchema | task:view | `TaskDto[]` + meta |
| POST | /projects/:id/tasks | createTaskSchema | task:create | `TaskDto` |
| GET | /projects/:id/activities | activityQuerySchema | activity:view | `ActivityDto[]` + meta |

## Tasks

- `number` auto-increments per project; `key` = `${project.key}-${number}`.
- `position` is a float. New tasks get `max(position in column) + 1024`. Moving between
  two neighbours sets `position` to their midpoint (client computes; server accepts any number).
- Setting status to DONE sets `completedAt`; leaving DONE clears it.
- `assigneeId` must be a project member. `parentTaskId` and `dependsOn` must be tasks in the same project; a task cannot depend on itself or create a dependency cycle (check one level deep is acceptable in Phase 1: A→B and B→A rejected).

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| GET | /tasks/:id | | task:view | `TaskDto` |
| PATCH | /tasks/:id | updateTaskSchema | task:update | `TaskDto` (emits TASK_UPDATED / TASK_ASSIGNED / TASK_COMPLETED activities with field diffs) |
| PATCH | /tasks/:id/move | moveTaskSchema | task:update | `TaskDto` (TASK_MOVED activity) |
| DELETE | /tasks/:id | | task:delete (creator, assignee, or MANAGER+) | 204 (cascades subtasks + comments) |
| GET | /tasks/:id/subtasks | | task:view | `TaskDto[]` |
| GET | /tasks/:id/comments | paginationQuerySchema | task:view | `CommentDto[]` + meta (oldest first) |
| POST | /tasks/:id/comments | createCommentSchema | comment:create | `CommentDto` |

## Comments

| Method | Path | Body | Permission | Response |
|---|---|---|---|---|
| PATCH | /comments/:id | updateCommentSchema | author only | `CommentDto` (sets editedAt) |
| DELETE | /comments/:id | | author or MANAGER+ | 204 |

## Activities

| Method | Path | Query | Response |
|---|---|---|---|
| GET | /activities/me | paginationQuerySchema | `ActivityDto[]` across the caller's workspaces |

Activity events are written by a single `ActivityService.record()` so every mutation is logged in
one place. Activities are never updated or deleted individually (only cascaded).

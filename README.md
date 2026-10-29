# NEXUS

**An AI-powered, real-time team operating system.** NEXUS puts chat, projects, tasks, documents,
files and analytics in one workspace, and is building an AI layer that turns team context into
actionable work.

Teams usually spread their work across Slack, Jira, Notion and Drive, so decisions get lost
between tools. NEXUS connects those pieces so a conversation can become a decision, a decision
can become a task, and the team can track progress in one place.

```text
Conversation → AI understands context → Decision / action detected → Tasks created
     ↑                                                                    ↓
Project analytics ← Progress tracked ← Tasks assigned ←──────────────────┘
```

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Auth and sessions, workspaces, roles, projects, tasks, Kanban, comments, activity log | ✅ Done |
| 2. Collaboration | Real-time updates, chat, notifications, documents, files, search, analytics, Slack integration | ✅ Done |
| 3. Intelligence and production | AI assistant, AI task generation, meeting intelligence, RAG, insights, Docker, CI, health and metrics | ✅ Done |

Test suites: 231 API tests, 88 web tests and 6 Playwright end-to-end tests, all passing. Strict TypeScript and ESLint are clean
across the repository.

## Features

### Workspaces and access control
- Email and password sign-up with verification, password reset, and sign-in with Google or Slack.
- JWT access tokens in HTTP-only cookies, refresh-token rotation with reuse detection, and a
  sessions list with per-device revoke and "log out everywhere".
- Multiple workspaces per user, email invitations, and ownership transfer.
- Five roles (Owner, Admin, Manager, Member, Viewer) enforced on every endpoint and reflected in the UI.

### Projects and tasks
- Projects with short keys, colours, members and labels. Tasks are numbered per project, like `WEB-42`.
- Tasks carry status, priority, assignee, due date, estimate, checklist, subtasks and dependencies,
  with cycle detection on dependencies.
- A Kanban board with drag and drop, optimistic updates, filters and a read-only mode for viewers.
- A list view, comments with mentions, and a full activity log with field-level change history.

### Real-time collaboration
- Socket.IO with cookie authentication, rooms per user, workspace, project and channel, plus
  presence and typing indicators.
- Live board, project and activity updates. With Redis configured, the server can scale across
  multiple instances.
- Chat with workspace and project channels, private groups, direct messages, threads, reactions,
  mentions, attachments, unread counts and muting.
- Notifications that arrive live and by email, with a bell, a notifications page and per-user preferences.

### Knowledge layer
- A rich-text document editor (Tiptap) with tables, task lists and images, a one-second autosave,
  conflict detection and version history with restore.
- File uploads with progress, image, PDF and video previews, storage quotas and task attachments.
  Files go to Cloudinary when configured, otherwise to local disk.
- Global search with Ctrl+K across tasks, projects, documents, messages, files and people,
  limited to what each user is allowed to see.

### Analytics
- Workspace and project dashboards built on MongoDB aggregation pipelines: status and priority
  breakdowns, weekly velocity, team workload and project progress.
- A deterministic project health score with plain-language reasons and a recommendation.
- An hourly deadline scan that sends due-soon and overdue notifications.

### Slack integration
- Connect a Slack workspace from settings. Bot tokens are stored encrypted with AES-256-GCM.
- Mirror Slack channels into NEXUS, with history backfill and live updates through the Events API.
- Post NEXUS notifications to a chosen Slack channel.

### AI
- A workspace assistant built on the Claude API that uses tools to search tasks, documents,
  messages, workload and activity, while respecting each user's permissions. Answers stream over
  Server-Sent Events, cite their sources, and are available on a full page or in a side panel on any screen.
- AI task generation from text, documents or chat threads, with an editable review step before
  anything is created.
- Meeting intelligence that turns a transcript into a summary, decisions, action items with owners,
  and tasks.
- Document summaries, project insights and a weekly workspace digest.
- A RAG pipeline with chunking, Voyage embeddings, and Atlas Vector Search or a local fallback.
  Content is indexed as it changes, and retrieval combines vector and keyword ranking.
  Without embeddings, retrieval falls back to keyword search.
- Guardrails: a per-workspace daily request limit, token usage logged per call, server-side
  refusal fallbacks, and workspace content wrapped as data so instructions inside it are ignored.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, Radix UI, TanStack Query, Zustand, React Hook Form, dnd-kit, Tiptap, Recharts |
| Backend | Node.js, Express, TypeScript, Mongoose, Zod, Socket.IO, BullMQ |
| Data | MongoDB (Atlas or local), Redis (optional: cache, Socket.IO adapter, job queue) |
| Integrations | Resend (email), Cloudinary (files), Slack (OAuth, Events API, Web API), Google OAuth |
| AI | Anthropic Claude API, Voyage AI embeddings |
| Testing | Jest, Supertest, mongodb-memory-server, Vitest, React Testing Library |

## Repository layout

```text
apps/
  api/            Express REST API, Socket.IO server and background jobs
    src/
      config/       env validation, logger, MongoDB, Redis-or-memory cache
      middleware/   authenticate, authorize (RBAC), validate, rate limits, errors
      models/       Mongoose models
      modules/      one folder per domain: routes, controller, service, listeners
      events/       typed in-process domain event bus
      sockets/      Socket.IO server, auth, presence, typed emit helpers
      jobs/         BullMQ queue with an in-process fallback
    tests/          Jest and Supertest suites against in-memory MongoDB
  web/            React single-page app
    src/
      app/          router, providers, route guards
      components/   UI primitives, layout, shared components
      features/     one folder per domain: api, hooks, components, pages
packages/
  shared/         Zod schemas, DTO types, constants, the RBAC permission matrix and the socket contract
docs/
  API.md            Phase 1 API contract
  API-phase2.md     Phase 2 API contract (real-time, chat, documents, files, search, analytics, Slack)
  API-phase3.md     Phase 3 API contract (AI, RAG, production)
  DEPLOYMENT.md     Docker, configuration, health checks, metrics and scaling
  slack-manifest.json  Slack app manifest
```

The API follows route, middleware, controller, service and model layers. Services emit domain
events after each write, and listeners fan those events out to sockets, notifications, email and
Slack. REST handles every mutation; sockets only push results.

## Getting started

### Prerequisites
- Node.js 20 or later (npm workspaces, no pnpm needed).
- MongoDB from one of three sources: a free MongoDB Atlas cluster, a local install, or the bundled
  local server described below.
- Redis is optional.

### Setup

```bash
git clone https://github.com/Addy-coder786/NEXSUS.git
cd NEXSUS
npm install

cp apps/api/.env.example apps/api/.env   # fill in the values below
cp apps/web/.env.example apps/web/.env
```

At minimum, set these in `apps/api/.env`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/nexus     # or your Atlas connection string
JWT_ACCESS_SECRET=<random 48+ chars>
JWT_REFRESH_SECRET=<different random 48+ chars>
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Run

```bash
npm run db:local   # optional: a local MongoDB with no Docker or install needed (data in apps/api/.mongo-data)
npm run dev        # API on http://localhost:4000, web on http://localhost:5173
```

To run the whole stack in containers (web, API, MongoDB and Redis), copy `.env.example` to `.env`,
fill in the secrets and run `docker compose up --build`. The app is then on http://localhost:8080.
See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for configuration, health checks and scaling.

To enable AI, set `ANTHROPIC_API_KEY` in `apps/api/.env`. You can also set `VOYAGE_API_KEY` for
semantic search.

Without the optional services, the app degrades gracefully:

| Service | When it isn't configured |
|---|---|
| Resend | Emails print to the API console, including verification links |
| Cloudinary | Uploads are stored under `apps/api/uploads` |
| Redis | An in-memory cache is used, and jobs run in-process |
| Google or Slack OAuth | The sign-in buttons are hidden |
| Slack integration | Settings shows "not configured" |
| Anthropic API key | AI endpoints return 503 and the AI UI is hidden or shows a setup notice |
| Voyage API key | Retrieval uses keyword search instead of embeddings |

### Slack setup
1. Create an app at <https://api.slack.com/apps?new_app=1>, choose **From a manifest**, and paste
   [`docs/slack-manifest.json`](docs/slack-manifest.json).
2. Copy the Client ID, Client Secret and Signing Secret into the `SLACK_*` variables in `apps/api/.env`.
3. Live message mirroring needs a public HTTPS URL for the Events API, for example through ngrok,
   that points to `/api/integrations/slack/events`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API and web app together |
| `npm run db:local` | Starts a persistent local MongoDB on port 27017 |
| `npm test` | Runs the API (Jest) and web (Vitest) test suites |
| `npm run test:e2e` | Runs the Playwright end-to-end suite against a self-started stack with a mock Anthropic API (run `npx playwright install chromium` once first) |
| `npm run typecheck` | Runs strict TypeScript across all workspaces |
| `npm run lint` | Runs ESLint across the repository |
| `npm run build` | Creates production builds |

## Security

- Passwords are hashed with bcrypt (cost 12). Verification, reset and invitation tokens are stored
  only as SHA-256 hashes.
- Short-lived access tokens are checked against a live session, so logout takes effect immediately.
  Refresh tokens rotate, and reuse of an old one revokes the session.
- Every input is validated with shared Zod schemas, and every query is scoped by workspace.
  Requests about another user's data return 404, which prevents enumeration.
- Helmet, strict CORS and rate limiting are applied per IP and per email.
- File uploads are checked against a MIME allowlist, extension match and magic bytes, and SVG
  files are screened for scripts.
- Slack webhook signatures are verified with HMAC and a five-minute replay window. Integration
  tokens are encrypted at rest.

## Roadmap

- [x] Phase 1: foundation, authentication, workspaces, roles, projects, tasks, Kanban
- [x] Phase 2: real-time, chat, notifications, documents, files, search, analytics, Slack
- [x] Phase 3: AI assistant, task generation, meeting intelligence, insights, RAG
- [x] Phase 3: Docker, GitHub Actions CI, health checks and Prometheus metrics
- [x] Phase 3: Playwright end-to-end tests, Sentry error reporting, PDF text extraction for RAG, AI usage view
- [ ] Production deployment to a hosting provider

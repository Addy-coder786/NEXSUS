# NEXUS

AI-powered real-time team operating system. One workspace for chat, projects, tasks, documents,
files and analytics, with an AI layer that turns team context into actionable work.

API contract: `docs/API.md`. Drop the product specification at `docs/NEXUS_Project_Specification.md` to keep it alongside.

## Monorepo layout

```
apps/api         Express + TypeScript + Mongoose REST API + Socket.IO + background jobs
apps/web         React + Vite + TypeScript client (Tailwind, TanStack Query, Zustand, dnd-kit)
packages/shared  Zod schemas, DTO types, constants and the RBAC permission matrix shared by both
docs/            Contracts and design notes
```

## Prerequisites

- Node.js 20+ (npm workspaces are used; no pnpm needed)
- MongoDB: a local instance, Docker (`docker compose up -d`), or a free MongoDB Atlas cluster
- Redis is optional in Phase 1 (an in-memory cache is used when `REDIS_URL` is unset)

## Setup

```bash
npm install
cp apps/api/.env.example apps/api/.env      # then set MONGODB_URI and the two JWT secrets
cp apps/web/.env.example apps/web/.env
npm run dev                                  # API on :4000, web on :5173
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optional integrations are enabled by setting their env vars (Resend for email, Google and Slack
OAuth, Cloudinary for file storage). Without them, emails print to the API console, OAuth buttons
are hidden, and uploads are stored under `apps/api/uploads`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs API and web together |
| `npm test` | API tests (Jest + Supertest, in-memory Mongo) and web tests (Vitest) |
| `npm run typecheck` | Strict TypeScript across all workspaces |
| `npm run lint` | ESLint across the repo |
| `npm run build` | Production builds |

## Roadmap

- **Phase 1** (done): foundation, auth and sessions, workspaces and RBAC, projects, tasks, Kanban, comments, activity log
- **Phase 2** (done): Socket.IO real-time, chat, notifications, documents, files, search, analytics, Slack integration
- **Phase 3**: AI assistant, task generation, meeting intelligence, RAG, production hardening and deployment

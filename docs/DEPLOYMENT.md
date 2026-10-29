# Deploying NEXUS

NEXUS runs as two containers: **api**, the Node.js API with Socket.IO and background jobs, and
**web**, which uses nginx to serve the built SPA and proxy `/api`, `/socket.io` and `/uploads` to
the API. They need MongoDB, plus Redis for anything beyond a single instance.

## Quick start with Docker Compose

```bash
cp .env.example .env          # set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
docker compose up --build     # http://localhost:8080
```

The compose file starts `mongo`, `redis`, `api` and `web`. Uploaded files are kept in the
`uploads` volume, and the database in `mongo-data`.

To develop locally with hot reload, start only the databases with `docker compose up -d mongo redis`
and run `npm run dev`.

## Images

| Image | Dockerfile | Notes |
|---|---|---|
| API | `apps/api/Dockerfile` | Multi-stage. tsup bundles `@nexus/shared` into `dist/server.js`; the runtime stage installs production dependencies only and runs as the non-root `node` user. The healthcheck calls `/api/health/ready`. |
| Web | `apps/web/Dockerfile` | Vite build served by `nginx:1.27-alpine`. `API_UPSTREAM` (default `http://api:4000`) sets the proxy target. Set the `VITE_API_URL` build argument only when the API is served from a different origin. |

Build both images from the repository root, for example
`docker build -f apps/api/Dockerfile -t nexus-api .`

## Configuration

The API validates its environment at startup and exits with a list of problems if anything is
invalid. Empty values (`KEY=`) count as unset. In production (`NODE_ENV=production`) it also requires:

- `ENCRYPTION_KEY`, 64 hex characters, which encrypts stored integration tokens.
- A `CLIENT_URL` that uses `https`. Plain `http` is accepted only for `localhost`.
- JWT secrets that differ from each other and from the example values.

Cookies are `Secure` in production, so serve the app over HTTPS: terminate TLS at your load
balancer or ingress in front of the web container. The API trusts one proxy hop for client IPs
(`trust proxy 1`).

See `apps/api/.env.example` for every variable. These ones matter in production:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string (Atlas or self-hosted). |
| `REDIS_URL` | Enables the BullMQ job queue, the Socket.IO Redis adapter, a shared cache and a Redis-backed rate limiter. Required when you run more than one API instance. |
| `ANTHROPIC_API_KEY` | Enables AI features. Without it, AI endpoints return `503 AI_NOT_CONFIGURED` and the UI hides them. |
| `AI_DAILY_LIMIT` | AI requests per workspace per UTC day (default 500). |
| `VOYAGE_API_KEY`, `VECTOR_SEARCH` | Semantic retrieval. `atlas` uses `$vectorSearch` (see below); `local` scores in process. |
| `METRICS_TOKEN` | Enables `GET /api/metrics`. |

## Health and monitoring

| Endpoint | Use |
|---|---|
| `GET /api/health` | Liveness. Always 200 while the process is up. |
| `GET /api/health/ready` | Readiness. 200 when MongoDB, and Redis if configured, answer a ping; otherwise 503 with `checks`. |
| `GET /api/metrics` | Prometheus text format. Needs `Authorization: Bearer $METRICS_TOKEN`; returns 404 when no token is configured. Includes request counts and a latency histogram by route pattern and status class, process memory and uptime, and Mongo connection state. |

None of these endpoints are rate limited. Logs are JSON (pino) on stdout, with a request id taken
from `X-Request-Id` when present.

Set `SENTRY_DSN` to report unexpected errors to Sentry: 5xx responses, failed background jobs,
assistant turns that crash and unhandled rejections. Only errors are sent (no tracing), and
request data, cookies, user info and AI prompts or outputs are never collected.

## MongoDB Atlas Vector Search (optional)

With `VECTOR_SEARCH=atlas`, the API creates a vector index named `nexus_chunks_vector` on the
`chunks` collection at startup if it is missing (Atlas builds it in the background). If the
database user lacks permission, the API logs a warning and you can create it in the Atlas UI with
this definition. `numDimensions` comes from `VOYAGE_DIMENSIONS` (default 1024, the size for
`voyage-3.5`):

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 1024, "similarity": "cosine" },
    { "type": "filter", "path": "workspaceId" },
    { "type": "filter", "path": "projectId" },
    { "type": "filter", "path": "sourceType" }
  ]
}
```

After enabling embeddings, rebuild the index for existing content from **Settings → AI →
Rebuild search index** (OWNER or ADMIN), or with `POST /api/ai/workspaces/:id/reindex`.

## Scaling

- Run more than one API instance only with `REDIS_URL` set. Socket.IO then fans out through Redis,
  jobs run once through BullMQ, and the rate limits and AI quota are shared.
- The assistant streams over Server-Sent Events. Proxies must not buffer `/api` responses; the
  bundled nginx config disables buffering and allows 300-second reads.
- Uploads use local disk unless `CLOUDINARY_URL` is set. With several instances, use Cloudinary or
  a shared volume.

## CI

`.github/workflows/ci.yml` runs lint, typecheck, the API tests (Jest against in-memory MongoDB),
the web tests (Vitest) and production builds. It then runs the Playwright end-to-end suite and
builds both Docker images.

The e2e suite (`npm run test:e2e`) starts its own stack: an in-memory MongoDB, a mock of the
Anthropic Messages API (`e2e/mock-anthropic.mjs`), the API pointed at the mock through
`ANTHROPIC_BASE_URL`, and the Vite dev server. So AI flows run through the real SDK, streaming
and tool loop without an API key or cost. Run `npx playwright install chromium` once first.

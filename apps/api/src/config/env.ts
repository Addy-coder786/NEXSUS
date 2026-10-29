import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/nexus'),
  REDIS_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  COOKIE_DOMAIN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('NEXUS <noreply@localhost>'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  CLOUDINARY_URL: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/, '64 hex chars').optional(),
  STORAGE_LIMIT_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024 * 1024),
  // Phase 3: AI
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Force-enable AI when credentials come from an ant profile / WIF instead of ANTHROPIC_API_KEY. */
  AI_ENABLED: z.enum(['true', 'false']).optional(),
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** Per-workspace AI requests per day (assistant turns + generations). */
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(500),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default('voyage-3.5'),
  /** Embedding size; sent to Voyage as output_dimension and used for the Atlas index. */
  VOYAGE_DIMENSIONS: z.coerce.number().int().positive().optional(),
  /** 'atlas' uses $vectorSearch (index name nexus_chunks_vector); 'local' scores in-process. */
  VECTOR_SEARCH: z.enum(['atlas', 'local']).default('local'),
  SENTRY_DSN: z.string().optional(),
  /** Bearer token for GET /api/metrics; the endpoint is disabled (404) when unset. */
  METRICS_TOKEN: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Production refuses to start with settings that are only safe in development. */
export function productionChecks(e: z.infer<typeof envSchema>, ctx: z.RefinementCtx): void {
  if (e.NODE_ENV !== 'production') return;
  if (!e.ENCRYPTION_KEY) ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'required in production' });
  // https is required except for a local deployment (docker compose on localhost).
  const client = new URL(e.CLIENT_URL);
  if (client.protocol !== 'https:' && !LOCAL_HOSTS.has(client.hostname)) {
    ctx.addIssue({ code: 'custom', path: ['CLIENT_URL'], message: 'must use https in production' });
  }
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (e[key].startsWith('change-me')) ctx.addIssue({ code: 'custom', path: [key], message: 'replace the example secret' });
  }
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) {
    ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_ACCESS_SECRET' });
  }
}

function loadEnv() {
  const isTest = process.env.NODE_ENV === 'test';
  // `KEY=` (empty) means unset, as docker compose passes optional variables that way.
  const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''));
  const source = isTest
    ? {
        ...present,
        JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-test-access-secret-0000',
        JWT_REFRESH_SECRET:
          process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-test-refresh-secret-0000',
      }
    : present;

  const parsed = envSchema.superRefine(productionChecks).safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';

export const features = {
  redis: Boolean(env.REDIS_URL),
  email: Boolean(env.RESEND_API_KEY),
  googleOAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  slackOAuth: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
  cloudinary: Boolean(env.CLOUDINARY_URL),
  ai: env.AI_ENABLED ? env.AI_ENABLED === 'true' : Boolean(env.ANTHROPIC_API_KEY),
  embeddings: Boolean(env.VOYAGE_API_KEY),
  slackIntegration: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_SIGNING_SECRET),
};

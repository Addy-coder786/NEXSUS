// Starts the e2e backend: an in-memory MongoDB, the mock Anthropic API and the real NEXUS API
// (via tsx). Playwright runs this as a webServer and waits for /api/health/ready.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startMockAnthropic } from './mock-anthropic.mjs';
import { API_PORT, MOCK_ANTHROPIC_PORT, STACK_FILE, WEB_PORT } from './ports.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const mongod = await MongoMemoryServer.create();
const mongoUri = mongod.getUri('nexus-e2e');
const mock = await startMockAnthropic(MOCK_ANTHROPIC_PORT);
writeFileSync(STACK_FILE, JSON.stringify({ mongoUri }));

const api = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/server.ts'], {
  cwd: path.resolve(here, '../apps/api'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    API_URL: `http://localhost:${WEB_PORT}`,
    CLIENT_URL: `http://localhost:${WEB_PORT}`,
    MONGODB_URI: mongoUri,
    JWT_ACCESS_SECRET: 'e2e-access-secret-e2e-access-secret-000000',
    JWT_REFRESH_SECRET: 'e2e-refresh-secret-e2e-refresh-secret-00000',
    ANTHROPIC_API_KEY: 'sk-ant-e2e',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_ANTHROPIC_PORT}`,
    LOG_LEVEL: 'warn',
    // Never let a developer's real credentials leak into the run.
    REDIS_URL: '',
    VOYAGE_API_KEY: '',
    RESEND_API_KEY: '',
    CLOUDINARY_URL: '',
    SENTRY_DSN: '',
  },
});

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  mock.close();
  await mongod.stop();
  process.exit(code);
}
api.on('exit', (code) => void stop(code ?? 1));
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

import http from 'node:http';
import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeRedis } from './config/redis';
import { closeSentry, captureError, initSentry } from './config/sentry';
import { startJobs, stopJobs } from './jobs';
import { ensureVectorIndex } from './modules/rag/vectorIndex';
import { initSockets } from './sockets';

async function main() {
  initSentry();
  await connectDb();
  await ensureVectorIndex();
  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);
  await startJobs();

  server.listen(env.PORT, () => {
    logger.info(`API listening on ${env.API_URL} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await Promise.allSettled([stopJobs(), disconnectDb(), closeRedis(), closeSentry()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    captureError(reason, { kind: 'unhandledRejection' });
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

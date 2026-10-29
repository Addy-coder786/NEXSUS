import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import mongoose from 'mongoose';
import { env, features } from '../config/env';
import { redis } from '../config/redis';
import { renderMetrics } from '../middleware/metrics';
import { ApiError } from '../utils/ApiError';

/**
 * Liveness (`/health`), readiness (`/health/ready`: MongoDB ping + Redis ping when configured)
 * and Prometheus metrics (`/metrics`, bearer METRICS_TOKEN; 404 when no token is configured).
 * Mounted before the API rate limiter so probes are never throttled.
 */
export const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', env: env.NODE_ENV, time: new Date().toISOString() } });
});

async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

healthRoutes.get('/health/ready', async (_req, res) => {
  const db = mongoose.connection.readyState === 1 && (await check(() => mongoose.connection.db!.admin().ping()));
  const cache = features.redis ? Boolean(redis) && (await check(() => redis!.ping())) : null;
  const ready = db && cache !== false;
  res.status(ready ? 200 : 503).json({
    success: ready,
    data: { status: ready ? 'ready' : 'unavailable', checks: { mongo: db, redis: cache } },
  });
});

function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

healthRoutes.get('/metrics', (req, res, next) => {
  if (!env.METRICS_TOKEN) return next(ApiError.notFound());
  if (!tokenMatches(req.headers.authorization, env.METRICS_TOKEN)) return next(ApiError.unauthorized());
  res
    .type('text/plain; version=0.0.4')
    .send(renderMetrics({ nexus_mongo_connected: mongoose.connection.readyState === 1 ? 1 : 0 }));
});

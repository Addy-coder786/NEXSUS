import Redis from 'ioredis';
import { env, features } from './env';
import { logger } from './logger';

/**
 * Minimal key/value cache with TTL. Backed by Redis when REDIS_URL is set,
 * otherwise by an in-process Map so the app runs without Redis in Phase 1.
 */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Delete keys by glob-style prefix pattern, e.g. "perm:ws123:*". */
  delByPrefix(prefix: string): Promise<void>;
}

class MemoryCache implements Cache {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value as T;
  }
  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
  async del(...keys: string[]): Promise<void> {
    keys.forEach((k) => this.store.delete(k));
  }
  async delByPrefix(prefix: string): Promise<void> {
    for (const k of this.store.keys()) if (k.startsWith(prefix)) this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

class RedisCache implements Cache {
  constructor(private client: Redis) {}
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set(key: string, value: unknown, ttlSec: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }
  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }
  async delByPrefix(prefix: string): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }
}

export let redis: Redis | null = null;

function createCache(): Cache {
  if (features.redis && env.REDIS_URL) {
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    redis.on('error', (err) => logger.error({ err }, 'Redis error'));
    redis.on('connect', () => logger.info('Redis connected'));
    return new RedisCache(redis);
  }
  logger.info('REDIS_URL not set: using in-memory cache');
  return new MemoryCache();
}

export const cache: Cache = createCache();

export async function closeRedis(): Promise<void> {
  if (redis) await redis.quit();
}

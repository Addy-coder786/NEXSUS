import rateLimit, { type IncrementResponse, type Options, type Store } from 'express-rate-limit';
import type Redis from 'ioredis';
import { isTest } from '../config/env';
import { redis } from '../config/redis';
import { ApiError } from '../utils/ApiError';

/**
 * Fixed-window counter in Redis, so limits hold across API instances. Used automatically when
 * REDIS_URL is set; otherwise express-rate-limit's in-memory store applies (single instance).
 */
export class RedisRateLimitStore implements Store {
  windowMs = 60_000;
  readonly localKeys = false;

  constructor(
    private readonly client: Redis,
    readonly prefix: string,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string): string {
    return `rl:${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const k = this.key(key);
    const result = await this.client.multi().incr(k).pexpire(k, this.windowMs, 'NX').pttl(k).exec();
    const totalHits = Number(result?.[0]?.[1] ?? 1);
    const ttl = Number(result?.[2]?.[1] ?? this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.key(key));
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }
}

function make(name: string, windowMs: number, limit: number, keyByEmail = false) {
  return rateLimit({
    windowMs,
    limit: isTest ? 10_000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...(redis ? { store: new RedisRateLimitStore(redis, name) } : {}),
    keyGenerator: (req) => {
      const email = keyByEmail ? (req.body as { email?: string } | undefined)?.email : undefined;
      return email ? `${req.ip}:${email.toLowerCase()}` : (req.ip ?? 'unknown');
    },
    handler: (_req, _res, next) => next(ApiError.rateLimited()),
  });
}

/** Global API limiter. */
export const apiLimiter = make('api', 15 * 60 * 1000, 1000);
/** Login / register / password reset: per IP + email. */
export const authLimiter = make('auth', 15 * 60 * 1000, 20, true);
/** Email-sending endpoints (forgot password, resend verification). */
export const emailLimiter = make('email', 60 * 60 * 1000, 5, true);

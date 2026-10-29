import * as Sentry from '@sentry/node';
import { env, isTest } from './env';
import { logger } from './logger';

/**
 * Optional error reporting. Everything here is a no-op unless SENTRY_DSN is set, so callers can
 * report unconditionally. Only unexpected failures are sent (5xx, failed jobs, crashed turns), and
 * no request data, cookies or AI content is attached.
 */
let enabled = false;

export function initSentry(): void {
  if (!env.SENTRY_DSN || isTest) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Errors only: no traces, and none of the request or AI data the SDK collects by default
    // (cookies, headers, bodies, query strings, user info, prompts and model outputs).
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
  });
  enabled = true;
  logger.info('Sentry error reporting enabled');
}

export function captureError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/** Flushes queued events before the process exits. */
export async function closeSentry(): Promise<void> {
  if (enabled) await Sentry.close(2000);
}

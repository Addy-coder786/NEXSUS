import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import { env, features, isTest } from '../config/env';
import { logger } from '../config/logger';

/**
 * Background jobs. With REDIS_URL set, BullMQ runs a single queue ("nexus") and dispatches by
 * job name. Without Redis, jobs run in-process (setImmediate) and repeatable jobs use timers,
 * so the app stays fully functional in Phase 1/2 dev setups. In tests, enqueue() runs the
 * handler inline and awaits it, so assertions are deterministic; repeatables are disabled.
 *
 * Modules register handlers with defineJob() at import time (see jobs/register.ts).
 */
export interface JobPayloads {
  'email.send': { to: string; subject: string; html: string; text?: string };
  'notification.deliver': { notificationId: string };
  'deadline.scan': Record<string, never>;
  'slack.notify': { notificationId: string };
  'slack.backfill': { integrationId: string; slackChannelId: string };
  'document.snapshot': { documentId: string; version: number };
  'rag.index': { sourceType: 'document' | 'message' | 'task' | 'meeting' | 'file'; sourceId: string };
  'rag.remove': { sourceType: 'document' | 'message' | 'task' | 'meeting' | 'file'; sourceId: string };
  'rag.reindexWorkspace': { workspaceId: string };
  'meeting.analyze': { meetingId: string };
  'insights.refresh': { projectId: string };
}
export type JobName = keyof JobPayloads;
type JobHandler<K extends JobName> = (data: JobPayloads[K], job?: Job) => Promise<void>;

interface EnqueueOptions {
  delayMs?: number;
  /** Dedupe key: a job with the same id already waiting is not added again (BullMQ only). */
  jobId?: string;
  attempts?: number;
}

const handlers = new Map<JobName, JobHandler<JobName>>();
const timers: NodeJS.Timeout[] = [];
let queue: Queue | null = null;
let worker: Worker | null = null;

export function defineJob<K extends JobName>(name: K, handler: JobHandler<K>): void {
  if (handlers.has(name)) logger.warn({ name }, 'Job handler redefined');
  handlers.set(name, handler as JobHandler<JobName>);
}

async function run<K extends JobName>(name: K, data: JobPayloads[K], job?: Job): Promise<void> {
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ name }, 'No handler registered for job');
    return;
  }
  await handler(data, job);
}

export async function enqueue<K extends JobName>(name: K, data: JobPayloads[K], opts: EnqueueOptions = {}): Promise<void> {
  if (isTest) {
    await run(name, data);
    return;
  }
  if (queue) {
    await queue.add(name, data, {
      delay: opts.delayMs,
      jobId: opts.jobId,
      attempts: opts.attempts ?? 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 500,
      removeOnFail: 1000,
    });
    return;
  }
  const exec = () => run(name, data).catch((err) => logger.error({ err, name }, 'In-process job failed'));
  if (opts.delayMs) setTimeout(exec, opts.delayMs).unref();
  else setImmediate(exec);
}

/** Run `name` every `everyMs`. Idempotent per name in BullMQ (repeat key). */
export async function scheduleRepeating<K extends JobName>(name: K, data: JobPayloads[K], everyMs: number): Promise<void> {
  if (isTest) return;
  if (queue) {
    await queue.add(name, data, { repeat: { every: everyMs }, jobId: `repeat:${name}`, removeOnComplete: 50, removeOnFail: 100 });
    return;
  }
  const t = setInterval(() => void run(name, data).catch((err) => logger.error({ err, name }, 'Repeating job failed')), everyMs);
  t.unref();
  timers.push(t);
}

export async function startJobs(): Promise<void> {
  if (isTest) return;
  if (features.redis && env.REDIS_URL) {
    const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('nexus', { connection });
    worker = new Worker(
      'nexus',
      async (job) => run(job.name as JobName, job.data as JobPayloads[JobName], job),
      { connection: connection.duplicate(), concurrency: 5 },
    );
    worker.on('failed', (job, err) => logger.error({ err, name: job?.name, id: job?.id }, 'Job failed'));
    logger.info('BullMQ worker started');
  } else {
    logger.info('REDIS_URL not set: running background jobs in-process');
  }
}

export async function stopJobs(): Promise<void> {
  timers.forEach(clearInterval);
  await Promise.allSettled([worker?.close(), queue?.close()]);
}

import { Types } from 'mongoose';
import type { AiUsageDto, AiUsageTotals } from '@nexus/shared';
import { env } from '../../config/env';
import { AiUsage } from '../../models/AiUsage';
import { aiQuotaUsedToday } from './ai.client';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Row {
  _id: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const sums = {
  calls: { $sum: 1 },
  inputTokens: { $sum: '$inputTokens' },
  outputTokens: { $sum: '$outputTokens' },
  cacheReadTokens: { $sum: '$cacheReadTokens' },
  cacheWriteTokens: { $sum: '$cacheWriteTokens' },
};

const totalsOf = (r: Omit<Row, '_id'> | undefined): AiUsageTotals => ({
  calls: r?.calls ?? 0,
  inputTokens: r?.inputTokens ?? 0,
  outputTokens: r?.outputTokens ?? 0,
  cacheReadTokens: r?.cacheReadTokens ?? 0,
  cacheWriteTokens: r?.cacheWriteTokens ?? 0,
});

/** Token usage for the last `days` UTC days (today included), from the per-call AiUsage log. */
export async function workspaceUsage(workspaceId: string, days: number, now = new Date()): Promise<AiUsageDto> {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(todayStart - (days - 1) * DAY_MS);
  const match = { $match: { workspaceId: new Types.ObjectId(workspaceId), createdAt: { $gte: since } } };

  const [byFeature, byDay, usedToday] = await Promise.all([
    AiUsage.aggregate<Row>([match, { $group: { _id: '$feature', ...sums } }, { $sort: { calls: -1 } }]),
    AiUsage.aggregate<Row>([
      match,
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, ...sums } },
    ]),
    aiQuotaUsedToday(workspaceId),
  ]);

  const total = byFeature.reduce<Omit<Row, '_id'>>(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.cacheWriteTokens,
    }),
    totalsOf(undefined),
  );
  const perDay = new Map(byDay.map((r) => [r._id, r]));

  return {
    workspaceId,
    periodDays: days,
    totals: totalsOf(total),
    byFeature: byFeature.map((r) => ({ feature: r._id, ...totalsOf(r) })),
    byDay: Array.from({ length: days }, (_, i) => {
      const date = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10);
      const r = perDay.get(date);
      return { date, calls: r?.calls ?? 0, inputTokens: r?.inputTokens ?? 0, outputTokens: r?.outputTokens ?? 0 };
    }),
    quota: { limit: env.AI_DAILY_LIMIT, usedToday },
  };
}

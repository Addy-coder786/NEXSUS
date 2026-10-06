import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env, features, isTest } from '../../../config/env';
import { logger } from '../../../config/logger';
import { ApiError } from '../../../utils/ApiError';
import { asyncHandler } from '../../../utils/asyncHandler';
import type { SlackMessage } from './slack.client';
import { deleteSlackMessage, importSlackMessage, updateSlackMessage, type ImportContext } from './slack.import';
import { findIntegrationsByTeam, findSyncedChannel, tokenOf } from './slack.service';

const SIGNATURE_WINDOW_SEC = 5 * 60;

type RequestWithRawBody = Request & { rawBody?: Buffer };

/** Computes Slack's `v0=` HMAC-SHA256 signature for a request body. */
export function slackSignature(secret: string, timestamp: string, rawBody: Buffer | string): string {
  const base = `v0:${timestamp}:${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`;
  return `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
}

/** Verifies `X-Slack-Signature` / `X-Slack-Request-Timestamp` against `req.rawBody`. */
export function verifySlackRequest(req: RequestWithRawBody, now = Date.now()): boolean {
  const secret = env.SLACK_SIGNING_SECRET;
  const signature = req.header('x-slack-signature');
  const timestamp = req.header('x-slack-request-timestamp');
  if (!secret || !signature || !timestamp || !req.rawBody) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > SIGNATURE_WINDOW_SEC) return false;

  const expected = Buffer.from(slackSignature(secret, timestamp, req.rawBody));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: SlackMessage;
}

/** Routes one Events API `message` event to the matching mirrored channel(s). */
export async function processSlackEvent(envelope: SlackEventEnvelope): Promise<void> {
  const event = envelope.event;
  if (!event || event.type !== 'message' || !event.channel || !envelope.team_id) return;

  const integrations = await findIntegrationsByTeam(envelope.team_id);
  for (const integration of integrations) {
    const synced = await findSyncedChannel(integration, event.channel);
    if (!synced) continue;
    const ctx: ImportContext = { integration, token: tokenOf(integration), channel: synced.channel };

    if (event.subtype === 'message_changed') {
      await updateSlackMessage(ctx, event.message);
    } else if (event.subtype === 'message_deleted') {
      await deleteSlackMessage(ctx, event.deleted_ts ?? event.previous_message?.ts);
    } else {
      await importSlackMessage(ctx, event);
    }
  }
}

const router = Router();

/**
 * POST /integrations/slack/events — Slack Events API endpoint. Mounted without `authenticate`;
 * the request signature is the only credential. Responds 200 immediately and processes the event
 * asynchronously (awaited in tests for deterministic assertions).
 */
router.post(
  '/events',
  asyncHandler(async (req, res) => {
    if (!features.slackIntegration) throw ApiError.notFound('Slack integration is not available');
    if (!verifySlackRequest(req)) throw ApiError.unauthorized('Invalid Slack signature');

    const envelope = req.body as SlackEventEnvelope;
    if (envelope.type === 'url_verification') {
      res.json({ challenge: envelope.challenge ?? '' });
      return;
    }

    if (envelope.type === 'event_callback') {
      const work = processSlackEvent(envelope).catch((err) => logger.error({ err }, 'Slack event processing failed'));
      if (isTest) await work;
      else void work;
    }
    res.status(200).json({ ok: true });
  }),
);

export const slackWebhookRoutes = router;

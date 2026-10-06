import { env } from '../../../config/env';

/**
 * Thin fetch-based Slack Web API client. Every call goes through `callSlack` so tests can mock
 * `global.fetch`. Requests are form-encoded (accepted by every Slack method); object values such
 * as Block Kit `blocks` are JSON-encoded as Slack expects.
 */

export const SLACK_API_BASE = 'https://slack.com/api';

export class SlackApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly code: string,
  ) {
    super(`Slack ${method} failed: ${code}`);
    this.name = 'SlackApiError';
  }
}

export interface SlackOk {
  ok: boolean;
  error?: string;
  response_metadata?: { next_cursor?: string };
}

export interface SlackOAuthAccess extends SlackOk {
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: { id: string; name: string };
  authed_user?: { id: string };
}

export interface SlackConversation {
  id: string;
  name: string;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
  num_members?: number;
}

export interface SlackFile {
  id?: string;
  name?: string;
  title?: string;
}

export interface SlackMessage {
  type?: string;
  subtype?: string;
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
  files?: SlackFile[];
  /** message_changed / message_deleted carry the affected message here */
  message?: SlackMessage;
  previous_message?: SlackMessage;
  deleted_ts?: string;
  channel?: string;
  channel_type?: string;
  event_ts?: string;
  hidden?: boolean;
}

export interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: {
    email?: string;
    real_name?: string;
    display_name?: string;
    image_72?: string;
    image_48?: string;
    image_192?: string;
  };
}

export interface SlackTeam {
  id: string;
  name: string;
  domain?: string;
  icon?: { image_88?: string; image_132?: string; image_default?: boolean };
}

type Param = string | number | boolean | undefined | null | object;

export async function callSlack<T extends SlackOk>(
  method: string,
  token: string | null,
  body: Record<string, Param> = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${SLACK_API_BASE}/${method}`, { method: 'POST', headers, body: params.toString() });
  if (!res.ok) throw new SlackApiError(method, `http_${res.status}`);
  const json = (await res.json()) as T;
  if (!json.ok) throw new SlackApiError(method, json.error ?? 'unknown_error');
  return json;
}

// ---------- typed wrappers ----------

export function oauthAccess(code: string, redirectUri: string): Promise<SlackOAuthAccess> {
  return callSlack<SlackOAuthAccess>('oauth.v2.access', null, {
    client_id: env.SLACK_CLIENT_ID,
    client_secret: env.SLACK_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
  });
}

export async function authRevoke(token: string): Promise<void> {
  await callSlack<SlackOk & { revoked?: boolean }>('auth.revoke', token);
}

export async function teamInfo(token: string): Promise<SlackTeam> {
  const res = await callSlack<SlackOk & { team: SlackTeam }>('team.info', token);
  return res.team;
}

/** Public + private channels visible to the bot (follows pagination). */
export async function conversationsList(token: string): Promise<SlackConversation[]> {
  const all: SlackConversation[] = [];
  let cursor: string | undefined;
  do {
    const res = await callSlack<SlackOk & { channels: SlackConversation[] }>('conversations.list', token, {
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });
    all.push(...res.channels);
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor && all.length < 2000);
  return all;
}

export async function conversationsJoin(token: string, channel: string): Promise<void> {
  await callSlack<SlackOk>('conversations.join', token, { channel });
}

export async function conversationsHistory(
  token: string,
  channel: string,
  opts: { oldest?: string | null; limit?: number } = {},
): Promise<SlackMessage[]> {
  const res = await callSlack<SlackOk & { messages: SlackMessage[] }>('conversations.history', token, {
    channel,
    limit: opts.limit ?? 200,
    oldest: opts.oldest ?? undefined,
    inclusive: false,
  });
  return res.messages;
}

export async function usersInfo(token: string, user: string): Promise<SlackUser> {
  const res = await callSlack<SlackOk & { user: SlackUser }>('users.info', token, { user });
  return res.user;
}

export interface PostMessageInput {
  channel: string;
  text: string;
  blocks?: unknown[];
  unfurl_links?: boolean;
}

export async function chatPostMessage(token: string, input: PostMessageInput): Promise<{ ts: string; channel: string }> {
  const res = await callSlack<SlackOk & { ts: string; channel: string }>('chat.postMessage', token, {
    channel: input.channel,
    text: input.text,
    blocks: input.blocks,
    unfurl_links: input.unfurl_links ?? false,
  });
  return { ts: res.ts, channel: res.channel };
}

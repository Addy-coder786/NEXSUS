import type { AiStreamEvent } from '@nexus/shared';
import { API_BASE, ApiClientError, refreshSession } from '@/lib/api';

/**
 * Incremental parser for a `text/event-stream` body. Feed it decoded chunks; it calls `onEvent`
 * for every complete `data:` frame and ignores comments (heartbeats) and partial frames.
 */
export function createSseParser(onEvent: (event: AiStreamEvent) => void): (chunk: string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data) {
        try {
          onEvent(JSON.parse(data) as AiStreamEvent);
        } catch {
          // A malformed frame is skipped rather than breaking the stream.
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  };
}

async function toError(res: Response): Promise<ApiClientError> {
  try {
    const body = (await res.json()) as { error?: { code: string; message: string } };
    if (body.error)
      return new ApiClientError({
        status: res.status,
        code: body.error.code,
        message: body.error.message,
      });
  } catch {
    // fall through
  }
  return new ApiClientError({
    status: res.status,
    code: 'INTERNAL_ERROR',
    message: `Request failed with status ${res.status}`,
  });
}

/**
 * POSTs a message and streams the assistant's reply. Resolves when the stream ends. Errors
 * before the stream opens (403, 429, 503 ...) reject with ApiClientError; an expired access
 * token is refreshed once, like the axios client does.
 */
export async function streamAssistantMessage(
  conversationId: string,
  content: string,
  onEvent: (event: AiStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const send = () =>
    fetch(`${API_BASE}/ai/conversations/${conversationId}/messages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ content }),
      signal,
    });

  let res = await send();
  if (res.status === 401) {
    await refreshSession();
    res = await send();
  }
  if (!res.ok || !res.body) throw await toError(res);

  const parse = createSseParser(onEvent);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parse(decoder.decode(value, { stream: true }));
  }
  parse(decoder.decode());
}

/** Hides a trailing ```nexus-action block while it is still streaming in. */
export function stripActionBlock(text: string): string {
  const idx = text.indexOf('```nexus-action');
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

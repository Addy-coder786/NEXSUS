import type Anthropic from '@anthropic-ai/sdk';
import { setAnthropicClient } from '../src/modules/ai/ai.client';

/**
 * A scripted stand-in for the Anthropic SDK client. Each call to `beta.messages.create` or
 * `beta.messages.stream` takes the next reply from the queue; requests are recorded for
 * assertions. Text blocks of streamed replies are emitted to `on('text')` listeners.
 */

type Block = Record<string, unknown> & { type: string };
export interface FakeReply {
  content: Block[];
  stop_reason?: string;
}
type ReplyFn = (params: Record<string, unknown>) => FakeReply | Error;

export const text = (t: string): Block => ({ type: 'text', text: t, citations: null });
export const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input });
export const json = (value: unknown): FakeReply => ({ content: [text(JSON.stringify(value))], stop_reason: 'end_turn' });

function toMessage(reply: FakeReply) {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: reply.content,
    stop_reason: reply.stop_reason ?? 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
  };
}

export class FakeClaude {
  readonly requests: Record<string, unknown>[] = [];
  private queue: ReplyFn[] = [];

  /** Queue replies (or errors) in order. */
  reply(...replies: (FakeReply | Error | ReplyFn)[]): this {
    for (const r of replies) this.queue.push(typeof r === 'function' ? r : () => r);
    return this;
  }

  private next(params: Record<string, unknown>) {
    this.requests.push(params);
    const fn = this.queue.shift();
    if (!fn) throw new Error('FakeClaude: no scripted reply left');
    return fn(params);
  }

  readonly beta = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        const reply = this.next(params);
        if (reply instanceof Error) throw reply;
        return toMessage(reply);
      },
      stream: (params: Record<string, unknown>) => {
        const listeners: ((delta: string) => void)[] = [];
        const reply = this.next(params);
        return {
          on(event: string, cb: (delta: string) => void) {
            if (event === 'text') listeners.push(cb);
            return this;
          },
          async finalMessage() {
            await Promise.resolve();
            if (reply instanceof Error) throw reply;
            for (const block of reply.content) if (block.type === 'text') listeners.forEach((l) => l(block.text as string));
            return toMessage(reply);
          },
        };
      },
    },
  };

  get pending(): number {
    return this.queue.length;
  }
}

export function installFakeClaude(): FakeClaude {
  const fake = new FakeClaude();
  setAnthropicClient(fake as unknown as Anthropic);
  return fake;
}

/** Parses an SSE body into its `data:` JSON events. */
export function parseSse<T = Record<string, unknown>>(body: string): T[] {
  return body
    .split('\n\n')
    .map((frame) => frame.split('\n').find((l) => l.startsWith('data: ')))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)) as T);
}

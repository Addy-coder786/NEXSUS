import { describe, expect, it } from 'vitest';
import type { AiStreamEvent } from '@nexus/shared';
import { createSseParser, stripActionBlock } from '../stream';

describe('createSseParser', () => {
  it('emits complete frames across chunk boundaries and skips heartbeats', () => {
    const events: AiStreamEvent[] = [];
    const feed = createSseParser((e) => events.push(e));
    feed('data: {"type":"text_delta","te');
    expect(events).toHaveLength(0);
    feed('xt":"Hel"}\n\n: ping\n\ndata: {"type":"text_delta","text":"lo"}\r\n\r\n');
    feed('data: not json\n\n');
    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ]);
  });
});

describe('stripActionBlock', () => {
  it('hides a partially streamed nexus-action block', () => {
    expect(stripActionBlock('Plan:\n1. A\n\n```nexus-act')).toBe('Plan:\n1. A\n\n```nexus-act');
    expect(stripActionBlock('Plan:\n1. A\n\n```nexus-action\n{"ty')).toBe('Plan:\n1. A');
    expect(stripActionBlock('No block')).toBe('No block');
  });
});

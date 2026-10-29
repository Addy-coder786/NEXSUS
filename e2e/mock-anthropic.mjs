// A stand-in for the Anthropic Messages API used by the e2e stack (ANTHROPIC_BASE_URL points
// here). The API under test talks to it through the real SDK, so request shapes, SSE parsing
// and the assistant's tool loop are all exercised. Responses are deterministic.
import http from 'node:http';

const MODEL = 'claude-opus-5-5';
const usage = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const systemText = (body) =>
  (Array.isArray(body.system) ? body.system.map((b) => b.text ?? '').join('\n') : String(body.system ?? ''));

/** JSON for the structured-output features, chosen by their system prompt. */
function structured(body) {
  const system = systemText(body);
  if (system.includes('task plan')) {
    return {
      summary: 'Checkout flow',
      tasks: [
        { draftId: 't1', title: 'Design the checkout API', description: 'Endpoints and payloads.', priority: 'HIGH', assigneeId: null, assigneeReason: null, estimateHours: 4, dependsOnDraftIds: [], parentDraftId: null, labels: [] },
        { draftId: 't2', title: 'Build the payment form', description: 'Card form with validation.', priority: 'MEDIUM', assigneeId: null, assigneeReason: null, estimateHours: 6, dependsOnDraftIds: ['t1'], parentDraftId: null, labels: [] },
      ],
    };
  }
  if (system.includes('meeting transcripts')) {
    return {
      summary: 'The team agreed to ship the beta on Friday.',
      decisions: [{ text: 'Ship the beta on Friday', context: null }],
      actionItems: [{ text: 'Fix the login redirect', ownerName: null, dueHint: 'Thursday', priority: 'HIGH' }],
      openQuestions: ['Who owns the pricing page?'],
      risks: ['The login bug could delay the beta'],
    };
  }
  if (system.includes('summarise team documents')) {
    return { summary: 'A short summary of the document.', keyPoints: ['First point'], actionItems: [] };
  }
  if (system.includes('delivery lead')) {
    return { narrative: 'The project is on track.', blockers: [], risks: [], recommendations: ['Keep going'], recentHighlights: [] };
  }
  return { summary: 'A quiet week.', highlights: [], atRiskProjects: [] };
}

/** Assistant turns: first ask for list_tasks, then answer from the tool result. */
function assistantTurn(body) {
  const last = body.messages[body.messages.length - 1];
  const toolResult = Array.isArray(last?.content) ? last.content.find((b) => b.type === 'tool_result') : null;
  const question = body.messages.find((m) => m.role === 'user' && typeof m.content === 'string')?.content ?? '';

  if (!toolResult && body.tool_choice?.type !== 'none') {
    return {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Let me check your tasks.' },
        {
          type: 'tool_use',
          id: 'toolu_e2e_1',
          name: 'list_tasks',
          input: { projectId: null, status: null, assignee: null, overdue: null, dueWithinDays: null, priority: null, limit: null },
        },
      ],
    };
  }
  let tasks = [];
  try {
    tasks = JSON.parse(typeof toolResult.content === 'string' ? toolResult.content : '{}').tasks ?? [];
  } catch {
    tasks = [];
  }
  const list = tasks.map((t) => `- **${t.key}** ${t.title}`).join('\n') || 'No tasks found.';
  const plan = /plan/i.test(question) ? '\n\n```nexus-action\n{"type":"generate_tasks"}\n```' : '';
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: `Here is what is open:\n\n${list}${plan}` }] };
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Streams a reply as Messages API events, splitting text into small deltas. */
function stream(res, reply) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  sse(res, 'message_start', {
    type: 'message_start',
    message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage },
  });
  reply.content.forEach((block, index) => {
    if (block.type === 'text') {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const piece of block.text.match(/[\s\S]{1,12}/g) ?? []) {
        sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
      }
    } else {
      sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
      sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    sse(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
  sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: reply.stop_reason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  sse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

export function startMockAnthropic(port) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Not found' } }));
        return;
      }
      const body = JSON.parse(raw);
      if (body.stream) return stream(res, assistantTurn(body));
      const message = {
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content: [{ type: 'text', text: JSON.stringify(structured(body)) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(message));
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

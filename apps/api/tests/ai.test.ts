import './ai.env';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AiConversationDto,
  AiStreamEvent,
  DocumentDto,
  GenerateTasksResultDto,
  ProjectDto,
  ProjectInsightDto,
  TaskDto,
  WorkspaceDto,
  WorkspaceRole,
} from '@nexus/shared';
import { cache } from '../src/config/redis';
import { Activity } from '../src/models/Activity';
import { AiMessage } from '../src/models/AiConversation';
import { AiUsage } from '../src/models/AiUsage';
import { Notification } from '../src/models/Notification';
import { Task } from '../src/models/Task';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { setAnthropicClient } from '../src/modules/ai/ai.client';
import { autoTitle, extractSuggestedAction } from '../src/modules/ai/assistant.service';
import { runTool } from '../src/modules/ai/assistant.tools';
import { orderDrafts, sanitizeDrafts } from '../src/modules/ai/taskgen.service';
import { installFakeClaude, json, parseSse, text, toolUse, type FakeClaude } from './ai.fake';
import { api, createTestUser, type TestUser } from './helpers';

// ---------- fixtures ----------

async function createWorkspace(owner: TestUser) {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'Acme' });
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

async function addMember(wsId: string, role: WorkspaceRole, name?: string): Promise<TestUser> {
  const user = await createTestUser(name ? { name } : {});
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

async function createProject(actor: TestUser, wsId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/workspaces/${wsId}/projects`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as ProjectDto;
}

async function createTask(actor: TestUser, projectId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/projects/${projectId}/tasks`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as TaskDto;
}

const richDoc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});

interface Fixture {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  viewer: TestUser;
  ws: WorkspaceDto;
  web: ProjectDto;
  secret: ProjectDto;
}

/** WEB has the member; SECRET has nobody but the owner (MANAGER+ sees it anyway). */
async function fixture(): Promise<Fixture> {
  const owner = await createTestUser({ name: 'Olivia Owner' });
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER', 'Maya Patel');
  const outsider = await addMember(ws.id, 'MEMBER', 'Omar Out');
  const viewer = await addMember(ws.id, 'VIEWER', 'Vic Viewer');
  const web = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id, viewer.id] });
  const secret = await createProject(owner, ws.id, { name: 'Secret', key: 'SEC', memberIds: [] });
  return { owner, member, outsider, viewer, ws, web, secret };
}

let fake: FakeClaude;
beforeEach(() => {
  fake = installFakeClaude();
});
afterAll(() => setAnthropicClient(null));

// ---------- status ----------

describe('GET /ai/status', () => {
  it('reports AI as enabled with the configured model', async () => {
    const user = await createTestUser();
    const res = await api().get('/api/ai/status').set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: true, semanticSearch: false, model: 'claude-opus-5-5' });
  });
});

// ---------- conversations ----------

describe('conversations', () => {
  it('creates, lists (own only), renames and deletes; others get 404', async () => {
    const f = await fixture();
    const created = await api().post(`/api/ai/workspaces/${f.ws.id}/conversations`).set('Cookie', f.member.cookie).send({});
    expect(created.status).toBe(201);
    const conv = created.body.data as AiConversationDto;
    expect(conv).toMatchObject({ scope: 'workspace', scopeId: null, title: 'New conversation' });

    await api().post(`/api/ai/workspaces/${f.ws.id}/conversations`).set('Cookie', f.owner.cookie).send({});
    const list = await api().get(`/api/ai/workspaces/${f.ws.id}/conversations`).set('Cookie', f.member.cookie);
    expect(list.body.data.map((c: AiConversationDto) => c.id)).toEqual([conv.id]);

    expect((await api().get(`/api/ai/conversations/${conv.id}`).set('Cookie', f.owner.cookie)).status).toBe(404);
    const renamed = await api().patch(`/api/ai/conversations/${conv.id}`).set('Cookie', f.member.cookie).send({ title: 'Launch plan' });
    expect(renamed.body.data.title).toBe('Launch plan');
    expect((await api().delete(`/api/ai/conversations/${conv.id}`).set('Cookie', f.member.cookie)).status).toBe(204);
    expect((await api().get(`/api/ai/conversations/${conv.id}`).set('Cookie', f.member.cookie)).status).toBe(404);
  });

  it('checks project scope access', async () => {
    const f = await fixture();
    const denied = await api()
      .post(`/api/ai/workspaces/${f.ws.id}/conversations`)
      .set('Cookie', f.outsider.cookie)
      .send({ scope: 'project', scopeId: f.web.id });
    expect(denied.status).toBe(403);
    const missing = await api().post(`/api/ai/workspaces/${f.ws.id}/conversations`).set('Cookie', f.member.cookie).send({ scope: 'project' });
    expect(missing.status).toBe(400);
    const ok = await api()
      .post(`/api/ai/workspaces/${f.ws.id}/conversations`)
      .set('Cookie', f.member.cookie)
      .send({ scope: 'project', scopeId: f.web.id });
    expect(ok.status).toBe(201);
  });

  it('rejects non-members', async () => {
    const f = await fixture();
    const stranger = await createTestUser();
    const res = await api().get(`/api/ai/workspaces/${f.ws.id}/conversations`).set('Cookie', stranger.cookie);
    expect(res.status).toBe(403);
  });
});

// ---------- assistant turn (SSE) ----------

async function startConversation(user: TestUser, wsId: string, body: Record<string, unknown> = {}) {
  const res = await api().post(`/api/ai/workspaces/${wsId}/conversations`).set('Cookie', user.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as AiConversationDto;
}

async function ask(user: TestUser, conversationId: string, content: string) {
  const res = await api().post(`/api/ai/conversations/${conversationId}/messages`).set('Cookie', user.cookie).send({ content });
  return { res, events: res.status === 200 ? parseSse<AiStreamEvent>(res.text) : [] };
}

describe('POST /ai/conversations/:id/messages', () => {
  it('runs the tool loop, streams events, persists both messages and logs usage', async () => {
    const f = await fixture();
    const mine = await createTask(f.owner, f.web.id, { title: 'Fix login redirect', assigneeId: f.member.id, priority: 'HIGH' });
    await createTask(f.owner, f.secret.id, { title: 'Secret thing' });
    const conv = await startConversation(f.member, f.ws.id);

    fake.reply(
      { content: [text('Let me check.'), toolUse('tu_1', 'list_tasks', { projectId: null, status: null, assignee: 'me', overdue: null, dueWithinDays: null, priority: null, limit: null })], stop_reason: 'tool_use' },
      { content: [text(`You have one task: ${mine.key}.`)], stop_reason: 'end_turn' },
    );

    const { res, events } = await ask(f.member, conv.id, 'What is on my plate this week?');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('user_message');
    expect(types).toContain('tool_call');
    expect(types).toContain('text_delta');
    expect(types).toContain('sources');
    expect(types[types.length - 1]).toBe('done');

    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>;
    expect(done.message.content).toBe(`Let me check.\n\nYou have one task: ${mine.key}.`);
    expect(done.message.toolCalls).toEqual([{ name: 'list_tasks', label: 'Listed tasks', resultCount: 1 }]);
    expect(done.message.sources).toEqual([expect.objectContaining({ type: 'task', id: mine.id, link: `/w/${f.ws.id}/projects/${f.web.id}/board?task=${mine.id}` })]);

    // Request shape: model, fallbacks, explicit effort, cached stable system prompt, no thinking config.
    const first = fake.requests[0] as Record<string, unknown> & { system: { cache_control?: unknown }[] };
    expect(first).toMatchObject({ model: 'claude-opus-5-5', betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium' } });
    expect(first).not.toHaveProperty('thinking');
    expect(first).not.toHaveProperty('tool_choice');
    expect(first.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    // The tool result went back in one user message and only shows visible tasks.
    const second = fake.requests[1] as { messages: { role: string; content: unknown }[] };
    const toolResult = JSON.stringify(second.messages[second.messages.length - 1]);
    expect(toolResult).toContain(mine.key);
    expect(toolResult).not.toContain('Secret thing');

    const stored = await AiMessage.find({ conversationId: conv.id }).sort({ createdAt: 1 }).lean();
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(await AiUsage.countDocuments({ workspaceId: f.ws.id, feature: 'assistant' })).toBe(2);

    const detail = await api().get(`/api/ai/conversations/${conv.id}`).set('Cookie', f.member.cookie);
    expect(detail.body.data.title).toBe('What is on my plate this week?');
    expect(detail.body.data.messages).toHaveLength(2);
  });

  it('turns a trailing nexus-action block into a suggested action', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    fake.reply({ content: [text('1. Build checkout\n2. Add webhooks\n\n```nexus-action\n{"type":"generate_tasks"}\n```')] });
    const { events } = await ask(f.member, conv.id, 'Plan a payment system');
    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>;
    expect(done.message.content).toBe('1. Build checkout\n2. Add webhooks');
    expect(done.message.suggestedAction).toEqual({ type: 'generate_tasks', text: '1. Build checkout\n2. Add webhooks' });
  });

  it('records refusals with the standard text', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    fake.reply({ content: [], stop_reason: 'refusal' });
    const { events } = await ask(f.member, conv.id, 'Something disallowed');
    const done = events.find((e) => e.type === 'done') as Extract<AiStreamEvent, { type: 'done' }>;
    expect(done.message).toMatchObject({ status: 'refused', content: "I can't help with that request." });
  });

  it('reports provider errors as a safe error event', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    fake.reply(new Anthropic.RateLimitError(429, { type: 'error' }, 'upstream says slow down', new Headers()));
    const { events } = await ask(f.member, conv.id, 'Hello?');
    expect(events[events.length - 1]).toEqual({ type: 'error', code: 'RATE_LIMITED', message: 'The AI service is busy. Please try again shortly.' });
    const stored = await AiMessage.findOne({ conversationId: conv.id, role: 'assistant' }).lean();
    expect(stored?.status).toBe('error');
  });

  it('feeds tool input errors back to the model instead of failing', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    fake.reply(
      { content: [toolUse('tu_1', 'get_task', { keyOrId: '' })], stop_reason: 'tool_use' },
      { content: [text("I couldn't find that in the workspace.")] },
    );
    const { events } = await ask(f.member, conv.id, 'Open the task');
    expect(events[events.length - 1]?.type).toBe('done');
    const second = fake.requests[1] as { messages: { content: { is_error?: boolean }[] }[] };
    expect(second.messages[second.messages.length - 1]?.content[0]?.is_error).toBe(true);
  });

  it('enforces the daily workspace quota before streaming', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    await cache.set(`ai:quota:${f.ws.id}:${new Date().toISOString().slice(0, 10)}`, 500, 60);
    const { res } = await ask(f.member, conv.id, 'Hi');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('only lets the owner send messages', async () => {
    const f = await fixture();
    const conv = await startConversation(f.member, f.ws.id);
    const { res } = await ask(f.owner, conv.id, 'Hi');
    expect(res.status).toBe(404);
  });
});

describe('assistant helpers', () => {
  it('extracts suggested actions and builds titles', () => {
    expect(extractSuggestedAction('Plain answer')).toEqual({ content: 'Plain answer', suggestedAction: null });
    expect(extractSuggestedAction('Plan\n```nexus-action\nnot json\n```')).toEqual({ content: 'Plan', suggestedAction: null });
    expect(autoTitle('  a   b  ')).toBe('a b');
    expect(autoTitle('x'.repeat(80))).toHaveLength(60);
  });
});

// ---------- tools: visibility ----------

describe('assistant tools respect visibility', () => {
  it('hides projects, tasks and activity the caller cannot access', async () => {
    const f = await fixture();
    const hidden = await createTask(f.owner, f.secret.id, { title: 'Hidden roadmap' });
    const ctx = { workspaceId: f.ws.id, userId: f.member.id, role: 'MEMBER' as const, scope: 'workspace' as const, scopeId: null };

    const tasks = await runTool(ctx, 'list_tasks', { projectId: null, status: null, assignee: null, overdue: null, dueWithinDays: null, priority: null, limit: null });
    expect(JSON.stringify(tasks.result)).not.toContain('Hidden roadmap');
    expect(JSON.stringify((await runTool(ctx, 'get_task', { keyOrId: hidden.key })).result)).toContain('not found');
    expect(JSON.stringify((await runTool(ctx, 'get_project_overview', { projectId: f.secret.id, name: null })).result)).toContain('not found');
    const activity = await runTool(ctx, 'recent_activity', { projectId: null, sinceDays: 7 });
    expect(JSON.stringify(activity.result)).not.toContain('Hidden roadmap');

    const ownerCtx = { ...ctx, userId: f.owner.id, role: 'OWNER' as const };
    expect(JSON.stringify((await runTool(ownerCtx, 'get_task', { keyOrId: hidden.key.toLowerCase() })).result)).toContain('Hidden roadmap');
  });

  it('resolves assignees by name and reads documents with truncation notes', async () => {
    const f = await fixture();
    await createTask(f.owner, f.web.id, { title: 'Maya task', assigneeId: f.member.id });
    const ctx = { workspaceId: f.ws.id, userId: f.owner.id, role: 'OWNER' as const, scope: 'workspace' as const, scopeId: null };
    const byName = await runTool(ctx, 'list_tasks', { projectId: null, status: null, assignee: 'maya', overdue: null, dueWithinDays: null, priority: null, limit: 5 });
    expect(byName.resultCount).toBe(1);

    const docRes = await api()
      .post(`/api/workspaces/${f.ws.id}/documents`)
      .set('Cookie', f.owner.cookie)
      .send({ title: 'Architecture', content: richDoc('A'.repeat(21_000)) });
    const doc = docRes.body.data as DocumentDto;
    const read = await runTool(ctx, 'get_document', { documentId: null, title: 'architecture' });
    expect(read.result).toMatchObject({ id: doc.id, note: expect.stringContaining('Truncated') });
    await expect(runTool(ctx, 'nope', {})).rejects.toThrow('Unknown tool');
  });
});

// ---------- task generation ----------

describe('task generation', () => {
  it('returns sanitized drafts without saving anything', async () => {
    const f = await fixture();
    fake.reply(
      json({
        summary: 'Payment system',
        tasks: [
          { draftId: 't1', title: 'Design schema', description: 'Tables for payments', priority: 'HIGH', assigneeId: f.member.id, assigneeReason: 'Backend', estimateHours: 4.2, dependsOnDraftIds: [], parentDraftId: null, labels: [] },
          { draftId: 't2', title: 'Build API', description: 'Endpoints', priority: 'MEDIUM', assigneeId: f.outsider.id, assigneeReason: 'x', estimateHours: null, dependsOnDraftIds: ['t1', 'ghost', 't2'], parentDraftId: null, labels: ['nonexistent'] },
          { draftId: 't1', title: 'Duplicate', description: '', priority: 'LOW', assigneeId: null, assigneeReason: null, estimateHours: null, dependsOnDraftIds: [], parentDraftId: null, labels: [] },
        ],
      }),
    );
    const before = await Task.countDocuments();
    const res = await api().post(`/api/ai/projects/${f.web.id}/generate-tasks`).set('Cookie', f.member.cookie).send({ text: 'We need a payment system with Stripe' });
    expect(res.status).toBe(200);
    const result = res.body.data as GenerateTasksResultDto;
    expect(result.summary).toBe('Payment system');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toMatchObject({ assigneeId: f.member.id, estimateHours: 4 });
    expect(result.tasks[1]).toMatchObject({ assigneeId: null, assigneeReason: null, dependsOnDraftIds: ['t1'], labels: [] });
    expect(await Task.countDocuments()).toBe(before);

    const req = fake.requests[0] as { output_config: { effort: string; format: { type: string } }; messages: { content: string }[] };
    expect(req.output_config.effort).toBe('high');
    expect(req.output_config.format.type).toBe('json_schema');
    expect(req.messages[0]?.content).toContain('<workspace_data');
    expect(await AiUsage.countDocuments({ feature: 'generate_tasks' })).toBe(1);
  });

  it('enforces permissions and project access', async () => {
    const f = await fixture();
    const viewer = await api().post(`/api/ai/projects/${f.web.id}/generate-tasks`).set('Cookie', f.viewer.cookie).send({ text: 'Some feature text' });
    expect(viewer.status).toBe(403);
    const outsider = await api().post(`/api/ai/projects/${f.web.id}/generate-tasks`).set('Cookie', f.outsider.cookie).send({ text: 'Some feature text' });
    expect(outsider.status).toBe(403);
    const empty = await api().post(`/api/ai/projects/${f.web.id}/generate-tasks`).set('Cookie', f.member.cookie).send({});
    expect(empty.status).toBe(422);
  });

  it('commits drafts in dependency order and records provenance', async () => {
    const f = await fixture();
    const res = await api()
      .post(`/api/ai/projects/${f.web.id}/commit-tasks`)
      .set('Cookie', f.owner.cookie)
      .send({
        source: { type: 'text' },
        tasks: [
          { draftId: 'b', title: 'Build API', dependsOnDraftIds: ['a'], assigneeId: f.member.id },
          { draftId: 'c', title: 'Write endpoint tests', parentDraftId: 'b' },
          { draftId: 'a', title: 'Design schema', priority: 'HIGH' },
        ],
      });
    expect(res.status).toBe(201);
    const [b, c, a] = res.body.data as TaskDto[];
    expect([b?.title, c?.title, a?.title]).toEqual(['Build API', 'Write endpoint tests', 'Design schema']);
    expect(b?.dependsOn).toEqual([a?.id]);
    expect(c?.parentTaskId).toBe(b?.id);

    const activity = await Activity.findOne({ type: 'AI_TASKS_GENERATED' }).lean();
    expect(activity?.metadata).toMatchObject({ count: 3, source: 'text' });
    expect(await Notification.countDocuments({ userId: f.member.id, type: 'AI_TASK_CREATED' })).toBe(1);
  });

  it('rejects cycles and unknown references', async () => {
    expect(() => orderDrafts([{ draftId: 'a', title: 'A', priority: 'LOW', dependsOnDraftIds: ['b'] }, { draftId: 'b', title: 'B', priority: 'LOW', dependsOnDraftIds: ['a'] }])).toThrow('cycle');
    expect(() => orderDrafts([{ draftId: 'a', title: 'A', priority: 'LOW', dependsOnDraftIds: ['zzz'] }])).toThrow('Unknown');
    const nested = sanitizeDrafts(
      [
        { draftId: 'p', title: 'P', description: '', priority: 'LOW', assigneeId: null, assigneeReason: null, estimateHours: null, dependsOnDraftIds: [], parentDraftId: null, labels: [] },
        { draftId: 'c', title: 'C', description: '', priority: 'LOW', assigneeId: null, assigneeReason: null, estimateHours: null, dependsOnDraftIds: [], parentDraftId: 'p', labels: [] },
        { draftId: 'g', title: 'G', description: '', priority: 'LOW', assigneeId: null, assigneeReason: null, estimateHours: null, dependsOnDraftIds: [], parentDraftId: 'c', labels: [] },
      ],
      new Set(),
      new Map(),
      10,
    );
    expect(nested.map((d) => d.parentDraftId)).toEqual([null, 'p', null]);
  });
});

// ---------- summaries, insights, digest ----------

describe('document summaries', () => {
  it('summarizes once per version and length, then serves the cache', async () => {
    const f = await fixture();
    const docRes = await api()
      .post(`/api/workspaces/${f.ws.id}/documents`)
      .set('Cookie', f.owner.cookie)
      .send({ title: 'RFC', content: richDoc('We will move to Postgres.', 'Owners: Maya.') });
    const doc = docRes.body.data as DocumentDto;
    fake.reply(json({ summary: 'Move to Postgres.', keyPoints: ['Postgres'], actionItems: ['Plan migration'] }));

    const first = await api().post(`/api/ai/documents/${doc.id}/summarize`).set('Cookie', f.viewer.cookie).send({});
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ documentId: doc.id, version: doc.version, summary: 'Move to Postgres.' });
    expect((fake.requests[0] as { output_config: { effort: string } }).output_config.effort).toBe('low');

    const second = await api().post(`/api/ai/documents/${doc.id}/summarize`).set('Cookie', f.member.cookie).send({});
    expect(second.body.data.summary).toBe('Move to Postgres.');
    expect(fake.requests).toHaveLength(1);
  });

  it('respects project document access', async () => {
    const f = await fixture();
    const docRes = await api().post(`/api/workspaces/${f.ws.id}/documents`).set('Cookie', f.owner.cookie).send({ title: 'Secret', projectId: f.secret.id });
    const res = await api().post(`/api/ai/documents/${docRes.body.data.id}/summarize`).set('Cookie', f.member.cookie).send({});
    expect(res.status).toBe(403);
  });
});

describe('project insights', () => {
  it('uses deterministic health, caches, and invalidates on task changes', async () => {
    const f = await fixture();
    const overdue = await createTask(f.owner, f.web.id, { title: 'Late', dueDate: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    const insight = (taskId: string | null) =>
      json({ narrative: 'Behind on one task.', blockers: [{ taskId, text: 'Late task' }], risks: ['Slip'], recommendations: ['Re-plan'], recentHighlights: [] });
    fake.reply(insight(overdue.id), insight('not-a-real-id'));

    const first = await api().get(`/api/ai/projects/${f.web.id}/insights`).set('Cookie', f.member.cookie);
    expect(first.status).toBe(200);
    const dto = first.body.data as ProjectInsightDto;
    const analytics = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.member.cookie);
    expect(dto).toMatchObject({ cached: false, health: analytics.body.data.health.status, score: analytics.body.data.health.score });
    expect(dto.blockers[0]?.taskId).toBe(overdue.id);

    const cached = await api().get(`/api/ai/projects/${f.web.id}/insights`).set('Cookie', f.member.cookie);
    expect(cached.body.data.cached).toBe(true);
    expect(fake.requests).toHaveLength(1);

    await api().patch(`/api/tasks/${overdue.id}`).set('Cookie', f.owner.cookie).send({ priority: 'URGENT' });
    const rebuilt = await api().get(`/api/ai/projects/${f.web.id}/insights`).set('Cookie', f.member.cookie);
    expect(rebuilt.body.data.cached).toBe(false);
    expect(rebuilt.body.data.blockers[0].taskId).toBeNull();
  });

  it('is limited to project members', async () => {
    const f = await fixture();
    expect((await api().get(`/api/ai/projects/${f.web.id}/insights`).set('Cookie', f.outsider.cookie)).status).toBe(403);
  });
});

describe('workspace digest', () => {
  it('only names projects the caller can see', async () => {
    const f = await fixture();
    fake.reply(
      json({
        summary: 'Quiet week.',
        highlights: ['Web App started'],
        atRiskProjects: [
          { projectId: f.web.id, reason: 'Overdue work' },
          { projectId: f.secret.id, reason: 'Hidden' },
        ],
      }),
    );
    const res = await api().get(`/api/ai/workspaces/${f.ws.id}/digest?days=7`).set('Cookie', f.member.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.atRiskProjects).toEqual([{ projectId: f.web.id, name: 'Web App', reason: 'Overdue work' }]);
  });
});

describe('reindex', () => {
  it('is limited to OWNER/ADMIN and returns 202', async () => {
    const f = await fixture();
    expect((await api().post(`/api/ai/workspaces/${f.ws.id}/reindex`).set('Cookie', f.member.cookie)).status).toBe(403);
    expect((await api().post(`/api/ai/workspaces/${f.ws.id}/reindex`).set('Cookie', f.owner.cookie)).status).toBe(202);
  });
});

describe('AI usage', () => {
  it('aggregates logged calls per feature and day for OWNER/ADMIN only', async () => {
    const f = await fixture();
    fake.reply(json({ summary: 'S', keyPoints: [], actionItems: [] }));
    const docRes = await api().post(`/api/workspaces/${f.ws.id}/documents`).set('Cookie', f.owner.cookie).send({ title: 'Doc', content: richDoc('Some text here.') });
    await api().post(`/api/ai/documents/${docRes.body.data.id}/summarize`).set('Cookie', f.owner.cookie).send({});

    expect((await api().get(`/api/ai/workspaces/${f.ws.id}/usage`).set('Cookie', f.member.cookie)).status).toBe(403);
    const res = await api().get(`/api/ai/workspaces/${f.ws.id}/usage?days=7`).set('Cookie', f.owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 0 });
    expect(res.body.data.byFeature).toEqual([expect.objectContaining({ feature: 'document_summary', calls: 1 })]);
    expect(res.body.data.byDay).toHaveLength(7);
    expect(res.body.data.byDay[6]).toMatchObject({ date: new Date().toISOString().slice(0, 10), calls: 1 });
    expect(res.body.data.quota).toEqual({ limit: 500, usedToday: 1 });
  });
});

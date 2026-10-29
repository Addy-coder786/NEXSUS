import './ai.env';
import Anthropic from '@anthropic-ai/sdk';
import type { MeetingDetailDto, MeetingDto, ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Activity } from '../src/models/Activity';
import { Chunk } from '../src/models/Chunk';
import { Notification } from '../src/models/Notification';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { setAnthropicClient } from '../src/modules/ai/ai.client';
import { resolveOwner } from '../src/modules/meetings/meeting.service';
import { installFakeClaude, json, type FakeClaude } from './ai.fake';
import { api, createTestUser, type TestUser } from './helpers';

async function addMember(wsId: string, role: WorkspaceRole, name: string): Promise<TestUser> {
  const user = await createTestUser({ name });
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

interface Fixture {
  owner: TestUser;
  maya: TestUser;
  outsider: TestUser;
  ws: WorkspaceDto;
  web: ProjectDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser({ name: 'Olivia Owner' });
  const wsRes = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'Acme' });
  const ws = wsRes.body.data as WorkspaceDto;
  const maya = await addMember(ws.id, 'MEMBER', 'Maya Patel');
  const outsider = await addMember(ws.id, 'MEMBER', 'Omar Out');
  const projectRes = await api().post(`/api/workspaces/${ws.id}/projects`).set('Cookie', owner.cookie).send({ name: 'Web App', key: 'WEB', memberIds: [maya.id] });
  return { owner, maya, outsider, ws, web: projectRes.body.data as ProjectDto };
}

const TRANSCRIPT = 'Olivia: We ship the beta on Friday.\nMaya: I will fix the login redirect by Thursday.\nOlivia: Who owns the pricing page? Nobody yet.';

const analysis = {
  summary: 'Beta ships Friday; login redirect is the blocker.',
  decisions: [{ text: 'Ship the beta on Friday', context: null }],
  actionItems: [
    { text: 'Fix the login redirect', ownerName: 'Maya', dueHint: 'Thursday', priority: 'HIGH' },
    { text: 'Find an owner for the pricing page', ownerName: null, dueHint: null, priority: 'MEDIUM' },
  ],
  openQuestions: ['Who owns pricing?'],
  risks: ['Login bug could delay the beta'],
};

let fake: FakeClaude;
beforeEach(() => {
  fake = installFakeClaude();
});
afterAll(() => setAnthropicClient(null));

async function createMeeting(f: Fixture, body: Record<string, unknown> = {}) {
  const res = await api()
    .post(`/api/meetings/workspaces/${f.ws.id}`)
    .set('Cookie', f.owner.cookie)
    .send({ title: 'Beta sync', transcript: TRANSCRIPT, projectId: f.web.id, attendeeIds: [f.maya.id], ...body });
  expect(res.status).toBe(201);
  return res.body.data as MeetingDto;
}

describe('meetings', () => {
  it('analyses a transcript, resolves owners, indexes it and notifies the creator', async () => {
    const f = await fixture();
    fake.reply(json(analysis));
    const created = await createMeeting(f);
    // In tests the analysis job runs inline, so the meeting is ready by the next read.
    const res = await api().get(`/api/meetings/${created.id}`).set('Cookie', f.maya.cookie);
    expect(res.status).toBe(200);
    const meeting = res.body.data as MeetingDetailDto;
    expect(meeting.status).toBe('READY');
    expect(meeting.transcript).toBe(TRANSCRIPT);
    expect(meeting.attendees.map((a) => a.id)).toEqual([f.maya.id]);
    expect(meeting.analysis?.actionItems.map((i) => i.ownerId)).toEqual([f.maya.id, null]);
    expect(meeting.analysis?.actionItems.every((i) => i.id && i.taskId === null)).toBe(true);

    const req = fake.requests[0] as { output_config: { effort: string }; messages: { content: string }[] };
    expect(req.output_config.effort).toBe('high');
    expect(req.messages[0]?.content).toContain('Attendees: Maya Patel');

    expect(await Activity.countDocuments({ type: { $in: ['MEETING_CREATED', 'MEETING_ANALYZED'] } })).toBe(2);
    const chunks = await Chunk.find({ sourceType: 'meeting', sourceId: created.id }).lean();
    expect(chunks.some((c) => c.text.includes('Decision: Ship the beta on Friday'))).toBe(true);
    const note = await Notification.findOne({ userId: f.owner.id, type: 'AI_TASK_CREATED' }).lean();
    expect(note?.title).toBe('Meeting notes ready: Beta sync');
    expect(note?.link).toBe(`/w/${f.ws.id}/meetings/${created.id}`);
  });

  it('marks the meeting FAILED with a safe message when the model call fails', async () => {
    const f = await fixture();
    fake.reply(new Anthropic.InternalServerError(500, { type: 'error' }, 'stack trace from upstream', new Headers()));
    const created = await createMeeting(f);
    const res = await api().get(`/api/meetings/${created.id}`).set('Cookie', f.owner.cookie);
    expect(res.body.data).toMatchObject({ status: 'FAILED', error: 'The AI service is temporarily unavailable' });

    fake.reply(json(analysis));
    const retried = await api().post(`/api/meetings/${created.id}/analyze`).set('Cookie', f.owner.cookie);
    expect(retried.status).toBe(200);
    expect((await api().get(`/api/meetings/${created.id}`).set('Cookie', f.owner.cookie)).body.data.status).toBe('READY');
  });

  it('converts action items into tasks once', async () => {
    const f = await fixture();
    fake.reply(json(analysis));
    const created = await createMeeting(f);
    const detail = (await api().get(`/api/meetings/${created.id}`).set('Cookie', f.owner.cookie)).body.data as MeetingDetailDto;
    const ids = detail.analysis?.actionItems.map((i) => i.id) ?? [];

    const res = await api().post(`/api/meetings/${created.id}/convert`).set('Cookie', f.maya.cookie).send({ actionItemIds: ids, projectId: f.web.id });
    expect(res.status).toBe(201);
    const tasks = res.body.data as TaskDto[];
    expect(tasks.map((t) => t.title)).toEqual(['Fix the login redirect', 'Find an owner for the pricing page']);
    expect(tasks[0]?.assignee?.id).toBe(f.maya.id);
    expect(tasks[0]?.priority).toBe('HIGH');
    expect(tasks[0]?.description).toContain('Timing mentioned: Thursday');

    const after = (await api().get(`/api/meetings/${created.id}`).set('Cookie', f.owner.cookie)).body.data as MeetingDetailDto;
    expect(after.analysis?.actionItems.map((i) => i.taskId)).toEqual(tasks.map((t) => t.id));
    const again = await api().post(`/api/meetings/${created.id}/convert`).set('Cookie', f.maya.cookie).send({ actionItemIds: ids.slice(0, 1), projectId: f.web.id });
    expect(again.status).toBe(409);
  });

  it('scopes project meetings to project members and lists accordingly', async () => {
    const f = await fixture();
    fake.reply(json(analysis), json(analysis));
    const projectMeeting = await createMeeting(f);
    const openMeeting = await createMeeting(f, { projectId: null, title: 'All hands' });

    expect((await api().get(`/api/meetings/${projectMeeting.id}`).set('Cookie', f.outsider.cookie)).status).toBe(403);
    const list = await api().get(`/api/meetings/workspaces/${f.ws.id}`).set('Cookie', f.outsider.cookie);
    expect(list.body.data.map((m: MeetingDto) => m.id)).toEqual([openMeeting.id]);
    expect(list.body.data[0]).not.toHaveProperty('transcript');
    const all = await api().get(`/api/meetings/workspaces/${f.ws.id}`).set('Cookie', f.owner.cookie);
    expect(all.body.meta.total).toBe(2);

    const stranger = await createTestUser();
    expect((await api().get(`/api/meetings/${openMeeting.id}`).set('Cookie', stranger.cookie)).status).toBe(404);
  });

  it('lets only the creator or meeting:delete holders delete', async () => {
    const f = await fixture();
    fake.reply(json(analysis));
    const created = await createMeeting(f, { projectId: null });
    expect((await api().delete(`/api/meetings/${created.id}`).set('Cookie', f.maya.cookie)).status).toBe(403);
    expect((await api().delete(`/api/meetings/${created.id}`).set('Cookie', f.owner.cookie)).status).toBe(204);
    expect(await Chunk.countDocuments({ sourceId: created.id })).toBe(0);
  });

  it('validates attendees', async () => {
    const f = await fixture();
    const stranger = await createTestUser();
    const res = await api()
      .post(`/api/meetings/workspaces/${f.ws.id}`)
      .set('Cookie', f.owner.cookie)
      .send({ title: 'X', transcript: TRANSCRIPT, attendeeIds: [stranger.id] });
    expect(res.status).toBe(400);
  });
});

describe('resolveOwner', () => {
  const members = [
    { id: '1', name: 'Maya Patel', email: '', avatarUrl: null, title: null, availability: 'AVAILABLE' as const },
    { id: '2', name: 'Maya Chen', email: '', avatarUrl: null, title: null, availability: 'AVAILABLE' as const },
    { id: '3', name: 'Sam Lee', email: '', avatarUrl: null, title: null, availability: 'AVAILABLE' as const },
  ];
  it('matches full names, unique first names, and breaks ties with attendees', () => {
    expect(resolveOwner('maya chen', members, new Set())).toBe('2');
    expect(resolveOwner('Sam', members, new Set())).toBe('3');
    expect(resolveOwner('Maya', members, new Set())).toBeNull();
    expect(resolveOwner('Maya', members, new Set(['1']))).toBe('1');
    expect(resolveOwner(null, members, new Set())).toBeNull();
    expect(resolveOwner('Nobody', members, new Set())).toBeNull();
  });
});

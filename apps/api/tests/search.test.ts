import type { ProjectDto, SearchResultsDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Types } from 'mongoose';
import { env } from '../src/config/env';
import { Channel } from '../src/models/Channel';
import { FileModel } from '../src/models/File';
import { Message } from '../src/models/Message';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { makeSnippet } from '../src/modules/search/search.service';
import { api, createTestUser, type TestUser } from './helpers';

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
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

interface Fixture {
  owner: TestUser;
  member: TestUser;
  ws: WorkspaceDto;
  web: ProjectDto;
  secret: ProjectDto;
  tasks: { deploy: TaskDto; login: TaskDto; secretDeploy: TaskDto };
  publicChannelId: string;
  privateChannelId: string;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser({ name: 'Grace Hopper' });
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER', 'Deploy Bot Dana');
  const web = await createProject(owner, ws.id, { name: 'Deploy Platform', key: 'WEB', memberIds: [member.id] });
  const secret = await createProject(owner, ws.id, { name: 'Secret Ops', key: 'SEC' });

  const deploy = await createTask(owner, web.id, { title: 'Deploy pipeline to staging', description: 'CI work' });
  const login = await createTask(owner, web.id, { title: 'Fix login bug', description: 'Users cannot deploy sessions' });
  const secretDeploy = await createTask(owner, secret.id, { title: 'Deploy the secret sauce' });

  await api().post(`/api/workspaces/${ws.id}/documents`).set('Cookie', owner.cookie).send({
    title: 'Deployment guide',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How to deploy safely' }] }] },
  });
  await api().post(`/api/workspaces/${ws.id}/documents`).set('Cookie', owner.cookie).send({ title: 'Secret plan', projectId: secret.id });

  await FileModel.create({
    workspaceId: ws.id,
    uploadedBy: owner.id,
    name: 'deploy-notes.pdf',
    mimeType: 'application/pdf',
    size: 1234,
    kind: 'pdf',
    url: `${env.API_URL}/uploads/${ws.id}/x.pdf`,
    storageKey: `${ws.id}/x.pdf`,
    provider: 'local',
  });
  await FileModel.create({
    workspaceId: ws.id,
    projectId: secret.id,
    uploadedBy: owner.id,
    name: 'deploy-secret.pdf',
    mimeType: 'application/pdf',
    size: 1234,
    kind: 'pdf',
    url: `${env.API_URL}/uploads/${ws.id}/y.pdf`,
    storageKey: `${ws.id}/y.pdf`,
    provider: 'local',
  });

  const publicChannel = await Channel.create({ workspaceId: ws.id, type: 'PUBLIC', name: 'ops', slug: 'ops-search', createdBy: owner.id });
  const privateChannel = await Channel.create({
    workspaceId: ws.id,
    type: 'PRIVATE',
    name: 'leads',
    slug: 'leads-search',
    memberIds: [owner.id],
    createdBy: owner.id,
  });
  await Message.create({ workspaceId: ws.id, channelId: publicChannel._id, authorId: owner.id, body: 'We should deploy on Friday after the standup' });
  await Message.create({ workspaceId: ws.id, channelId: privateChannel._id, authorId: owner.id, body: 'Deploy the secret build quietly' });
  await Message.create({ workspaceId: ws.id, channelId: publicChannel._id, authorId: owner.id, body: 'Unrelated chatter' });

  return {
    owner,
    member,
    ws,
    web,
    secret,
    tasks: { deploy, login, secretDeploy },
    publicChannelId: String(publicChannel._id),
    privateChannelId: String(privateChannel._id),
  };
}

const search = (actor: TestUser, wsId: string, qs: string) => api().get(`/api/workspaces/${wsId}/search?${qs}`).set('Cookie', actor.cookie);

describe('Search', () => {
  it('searches every type for a manager-level caller, scoped to channel access', async () => {
    const f = await fixture();
    const res = await search(f.owner, f.ws.id, 'q=deploy');
    expect(res.status).toBe(200);
    const data = res.body.data as SearchResultsDto;

    expect(data.query).toBe('deploy');
    expect(data.tasks.map((t) => t.id).sort()).toEqual([f.tasks.deploy.id, f.tasks.login.id, f.tasks.secretDeploy.id].sort());
    expect(data.tasks[0]).toMatchObject({ key: expect.stringMatching(/^(WEB|SEC)-\d+$/), createdBy: { id: f.owner.id } });
    expect(data.projects.map((p) => p.id)).toEqual([f.web.id]);
    expect(data.documents.map((d) => d.title)).toEqual(['Deployment guide']);
    expect(data.documents[0]?.excerpt).toBe('How to deploy safely');
    expect(data.files.map((x) => x.name).sort()).toEqual(['deploy-notes.pdf', 'deploy-secret.pdf']);
    expect(data.users.map((u) => u.id)).toEqual([f.member.id]);

    // Owner is a member of the private channel, so both messages match.
    expect(data.messages).toHaveLength(2);
    const publicHit = data.messages.find((m) => m.channelId === f.publicChannelId);
    expect(publicHit).toMatchObject({ channelName: 'ops', snippet: 'We should deploy on Friday after the standup' });
    expect(publicHit?.author?.id).toBe(f.owner.id);

    expect(data.counts).toEqual({ tasks: 3, projects: 1, documents: 1, messages: 2, files: 2, users: 1 });
  });

  it('limits results to what a MEMBER can see', async () => {
    const f = await fixture();
    const res = await search(f.member, f.ws.id, 'q=deploy');
    expect(res.status).toBe(200);
    const data = res.body.data as SearchResultsDto;

    expect(data.tasks.map((t) => t.id).sort()).toEqual([f.tasks.deploy.id, f.tasks.login.id].sort());
    expect(data.projects.map((p) => p.id)).toEqual([f.web.id]);
    expect(data.documents.map((d) => d.title)).toEqual(['Deployment guide']);
    expect(data.files.map((x) => x.name)).toEqual(['deploy-notes.pdf']);
    expect(data.messages.map((m) => m.channelId)).toEqual([f.publicChannelId]);
    expect(data.counts).toMatchObject({ tasks: 2, projects: 1, files: 1, messages: 1 });
  });

  it('supports type filters, project scoping, limits and short regex queries', async () => {
    const f = await fixture();

    const onlyTasks = await search(f.owner, f.ws.id, 'q=deploy&types=tasks,users');
    expect(onlyTasks.status).toBe(200);
    expect(onlyTasks.body.data.tasks).toHaveLength(3);
    expect(onlyTasks.body.data.users).toHaveLength(1);
    expect(onlyTasks.body.data.projects).toEqual([]);
    expect(onlyTasks.body.data.documents).toEqual([]);
    expect(onlyTasks.body.data.counts).toMatchObject({ projects: 0, documents: 0, messages: 0, files: 0 });

    const scoped = await search(f.owner, f.ws.id, `q=deploy&projectId=${f.secret.id}`);
    expect(scoped.body.data.tasks.map((t: TaskDto) => t.id)).toEqual([f.tasks.secretDeploy.id]);
    expect(scoped.body.data.projects.map((p: ProjectDto) => p.id)).toEqual([]);
    expect(scoped.body.data.files.map((x: { name: string }) => x.name)).toEqual(['deploy-secret.pdf']);

    const deniedScope = await search(f.member, f.ws.id, `q=deploy&projectId=${f.secret.id}`);
    expect(deniedScope.status).toBe(403);

    const limited = await search(f.owner, f.ws.id, 'q=deploy&limit=1');
    expect(limited.body.data.tasks).toHaveLength(1);
    expect(limited.body.data.counts.tasks).toBe(3);

    // Two characters: regex path on the primary name fields.
    const short = await search(f.owner, f.ws.id, 'q=de');
    expect(short.status).toBe(200);
    expect(short.body.data.tasks.length).toBeGreaterThanOrEqual(2);
    expect(short.body.data.files).toHaveLength(2);

    // Partial words miss the text index but are found by the regex fallback.
    const partial = await search(f.owner, f.ws.id, 'q=pipel');
    expect(partial.body.data.tasks.map((t: TaskDto) => t.id)).toEqual([f.tasks.deploy.id]);

    const unknownProject = await search(f.owner, f.ws.id, `q=deploy&projectId=${new Types.ObjectId().toHexString()}`);
    expect(unknownProject.status).toBe(404);
  });

  it('validates the query and requires membership', async () => {
    const f = await fixture();
    expect((await search(f.owner, f.ws.id, 'q=')).status).toBe(422);
    expect((await search(f.owner, f.ws.id, `q=${'x'.repeat(101)}`)).status).toBe(422);
    const stranger = await createTestUser();
    expect((await search(stranger, f.ws.id, 'q=deploy')).status).toBe(403);
    expect((await api().get(`/api/workspaces/${f.ws.id}/search?q=deploy`)).status).toBe(401);
  });

  it('builds a 160-character snippet around the match', () => {
    const long = `${'a '.repeat(100)}needle in the haystack ${'b '.repeat(100)}`;
    const snippet = makeSnippet(long, 'needle');
    expect(snippet.length).toBeLessThanOrEqual(162);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(makeSnippet('short text', 'short')).toBe('short text');
    expect(makeSnippet('x'.repeat(300), 'missing')).toHaveLength(160);
  });
});

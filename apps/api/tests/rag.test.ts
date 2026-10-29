import './rag.env';
import type { ChannelDto, DocumentDto, ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Chunk } from '../src/models/Chunk';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { CHUNK_MAX_CHARS, chunkText } from '../src/modules/rag/chunking';
import { setEmbedder, type Embedder } from '../src/modules/rag/embeddings';
import { indexSource, reindexWorkspace, retrieve } from '../src/modules/rag/rag.service';
import { api, createTestUser, type TestUser } from './helpers';

// ---------- deterministic fake embeddings: hashed bag of words ----------

const DIMS = 64;
function vectorFor(textValue: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const word of textValue.toLowerCase().match(/[a-z]+/g) ?? []) {
    let h = 0;
    for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % DIMS;
    v[h] = (v[h] ?? 0) + 1;
  }
  return v;
}
let embedCalls = 0;
const fakeEmbedder: Embedder = async (texts) => {
  embedCalls += 1;
  return texts.map(vectorFor);
};

beforeEach(() => {
  embedCalls = 0;
  setEmbedder(fakeEmbedder);
});
afterAll(() => setEmbedder(null));

// ---------- fixtures ----------

async function addMember(wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

const richDoc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
});

interface Fixture {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  ws: WorkspaceDto;
  web: ProjectDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = (await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'Acme' })).body.data as WorkspaceDto;
  const member = await addMember(ws.id, 'MEMBER');
  const outsider = await addMember(ws.id, 'MEMBER');
  const web = (await api().post(`/api/workspaces/${ws.id}/projects`).set('Cookie', owner.cookie).send({ name: 'Web', key: 'WEB', memberIds: [member.id] }))
    .body.data as ProjectDto;
  return { owner, member, outsider, ws, web };
}

const as = (u: TestUser, role: WorkspaceRole, f: Fixture) => ({ workspaceId: f.ws.id, userId: u.id, role });

// ---------- chunking ----------

describe('chunkText', () => {
  it('packs paragraphs under the limit with overlap between chunks', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`.trim());
    const chunks = chunkText(paragraphs.join('\n'));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_MAX_CHARS)).toBe(true);
    // The next chunk starts with the trailing paragraphs of the previous one (~15 %).
    const first = chunks[0]?.split('\n') ?? [];
    const second = chunks[1]?.split('\n') ?? [];
    const carried = second.filter((p) => first.includes(p));
    expect(carried.length).toBeGreaterThan(0);
    expect(first.slice(-carried.length)).toEqual(carried);
    expect(second.slice(0, carried.length)).toEqual(carried);
    expect(carried.join('\n').length).toBeLessThanOrEqual(Math.round(CHUNK_MAX_CHARS * 0.15));
  });

  it('splits a single huge paragraph and ignores blank input', () => {
    expect(chunkText('')).toEqual([]);
    const chunks = chunkText('x'.repeat(CHUNK_MAX_CHARS * 2 + 10));
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.length <= CHUNK_MAX_CHARS)).toBe(true);
  });
});

// ---------- indexing ----------

describe('indexing', () => {
  it('indexes tasks and documents on write, skipping unchanged content', async () => {
    const f = await fixture();
    const doc = (
      await api()
        .post(`/api/workspaces/${f.ws.id}/documents`)
        .set('Cookie', f.owner.cookie)
        .send({ title: 'Database migration plan', content: richDoc('We migrate billing to Postgres in March.') })
    ).body.data as DocumentDto;
    await indexSource('document', doc.id);
    const chunks = await Chunk.find({ sourceType: 'document', sourceId: doc.id }).lean();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ title: 'Database migration plan', embeddingModel: 'voyage-3.5' });
    expect(chunks[0]?.embedding).toHaveLength(DIMS);

    embedCalls = 0;
    expect(await indexSource('document', doc.id)).toBe(0);
    expect(embedCalls).toBe(0);

    const task = (await api().post(`/api/projects/${f.web.id}/tasks`).set('Cookie', f.owner.cookie).send({ title: 'Rotate API keys', description: 'Quarterly rotation' }))
      .body.data as TaskDto;
    await indexSource('task', task.id);
    const taskChunk = await Chunk.findOne({ sourceType: 'task', sourceId: task.id }).lean();
    expect(taskChunk?.text).toContain(`${task.key}: Rotate API keys`);
    expect(String(taskChunk?.projectId)).toBe(f.web.id);

    await api().delete(`/api/tasks/${task.id}`).set('Cookie', f.owner.cookie);
    await indexSource('task', task.id);
    expect(await Chunk.countDocuments({ sourceId: task.id })).toBe(0);
  });

  it('folds thread replies into the parent message and skips short messages', async () => {
    const f = await fixture();
    const channel = (await api().post(`/api/workspaces/${f.ws.id}/channels`).set('Cookie', f.owner.cookie).send({ name: 'eng' })).body.data as ChannelDto;
    const root = (await api().post(`/api/channels/${channel.id}/messages`).set('Cookie', f.owner.cookie).send({ body: 'Should we adopt feature flags for releases?' })).body.data;
    await api().post(`/api/channels/${channel.id}/messages`).set('Cookie', f.owner.cookie).send({ body: 'Yes, LaunchDarkly works well', parentMessageId: root.id });
    const short = (await api().post(`/api/channels/${channel.id}/messages`).set('Cookie', f.owner.cookie).send({ body: 'ok' })).body.data;

    await indexSource('message', root.id);
    await indexSource('message', short.id);
    const chunk = await Chunk.findOne({ sourceType: 'message', sourceId: root.id }).lean();
    expect(chunk?.text).toContain('Reply: Yes, LaunchDarkly works well');
    expect(chunk?.title).toBe('#eng');
    expect(await Chunk.countDocuments({ sourceId: short.id })).toBe(0);
  });
});

// ---------- retrieval ----------

describe('retrieve', () => {
  it('ranks relevant content and enforces project and channel visibility', async () => {
    const f = await fixture();
    const doc = (
      await api()
        .post(`/api/workspaces/${f.ws.id}/documents`)
        .set('Cookie', f.owner.cookie)
        .send({ title: 'Postgres migration', content: richDoc('Billing moves to Postgres. Cutover needs a maintenance window.') })
    ).body.data as DocumentDto;
    const projectTask = (await api().post(`/api/projects/${f.web.id}/tasks`).set('Cookie', f.owner.cookie).send({ title: 'Postgres cutover rehearsal' }))
      .body.data as TaskDto;
    const privateChannel = (
      await api().post(`/api/workspaces/${f.ws.id}/channels`).set('Cookie', f.owner.cookie).send({ name: 'leads', type: 'PRIVATE', memberIds: [f.member.id] })
    ).body.data as ChannelDto;
    const secretMsg = (await api().post(`/api/channels/${privateChannel.id}/messages`).set('Cookie', f.owner.cookie).send({ body: 'Postgres budget is approved for next quarter' }))
      .body.data;
    await reindexWorkspace(f.ws.id);

    const forMember = await retrieve({ ...as(f.member, 'MEMBER', f), query: 'postgres migration cutover', limit: 10 });
    const ids = forMember.map((i) => i.sourceId);
    expect(ids).toEqual(expect.arrayContaining([doc.id, projectTask.id, secretMsg.id]));
    expect(forMember[0]?.score).toBeGreaterThan(0);
    expect(forMember.find((i) => i.sourceId === doc.id)?.link).toBe(`/w/${f.ws.id}/docs/${doc.id}`);

    const forOutsider = await retrieve({ ...as(f.outsider, 'MEMBER', f), query: 'postgres migration cutover', limit: 10 });
    const outsiderIds = forOutsider.map((i) => i.sourceId);
    expect(outsiderIds).toContain(doc.id);
    expect(outsiderIds).not.toContain(projectTask.id);
    expect(outsiderIds).not.toContain(secretMsg.id);

    const scoped = await retrieve({ ...as(f.member, 'MEMBER', f), query: 'postgres', projectId: f.web.id, limit: 10 });
    expect(scoped.map((i) => i.sourceId)).toEqual([projectTask.id]);
    expect(await retrieve({ ...as(f.outsider, 'MEMBER', f), query: 'postgres', projectId: f.web.id })).toEqual([]);

    const onlyDocs = await retrieve({ ...as(f.owner, 'OWNER', f), query: 'postgres', sourceTypes: ['document'] });
    expect(onlyDocs.map((i) => i.sourceType)).toEqual(['document']);
  });

  it('still answers with keyword matches when the embedder fails', async () => {
    const f = await fixture();
    const doc = (
      await api().post(`/api/workspaces/${f.ws.id}/documents`).set('Cookie', f.owner.cookie).send({ title: 'Kubernetes runbook', content: richDoc('Restart the ingress controller.') })
    ).body.data as DocumentDto;
    await indexSource('document', doc.id);
    setEmbedder(async () => {
      throw new Error('voyage down');
    });
    const items = await retrieve({ ...as(f.owner, 'OWNER', f), query: 'ingress controller' });
    expect(items.map((i) => i.sourceId)).toEqual([doc.id]);
  });
});

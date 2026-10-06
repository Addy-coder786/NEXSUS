import type { DocumentDto, DocumentSummaryDto, ProjectDto, RichContent, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { ERROR_CODES } from '@nexus/shared';
import { events } from '../src/events';
import { Activity } from '../src/models/Activity';
import { DocumentModel } from '../src/models/Document';
import { DocumentVersion } from '../src/models/DocumentVersion';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { richContentToText } from '../src/modules/documents/document.text';
import { api, createTestUser, type TestUser } from './helpers';

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

async function addMember(wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

async function createProject(actor: TestUser, wsId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/workspaces/${wsId}/projects`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as ProjectDto;
}

async function createDocument(actor: TestUser, wsId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/workspaces/${wsId}/documents`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as DocumentDto;
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  viewer: TestUser;
  ws: WorkspaceDto;
  project: ProjectDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER');
  const outsider = await addMember(ws.id, 'MEMBER');
  const viewer = await addMember(ws.id, 'VIEWER');
  const project = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id] });
  return { owner, member, outsider, viewer, ws, project };
}

describe('document.text', () => {
  it('flattens Tiptap JSON into plain text with block separators', () => {
    const content: RichContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'world' },
            { type: 'hardBreak' },
            { type: 'text', text: 'again' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
          ],
        },
      ],
    };
    expect(richContentToText(content)).toBe('Title\nHello world\nagain\none\ntwo');
    expect(richContentToText({ type: 'doc' })).toBe('');
    expect(richContentToText(null)).toBe('');
  });
});

describe('Documents', () => {
  describe('create & read', () => {
    it('creates a document with computed text, snapshots v1 and records activity', async () => {
      const { owner, ws } = await fixture();
      const created = await createDocument(owner, ws.id, {
        title: '  Roadmap ',
        icon: '🗺️',
        content: doc('Q1 goals', 'Ship the beta'),
      });

      expect(created).toMatchObject({
        workspaceId: ws.id,
        projectId: null,
        title: 'Roadmap',
        icon: '🗺️',
        excerpt: 'Q1 goals Ship the beta',
        isArchived: false,
        version: 1,
      });
      expect(created.createdBy.id).toBe(owner.id);
      expect(created.updatedBy.id).toBe(owner.id);
      expect(created.content).toEqual(doc('Q1 goals', 'Ship the beta'));

      const stored = await DocumentModel.findById(created.id).lean();
      expect(stored?.contentText).toBe('Q1 goals\nShip the beta');
      expect(await DocumentVersion.countDocuments({ documentId: created.id })).toBe(1);
      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'DOCUMENT_CREATED' })).toBe(1);

      const fetched = await api().get(`/api/documents/${created.id}`).set('Cookie', owner.cookie);
      expect(fetched.status).toBe(200);
      expect(fetched.body.data.id).toBe(created.id);
    });

    it('defaults the title and content', async () => {
      const { member, ws } = await fixture();
      const created = await createDocument(member, ws.id, {});
      expect(created.title).toBe('Untitled');
      expect(created.content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(created.excerpt).toBe('');
    });

    it('enforces document:create and project membership on create', async () => {
      const { viewer, outsider, member, ws, project } = await fixture();
      const forbidden = await api().post(`/api/workspaces/${ws.id}/documents`).set('Cookie', viewer.cookie).send({ title: 'X' });
      expect(forbidden.status).toBe(403);

      const notInProject = await api()
        .post(`/api/workspaces/${ws.id}/documents`)
        .set('Cookie', outsider.cookie)
        .send({ title: 'X', projectId: project.id });
      expect(notInProject.status).toBe(403);

      const ok = await createDocument(member, ws.id, { title: 'Spec', projectId: project.id });
      expect(ok.projectId).toBe(project.id);

      const stranger = await createTestUser();
      const notMember = await api().get(`/api/documents/${ok.id}`).set('Cookie', stranger.cookie);
      expect(notMember.status).toBe(403);
    });
  });

  describe('list', () => {
    it('filters by project, archived state and search, and respects visibility', async () => {
      const { owner, member, outsider, ws, project } = await fixture();
      const general = await createDocument(owner, ws.id, { title: 'Handbook', content: doc('How we work') });
      const scoped = await createDocument(owner, ws.id, { title: 'Spec', projectId: project.id, content: doc('Login flow') });
      const archived = await createDocument(owner, ws.id, { title: 'Old notes' });
      await api().patch(`/api/documents/${archived.id}`).set('Cookie', owner.cookie).send({ isArchived: true });

      const all = await api().get(`/api/workspaces/${ws.id}/documents`).set('Cookie', owner.cookie);
      expect(all.status).toBe(200);
      expect((all.body.data as DocumentSummaryDto[]).map((d) => d.id).sort()).toEqual([general.id, scoped.id].sort());
      expect(all.body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
      expect(all.body.data[0].content).toBeUndefined();

      const archivedOnly = await api().get(`/api/workspaces/${ws.id}/documents?archived=true`).set('Cookie', owner.cookie);
      expect(archivedOnly.body.data.map((d: DocumentSummaryDto) => d.id)).toEqual([archived.id]);

      const none = await api().get(`/api/workspaces/${ws.id}/documents?projectId=none`).set('Cookie', owner.cookie);
      expect(none.body.data.map((d: DocumentSummaryDto) => d.id)).toEqual([general.id]);

      const byProject = await api().get(`/api/workspaces/${ws.id}/documents?projectId=${project.id}`).set('Cookie', member.cookie);
      expect(byProject.body.data.map((d: DocumentSummaryDto) => d.id)).toEqual([scoped.id]);

      const search = await api().get(`/api/workspaces/${ws.id}/documents?search=login`).set('Cookie', owner.cookie);
      expect(search.body.data.map((d: DocumentSummaryDto) => d.id)).toEqual([scoped.id]);

      // A member outside the project only sees unscoped documents.
      const restricted = await api().get(`/api/workspaces/${ws.id}/documents`).set('Cookie', outsider.cookie);
      expect(restricted.body.data.map((d: DocumentSummaryDto) => d.id)).toEqual([general.id]);
      const denied = await api().get(`/api/workspaces/${ws.id}/documents?projectId=${project.id}`).set('Cookie', outsider.cookie);
      expect(denied.status).toBe(403);
      const direct = await api().get(`/api/documents/${scoped.id}`).set('Cookie', outsider.cookie);
      expect(direct.status).toBe(403);

      const sorted = await api().get(`/api/workspaces/${ws.id}/documents?sort=title`).set('Cookie', owner.cookie);
      expect(sorted.body.data.map((d: DocumentSummaryDto) => d.title)).toEqual(['Handbook', 'Spec']);
    });
  });

  describe('update', () => {
    it('bumps the version, snapshots content changes, emits document.updated and debounces activity', async () => {
      const { owner, ws } = await fixture();
      const created = await createDocument(owner, ws.id, { title: 'Draft', content: doc('v1') });

      const emitted: unknown[] = [];
      const off = events.on('document.updated', (p) => {
        emitted.push(p);
      });

      const first = await api()
        .patch(`/api/documents/${created.id}`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Draft 2', content: doc('v2 text'), baseVersion: 1 });
      expect(first.status).toBe(200);
      expect(first.body.data).toMatchObject({ title: 'Draft 2', version: 2, excerpt: 'v2 text' });

      const second = await api()
        .patch(`/api/documents/${created.id}`)
        .set('Cookie', owner.cookie)
        .send({ content: doc('v3'), contentText: 'client text', baseVersion: 2 });
      expect(second.status).toBe(200);
      expect(second.body.data).toMatchObject({ version: 3, excerpt: 'client text' });

      // Title-only change: new version, no content snapshot.
      const third = await api().patch(`/api/documents/${created.id}`).set('Cookie', owner.cookie).send({ title: 'Final' });
      expect(third.body.data.version).toBe(4);

      const versions = await DocumentVersion.find({ documentId: created.id }).sort({ version: 1 }).lean();
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);

      off();
      expect(emitted).toHaveLength(3);
      expect(emitted[0]).toMatchObject({ actorId: owner.id, document: { id: created.id, version: 2, title: 'Draft 2' } });

      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'DOCUMENT_UPDATED' })).toBe(1);

      const noop = await api().patch(`/api/documents/${created.id}`).set('Cookie', owner.cookie).send({ title: 'Final' });
      expect(noop.status).toBe(200);
      expect(noop.body.data.version).toBe(4);
    });

    it('returns 409 with the current version when the client is behind', async () => {
      const { owner, member, ws } = await fixture();
      const created = await createDocument(owner, ws.id, { title: 'Shared', content: doc('a') });
      const ok = await api().patch(`/api/documents/${created.id}`).set('Cookie', owner.cookie).send({ content: doc('b'), baseVersion: 1 });
      expect(ok.status).toBe(200);

      const stale = await api().patch(`/api/documents/${created.id}`).set('Cookie', member.cookie).send({ content: doc('c'), baseVersion: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({ code: ERROR_CODES.CONFLICT, message: 'Document was modified', details: { currentVersion: 2 } });

      const stored = await DocumentModel.findById(created.id).lean();
      expect(stored?.version).toBe(2);
      expect(stored?.contentText).toBe('b');
    });

    it('requires document:update and validates the body', async () => {
      const { owner, viewer, ws } = await fixture();
      const created = await createDocument(owner, ws.id, { title: 'Locked' });
      const forbidden = await api().patch(`/api/documents/${created.id}`).set('Cookie', viewer.cookie).send({ title: 'Nope' });
      expect(forbidden.status).toBe(403);
      const invalid = await api().patch(`/api/documents/${created.id}`).set('Cookie', owner.cookie).send({ content: { type: 'nope' } });
      expect(invalid.status).toBe(422);
      const missing = await api().get('/api/documents/64b000000000000000000000').set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
    });
  });

  describe('versions', () => {
    it('lists versions newest first, returns a version and restores it as a new version', async () => {
      const { owner, member, ws } = await fixture();
      const created = await createDocument(owner, ws.id, { title: 'History', content: doc('one') });
      await api().patch(`/api/documents/${created.id}`).set('Cookie', member.cookie).send({ title: 'History 2', content: doc('two') });

      const list = await api().get(`/api/documents/${created.id}/versions`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(list.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      expect(list.body.data[0]).toMatchObject({ version: 2, title: 'History 2' });
      expect(list.body.data[0].savedBy.id).toBe(member.id);
      expect(list.body.data[0].content).toBeUndefined();

      const v1 = await api().get(`/api/documents/${created.id}/versions/1`).set('Cookie', owner.cookie);
      expect(v1.status).toBe(200);
      expect(v1.body.data).toMatchObject({ version: 1, title: 'History', content: doc('one') });
      expect(v1.body.data.savedBy.id).toBe(owner.id);

      const restored = await api().post(`/api/documents/${created.id}/versions/1/restore`).set('Cookie', owner.cookie);
      expect(restored.status).toBe(200);
      expect(restored.body.data).toMatchObject({ version: 3, title: 'History', content: doc('one'), excerpt: 'one' });
      expect(await DocumentVersion.countDocuments({ documentId: created.id })).toBe(3);

      const unknown = await api().get(`/api/documents/${created.id}/versions/99`).set('Cookie', owner.cookie);
      expect(unknown.status).toBe(404);
      const bad = await api().get(`/api/documents/${created.id}/versions/abc`).set('Cookie', owner.cookie);
      expect(bad.status).toBe(422);
    });
  });

  describe('duplicate & delete', () => {
    it('duplicates with a "(copy)" title and the same content', async () => {
      const { owner, member, ws, project } = await fixture();
      const created = await createDocument(owner, ws.id, { title: 'Template', projectId: project.id, content: doc('body') });
      const copy = await api().post(`/api/documents/${created.id}/duplicate`).set('Cookie', member.cookie);
      expect(copy.status).toBe(201);
      expect(copy.body.data).toMatchObject({ title: 'Template (copy)', projectId: project.id, version: 1, content: doc('body') });
      expect(copy.body.data.id).not.toBe(created.id);
      expect(copy.body.data.createdBy.id).toBe(member.id);
    });

    it('lets the creator or document:delete holders delete, removing versions', async () => {
      const { owner, member, outsider, ws } = await fixture();
      const mine = await createDocument(member, ws.id, { title: 'Mine', content: doc('x') });
      const theirs = await createDocument(owner, ws.id, { title: 'Theirs' });

      const notCreator = await api().delete(`/api/documents/${theirs.id}`).set('Cookie', member.cookie);
      expect(notCreator.status).toBe(403);
      const stranger = await api().delete(`/api/documents/${mine.id}`).set('Cookie', outsider.cookie);
      expect(stranger.status).toBe(403);

      const own = await api().delete(`/api/documents/${mine.id}`).set('Cookie', member.cookie);
      expect(own.status).toBe(204);
      expect(await DocumentModel.findById(mine.id)).toBeNull();
      expect(await DocumentVersion.countDocuments({ documentId: mine.id })).toBe(0);

      const asOwner = await api().delete(`/api/documents/${theirs.id}`).set('Cookie', owner.cookie);
      expect(asOwner.status).toBe(204);
      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'DOCUMENT_DELETED' })).toBe(2);

      const gone = await api().get(`/api/documents/${mine.id}`).set('Cookie', member.cookie);
      expect(gone.status).toBe(404);
    });
  });
});

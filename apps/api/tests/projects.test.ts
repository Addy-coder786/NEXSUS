import type { ProjectDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Activity } from '../src/models/Activity';
import { Comment } from '../src/models/Comment';
import { Task } from '../src/models/Task';
import { sentEmails } from '../src/services/email';
import { api, createTestUser, type TestUser } from './helpers';

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

async function join(owner: TestUser, wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  const inv = await api()
    .post(`/api/workspaces/${wsId}/invitations`)
    .set('Cookie', owner.cookie)
    .send({ email: user.user.email, role });
  expect(inv.status).toBe(201);
  const mail = [...sentEmails].reverse().find((m) => m.to === user.user.email);
  const token = mail?.html.match(/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('No invitation token');
  const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', user.cookie);
  expect(accept.status).toBe(200);
  return user;
}

async function createProject(actor: TestUser, wsId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/workspaces/${wsId}/projects`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as ProjectDto;
}

describe('Projects', () => {
  describe('create and key generation', () => {
    it('creates a project with the creator as member and an auto-generated key', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);

      const p = await createProject(owner, ws.id, { name: 'Website Redesign', description: 'New site' });
      expect(p).toMatchObject({
        key: 'WR',
        workspaceId: ws.id,
        status: 'ACTIVE',
        description: 'New site',
        createdBy: { id: owner.id },
        labels: [],
        taskCounts: {},
      });
      expect(p.members.map((m) => m.id)).toEqual([owner.id]);
      expect(p.color).toMatch(/^#[0-9a-fA-F]{6}$/);

      const activity = await Activity.findOne({ projectId: p.id, type: 'PROJECT_CREATED' }).sort({ _id: 1 }).lean();
      expect(activity?.target).toMatchObject({ type: 'project', id: p.id, title: 'Website Redesign' });
    });

    it('falls back to the first letters for one-word names and de-duplicates keys', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);

      const a = await createProject(owner, ws.id, { name: 'Nexus' });
      expect(a.key).toBe('NEX');
      const b = await createProject(owner, ws.id, { name: 'Website Redesign' });
      const c = await createProject(owner, ws.id, { name: 'Weekly Report' });
      const d = await createProject(owner, ws.id, { name: 'Wild Rabbits' });
      expect(b.key).toBe('WR');
      expect(c.key).toBe('WR2');
      expect(d.key).toBe('WR3');

      const long = await createProject(owner, ws.id, { name: 'a b c d e f g h i j k l m' });
      expect(long.key).toBe('ABCDEFGHIJ');

      const digits = await createProject(owner, ws.id, { name: '3D Models' });
      // Initials "3M" lose the leading digit and fall back to the first letters of the name.
      expect(digits.key).toBe('DMO');
    });

    it('accepts a custom key (upper-cased) and rejects duplicates per workspace', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const other = await createWorkspace(owner, 'Other');

      const p = await createProject(owner, ws.id, { name: 'Mobile', key: 'mob' });
      expect(p.key).toBe('MOB');

      const dup = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Mobile 2', key: 'MOB' });
      expect(dup.status).toBe(409);

      const elsewhere = await createProject(owner, other.id, { name: 'Mobile', key: 'MOB' });
      expect(elsewhere.key).toBe('MOB');

      const invalid = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Bad', key: '1AB' });
      expect(invalid.status).toBe(422);
    });

    it('requires extra memberIds to be workspace members', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');

      const bad = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Proj', memberIds: [stranger.id] });
      expect(bad.status).toBe(400);

      const good = await createProject(owner, ws.id, { name: 'Proj', memberIds: [member.id, member.id] });
      expect(good.members.map((m) => m.id).sort()).toEqual([owner.id, member.id].sort());
    });

    it('is only allowed for MANAGER and above', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const manager = await join(owner, ws.id, 'MANAGER');
      const member = await join(owner, ws.id, 'MEMBER');

      await createProject(manager, ws.id, { name: 'By Manager' });
      const denied = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', member.cookie)
        .send({ name: 'By Member' });
      expect(denied.status).toBe(403);
    });
  });

  describe('visibility', () => {
    it('VIEWER/MEMBER only see projects they belong to; MANAGER+ see all', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const manager = await join(owner, ws.id, 'MANAGER');
      const viewer = await join(owner, ws.id, 'VIEWER');
      const member = await join(owner, ws.id, 'MEMBER');

      const secret = await createProject(owner, ws.id, { name: 'Secret' });
      const shared = await createProject(owner, ws.id, { name: 'Shared', memberIds: [viewer.id] });

      const asViewer = await api().get(`/api/workspaces/${ws.id}/projects`).set('Cookie', viewer.cookie);
      expect(asViewer.body.data.map((p: ProjectDto) => p.id)).toEqual([shared.id]);

      const asMember = await api().get(`/api/workspaces/${ws.id}/projects`).set('Cookie', member.cookie);
      expect(asMember.body.data).toHaveLength(0);

      const asManager = await api().get(`/api/workspaces/${ws.id}/projects`).set('Cookie', manager.cookie);
      expect(asManager.body.data).toHaveLength(2);

      const viewerSecret = await api().get(`/api/projects/${secret.id}`).set('Cookie', viewer.cookie);
      expect(viewerSecret.status).toBe(403);
      const viewerShared = await api().get(`/api/projects/${shared.id}`).set('Cookie', viewer.cookie);
      expect(viewerShared.status).toBe(200);
      const managerSecret = await api().get(`/api/projects/${secret.id}`).set('Cookie', manager.cookie);
      expect(managerSecret.status).toBe(200);

      const stranger = await createTestUser();
      const outsider = await api().get(`/api/projects/${secret.id}`).set('Cookie', stranger.cookie);
      expect(outsider.status).toBe(403);

      const missing = await api().get('/api/projects/64b000000000000000000000').set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
    });
  });

  describe('update, members, delete', () => {
    it('updates fields and records PROJECT_UPDATED; MEMBER cannot update', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');
      const p = await createProject(owner, ws.id, { name: 'Proj', memberIds: [member.id] });

      const res = await api()
        .patch(`/api/projects/${p.id}`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Renamed', status: 'ON_HOLD', dueDate: '2030-01-01T00:00:00.000Z' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ name: 'Renamed', status: 'ON_HOLD', dueDate: '2030-01-01T00:00:00.000Z' });

      const clear = await api().patch(`/api/projects/${p.id}`).set('Cookie', owner.cookie).send({ dueDate: null });
      expect(clear.body.data.dueDate).toBeNull();

      const denied = await api().patch(`/api/projects/${p.id}`).set('Cookie', member.cookie).send({ name: 'Xy' });
      expect(denied.status).toBe(403);

      const activity = await Activity.findOne({ projectId: p.id, type: 'PROJECT_UPDATED' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ fields: ['name', 'status', 'dueDate'] });
    });

    it('adds and removes project members (workspace members only) and unassigns tasks', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');
      const p = await createProject(owner, ws.id, { name: 'Proj' });

      const bad = await api()
        .post(`/api/projects/${p.id}/members`)
        .set('Cookie', owner.cookie)
        .send({ userIds: [stranger.id] });
      expect(bad.status).toBe(400);

      const add = await api()
        .post(`/api/projects/${p.id}/members`)
        .set('Cookie', owner.cookie)
        .send({ userIds: [member.id] });
      expect(add.status).toBe(200);
      expect(add.body.data.members.map((m: { id: string }) => m.id).sort()).toEqual([owner.id, member.id].sort());

      const task = await api()
        .post(`/api/projects/${p.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'T', assigneeId: member.id });
      expect(task.status).toBe(201);

      const remove = await api().delete(`/api/projects/${p.id}/members/${member.id}`).set('Cookie', owner.cookie);
      expect(remove.status).toBe(200);
      expect(remove.body.data.members.map((m: { id: string }) => m.id)).toEqual([owner.id]);

      const after = await Task.findById(task.body.data.id).lean();
      expect(after?.assigneeId).toBeNull();

      const removeAgain = await api()
        .delete(`/api/projects/${p.id}/members/${member.id}`)
        .set('Cookie', owner.cookie);
      expect(removeAgain.status).toBe(404);

      const types = (await Activity.find({ projectId: p.id }).lean()).map((a) => a.type);
      expect(types).toEqual(expect.arrayContaining(['PROJECT_MEMBER_ADDED', 'PROJECT_MEMBER_REMOVED']));
    });

    it('reports taskCounts grouped by status', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const p = await createProject(owner, ws.id, { name: 'Counts' });

      for (const status of ['TODO', 'TODO', 'DONE', 'IN_PROGRESS']) {
        const res = await api()
          .post(`/api/projects/${p.id}/tasks`)
          .set('Cookie', owner.cookie)
          .send({ title: `Task ${status}`, status });
        expect(res.status).toBe(201);
      }

      const res = await api().get(`/api/projects/${p.id}`).set('Cookie', owner.cookie);
      expect(res.body.data.taskCounts).toEqual({ TODO: 2, DONE: 1, IN_PROGRESS: 1 });

      const list = await api().get(`/api/workspaces/${ws.id}/projects`).set('Cookie', owner.cookie);
      expect(list.body.data[0].taskCounts).toEqual({ TODO: 2, DONE: 1, IN_PROGRESS: 1 });
    });

    it('deletes a project and cascades tasks and comments', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');
      const p = await createProject(owner, ws.id, { name: 'Doomed', memberIds: [member.id] });

      const task = await api().post(`/api/projects/${p.id}/tasks`).set('Cookie', owner.cookie).send({ title: 'T' });
      await api()
        .post(`/api/tasks/${task.body.data.id}/comments`)
        .set('Cookie', owner.cookie)
        .send({ body: 'hello' });

      const denied = await api().delete(`/api/projects/${p.id}`).set('Cookie', member.cookie);
      expect(denied.status).toBe(403);

      const res = await api().delete(`/api/projects/${p.id}`).set('Cookie', owner.cookie);
      expect(res.status).toBe(204);
      expect(await Task.countDocuments({ projectId: p.id })).toBe(0);
      expect(await Comment.countDocuments({ projectId: p.id })).toBe(0);

      const gone = await api().get(`/api/projects/${p.id}`).set('Cookie', owner.cookie);
      expect(gone.status).toBe(404);

      const activity = await Activity.findOne({ projectId: p.id, type: 'PROJECT_DELETED' }).sort({ _id: 1 }).lean();
      expect(activity?.target?.title).toBe('Doomed');
    });
  });

  describe('labels', () => {
    it('creates, lists, updates and deletes labels; deletion pulls them from tasks', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const viewer = await join(owner, ws.id, 'VIEWER');
      const p = await createProject(owner, ws.id, { name: 'Labels', memberIds: [viewer.id] });

      const create = await api()
        .post(`/api/projects/${p.id}/labels`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Bug', color: '#ff0000' });
      expect(create.status).toBe(201);
      expect(create.body.data).toMatchObject({ name: 'Bug', color: '#ff0000' });
      const labelId: string = create.body.data.id;

      const dup = await api()
        .post(`/api/projects/${p.id}/labels`)
        .set('Cookie', owner.cookie)
        .send({ name: 'bug', color: '#00ff00' });
      expect(dup.status).toBe(409);

      const byViewer = await api()
        .post(`/api/projects/${p.id}/labels`)
        .set('Cookie', viewer.cookie)
        .send({ name: 'Nope', color: '#00ff00' });
      expect(byViewer.status).toBe(403);

      const list = await api().get(`/api/projects/${p.id}/labels`).set('Cookie', viewer.cookie);
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([{ id: labelId, name: 'Bug', color: '#ff0000' }]);

      const update = await api()
        .patch(`/api/projects/${p.id}/labels/${labelId}`)
        .set('Cookie', owner.cookie)
        .send({ color: '#0000ff' });
      expect(update.status).toBe(200);
      expect(update.body.data).toEqual({ id: labelId, name: 'Bug', color: '#0000ff' });

      const task = await api()
        .post(`/api/projects/${p.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Labelled', labelIds: [labelId] });
      expect(task.status).toBe(201);
      expect(task.body.data.labels).toEqual([{ id: labelId, name: 'Bug', color: '#0000ff' }]);

      const del = await api().delete(`/api/projects/${p.id}/labels/${labelId}`).set('Cookie', owner.cookie);
      expect(del.status).toBe(204);

      const project = await api().get(`/api/projects/${p.id}`).set('Cookie', owner.cookie);
      expect(project.body.data.labels).toEqual([]);
      const taskAfter = await Task.findById(task.body.data.id).lean();
      expect(taskAfter?.labelIds).toEqual([]);

      const missing = await api()
        .patch(`/api/projects/${p.id}/labels/${labelId}`)
        .set('Cookie', owner.cookie)
        .send({ name: 'X' });
      expect(missing.status).toBe(404);
    });
  });

  describe('project activity feed', () => {
    it('lists activities scoped to the project', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const a = await createProject(owner, ws.id, { name: 'Alpha' });
      const b = await createProject(owner, ws.id, { name: 'Beta' });
      await api().post(`/api/projects/${a.id}/tasks`).set('Cookie', owner.cookie).send({ title: 'T' });

      const res = await api().get(`/api/projects/${a.id}/activities`).set('Cookie', owner.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.map((x: { type: string }) => x.type)).toEqual(['TASK_CREATED', 'PROJECT_CREATED']);
      expect(res.body.meta.total).toBe(2);

      const other = await api().get(`/api/projects/${b.id}/activities`).set('Cookie', owner.cookie);
      expect(other.body.meta.total).toBe(1);
    });
  });
});

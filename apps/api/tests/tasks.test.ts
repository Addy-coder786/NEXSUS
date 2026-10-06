import type { ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
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

async function createTask(actor: TestUser, projectId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/projects/${projectId}/tasks`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as TaskDto;
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  ws: WorkspaceDto;
  project: ProjectDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const member = await join(owner, ws.id, 'MEMBER');
  const project = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id] });
  return { owner, member, ws, project };
}

const ids = (tasks: TaskDto[]) => tasks.map((t) => t.id);

describe('Tasks', () => {
  describe('create', () => {
    it('assigns sequential keys and column positions', async () => {
      const { owner, project } = await fixture();

      const t1 = await createTask(owner, project.id, { title: 'First' });
      const t2 = await createTask(owner, project.id, { title: 'Second' });
      const t3 = await createTask(owner, project.id, { title: 'Third', status: 'IN_PROGRESS' });

      expect(t1).toMatchObject({ key: 'WEB-1', number: 1, status: 'TODO', priority: 'MEDIUM', position: 1024 });
      expect(t2).toMatchObject({ key: 'WEB-2', number: 2, position: 2048 });
      expect(t3).toMatchObject({ key: 'WEB-3', number: 3, status: 'IN_PROGRESS', position: 1024 });
      expect(t1.createdBy.id).toBe(owner.id);
      expect(t1).toMatchObject({
        assignee: null,
        labels: [],
        subtaskCount: 0,
        subtaskDoneCount: 0,
        commentCount: 0,
        completedAt: null,
        parentTaskId: null,
        dependsOn: [],
        checklist: [],
      });

      const activity = await Activity.findOne({ projectId: project.id, type: 'TASK_CREATED' }).sort({ _id: 1 }).lean();
      expect(activity?.target).toMatchObject({ type: 'task', id: t1.id, title: 'First' });
    });

    it('keeps numbering per project', async () => {
      const { owner, ws, project } = await fixture();
      const other = await createProject(owner, ws.id, { name: 'API', key: 'API' });
      await createTask(owner, project.id, { title: 'A' });
      const t = await createTask(owner, other.id, { title: 'B' });
      expect(t.key).toBe('API-1');
    });

    it('validates assignee, labels and checklist ids', async () => {
      const { owner, member, ws, project } = await fixture();
      const nonProjectMember = await join(owner, ws.id, 'MEMBER');

      const bad = await api()
        .post(`/api/projects/${project.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'X', assigneeId: nonProjectMember.id });
      expect(bad.status).toBe(400);

      const badLabel = await api()
        .post(`/api/projects/${project.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'X', labelIds: ['64b000000000000000000000'] });
      expect(badLabel.status).toBe(400);

      const good = await createTask(owner, project.id, {
        title: 'Assigned',
        assigneeId: member.id,
        checklist: [{ text: 'Step 1' }, { id: 'custom', text: 'Step 2', done: true }],
        dueDate: '2030-05-01T00:00:00.000Z',
        estimateHours: 2.5,
      });
      expect(good.assignee?.id).toBe(member.id);
      expect(good.checklist).toHaveLength(2);
      expect(good.checklist[0]?.id).toBeTruthy();
      expect(good.checklist[1]).toEqual({ id: 'custom', text: 'Step 2', done: true });
      expect(good.dueDate).toBe('2030-05-01T00:00:00.000Z');
      expect(good.estimateHours).toBe(2.5);

      const assigned = await Activity.findOne({ projectId: project.id, type: 'TASK_ASSIGNED' }).sort({ _id: 1 }).lean();
      expect(assigned?.metadata).toMatchObject({ to: member.id });
    });

    it('sets completedAt when created as DONE', async () => {
      const { owner, project } = await fixture();
      const t = await createTask(owner, project.id, { title: 'Done', status: 'DONE' });
      expect(t.completedAt).not.toBeNull();
    });
  });

  describe('read, update, move', () => {
    it('gets a task by id and 404s for unknown ones', async () => {
      const { owner, member, project } = await fixture();
      const t = await createTask(owner, project.id, { title: 'Read me' });

      const res = await api().get(`/api/tasks/${t.id}`).set('Cookie', member.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.key).toBe('WEB-1');

      const missing = await api().get('/api/tasks/64b000000000000000000000').set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
    });

    it('updates fields, toggles completedAt and records diffs', async () => {
      const { owner, member, project } = await fixture();
      const t = await createTask(owner, project.id, { title: 'Original', priority: 'LOW' });

      const res = await api()
        .patch(`/api/tasks/${t.id}`)
        .set('Cookie', member.cookie)
        .send({ title: 'Updated', priority: 'URGENT', assigneeId: member.id, status: 'DONE', description: 'Desc' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        title: 'Updated',
        priority: 'URGENT',
        status: 'DONE',
        description: 'Desc',
        assignee: { id: member.id },
      });
      expect(res.body.data.completedAt).not.toBeNull();

      const reopen = await api().patch(`/api/tasks/${t.id}`).set('Cookie', owner.cookie).send({ status: 'TODO' });
      expect(reopen.body.data.completedAt).toBeNull();

      const updated = await Activity.findOne({ projectId: project.id, type: 'TASK_UPDATED' }).sort({ _id: 1 }).lean();
      const changes = (updated?.metadata as { changes: { field: string; from: unknown; to: unknown }[] }).changes;
      expect(changes).toEqual(
        expect.arrayContaining([
          { field: 'title', from: 'Original', to: 'Updated' },
          { field: 'priority', from: 'LOW', to: 'URGENT' },
          { field: 'status', from: 'TODO', to: 'DONE' },
          { field: 'assigneeId', from: null, to: member.id },
          { field: 'description', from: null, to: null },
        ]),
      );
      expect(await Activity.countDocuments({ projectId: project.id, type: 'TASK_ASSIGNED' })).toBe(1);
      expect(await Activity.countDocuments({ projectId: project.id, type: 'TASK_COMPLETED' })).toBe(1);

      const noop = await api().patch(`/api/tasks/${t.id}`).set('Cookie', owner.cookie).send({ title: 'Updated' });
      expect(noop.status).toBe(200);
      expect(await Activity.countDocuments({ projectId: project.id, type: 'TASK_UPDATED' })).toBe(2);

      const badAssignee = await api()
        .patch(`/api/tasks/${t.id}`)
        .set('Cookie', owner.cookie)
        .send({ assigneeId: '64b000000000000000000000' });
      expect(badAssignee.status).toBe(400);
    });

    it('moves tasks between columns, records TASK_MOVED and manages completedAt', async () => {
      const { owner, project } = await fixture();
      await createTask(owner, project.id, { title: 'Existing', status: 'IN_PROGRESS' });
      const t = await createTask(owner, project.id, { title: 'Mover' });

      const move = await api()
        .patch(`/api/tasks/${t.id}/move`)
        .set('Cookie', owner.cookie)
        .send({ status: 'IN_PROGRESS' });
      expect(move.status).toBe(200);
      expect(move.body.data).toMatchObject({ status: 'IN_PROGRESS', position: 2048 });

      const explicit = await api()
        .patch(`/api/tasks/${t.id}/move`)
        .set('Cookie', owner.cookie)
        .send({ status: 'DONE', position: 512.5 });
      expect(explicit.body.data).toMatchObject({ status: 'DONE', position: 512.5 });
      expect(explicit.body.data.completedAt).not.toBeNull();

      const back = await api().patch(`/api/tasks/${t.id}/move`).set('Cookie', owner.cookie).send({ status: 'REVIEW' });
      expect(back.body.data.completedAt).toBeNull();

      const moved = await Activity.find({ projectId: project.id, type: 'TASK_MOVED' }).sort({ createdAt: 1 }).lean();
      expect(moved).toHaveLength(3);
      expect(moved[0]?.metadata).toMatchObject({ from: 'TODO', to: 'IN_PROGRESS' });

      const invalid = await api().patch(`/api/tasks/${t.id}/move`).set('Cookie', owner.cookie).send({ status: 'NOPE' });
      expect(invalid.status).toBe(422);
    });
  });

  describe('list and filters', () => {
    it('applies every filter and paginates', async () => {
      const { owner, member, project } = await fixture();
      const label = await api()
        .post(`/api/projects/${project.id}/labels`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Bug', color: '#ff0000' });
      const labelId: string = label.body.data.id;

      const past = new Date(Date.now() - 86_400_000).toISOString();
      const future = new Date(Date.now() + 86_400_000).toISOString();

      const mine = await createTask(member, project.id, { title: 'Fix login bug', assigneeId: member.id, priority: 'HIGH', labelIds: [labelId] });
      const overdue = await createTask(owner, project.id, { title: 'Overdue report', dueDate: past, priority: 'URGENT' });
      const doneLate = await createTask(owner, project.id, { title: 'Done late', dueDate: past, status: 'DONE' });
      const soon = await createTask(owner, project.id, { title: 'Due soon', dueDate: future, status: 'IN_PROGRESS', priority: 'LOW' });
      const sub = await createTask(owner, project.id, { title: 'Subtask of login', parentTaskId: mine.id });

      const get = (qs: string) => api().get(`/api/projects/${project.id}/tasks?${qs}`).set('Cookie', member.cookie);

      const all = await get('');
      expect(all.status).toBe(200);
      expect(all.body.meta).toMatchObject({ page: 1, limit: 200, total: 5, totalPages: 1 });

      expect(ids((await get('status=DONE')).body.data)).toEqual([doneLate.id]);
      expect(ids((await get('assigneeId=me')).body.data)).toEqual([mine.id]);
      expect(ids((await get(`assigneeId=${member.id}`)).body.data)).toEqual([mine.id]);
      expect(ids((await get('assigneeId=unassigned')).body.data).sort()).toEqual(
        [overdue.id, doneLate.id, soon.id, sub.id].sort(),
      );
      expect(ids((await get('overdue=true')).body.data)).toEqual([overdue.id]);
      expect(ids((await get(`dueBefore=${encodeURIComponent(new Date().toISOString())}`)).body.data).sort()).toEqual(
        [overdue.id, doneLate.id].sort(),
      );
      expect(ids((await get('search=LOGIN')).body.data).sort()).toEqual([mine.id, sub.id].sort());
      expect(ids((await get(`labelId=${labelId}`)).body.data)).toEqual([mine.id]);
      expect(ids((await get('priority=URGENT')).body.data)).toEqual([overdue.id]);
      expect(ids((await get('parentTaskId=none')).body.data)).not.toContain(sub.id);
      expect(ids((await get(`parentTaskId=${mine.id}`)).body.data)).toEqual([sub.id]);

      const byPriority = await get('sort=priority&order=desc');
      const priorities = byPriority.body.data.map((t: TaskDto) => t.priority);
      expect(priorities.slice(0, 2)).toEqual(['URGENT', 'HIGH']);
      expect(priorities[priorities.length - 1]).toBe('LOW');

      const asc = await get('sort=priority&order=asc');
      expect(asc.body.data[0].priority).toBe('LOW');

      const newest = await get('sort=createdAt&order=desc');
      expect(newest.body.data[0].id).toBe(sub.id);

      const paged = await get('limit=2&page=2&sort=createdAt');
      expect(paged.body.data).toHaveLength(2);
      expect(paged.body.meta).toMatchObject({ page: 2, limit: 2, total: 5, totalPages: 3 });
      expect(ids(paged.body.data)).toEqual([doneLate.id, soon.id]);

      const invalid = await get('status=BOGUS');
      expect(invalid.status).toBe(422);
    });
  });

  describe('subtasks and dependencies', () => {
    it('creates one level of subtasks and counts them on the parent', async () => {
      const { owner, project } = await fixture();
      const parent = await createTask(owner, project.id, { title: 'Parent' });
      const s1 = await createTask(owner, project.id, { title: 'S1', parentTaskId: parent.id });
      const s2 = await createTask(owner, project.id, { title: 'S2', parentTaskId: parent.id, status: 'DONE' });

      const nested = await api()
        .post(`/api/projects/${project.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Nested', parentTaskId: s1.id });
      expect(nested.status).toBe(400);

      const selfParent = await api()
        .patch(`/api/tasks/${parent.id}`)
        .set('Cookie', owner.cookie)
        .send({ parentTaskId: parent.id });
      expect(selfParent.status).toBe(400);

      const parentWithChildrenBecomesChild = await api()
        .patch(`/api/tasks/${parent.id}`)
        .set('Cookie', owner.cookie)
        .send({ parentTaskId: s1.id });
      expect(parentWithChildrenBecomesChild.status).toBe(400);

      const list = await api().get(`/api/tasks/${parent.id}/subtasks`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(ids(list.body.data).sort()).toEqual([s1.id, s2.id].sort());

      const got = await api().get(`/api/tasks/${parent.id}`).set('Cookie', owner.cookie);
      expect(got.body.data).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1 });
    });

    it('rejects parents and dependencies from other projects', async () => {
      const { owner, ws, project } = await fixture();
      const other = await createProject(owner, ws.id, { name: 'Other' });
      const foreign = await createTask(owner, other.id, { title: 'Foreign' });

      const badParent = await api()
        .post(`/api/projects/${project.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'X', parentTaskId: foreign.id });
      expect(badParent.status).toBe(400);

      const badDep = await api()
        .post(`/api/projects/${project.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'X', dependsOn: [foreign.id] });
      expect(badDep.status).toBe(400);
    });

    it('rejects self-dependencies and direct cycles', async () => {
      const { owner, project } = await fixture();
      const a = await createTask(owner, project.id, { title: 'A' });
      const b = await createTask(owner, project.id, { title: 'B', dependsOn: [a.id] });
      expect(b.dependsOn).toEqual([a.id]);

      const cycle = await api().patch(`/api/tasks/${a.id}`).set('Cookie', owner.cookie).send({ dependsOn: [b.id] });
      expect(cycle.status).toBe(400);

      const self = await api().patch(`/api/tasks/${a.id}`).set('Cookie', owner.cookie).send({ dependsOn: [a.id] });
      expect(self.status).toBe(400);

      const c = await createTask(owner, project.id, { title: 'C' });
      const ok = await api().patch(`/api/tasks/${a.id}`).set('Cookie', owner.cookie).send({ dependsOn: [c.id, c.id] });
      expect(ok.status).toBe(200);
      expect(ok.body.data.dependsOn).toEqual([c.id]);
    });
  });

  describe('delete', () => {
    it('allows creator, assignee or MANAGER+, cascades subtasks and comments', async () => {
      const { owner, member, ws, project } = await fixture();
      const otherMember = await join(owner, ws.id, 'MEMBER');
      await api().post(`/api/projects/${project.id}/members`).set('Cookie', owner.cookie).send({ userIds: [otherMember.id] });
      const manager = await join(owner, ws.id, 'MANAGER');

      const parent = await createTask(owner, project.id, { title: 'Parent', assigneeId: member.id });
      const child = await createTask(owner, project.id, { title: 'Child', parentTaskId: parent.id });
      const dependent = await createTask(owner, project.id, { title: 'Dependent', dependsOn: [parent.id] });
      await api().post(`/api/tasks/${child.id}/comments`).set('Cookie', owner.cookie).send({ body: 'c' });

      const denied = await api().delete(`/api/tasks/${parent.id}`).set('Cookie', otherMember.cookie);
      expect(denied.status).toBe(403);

      const byAssignee = await api().delete(`/api/tasks/${parent.id}`).set('Cookie', member.cookie);
      expect(byAssignee.status).toBe(204);

      expect(await Task.countDocuments({ _id: { $in: [parent.id, child.id] } })).toBe(0);
      expect(await Comment.countDocuments({ taskId: child.id })).toBe(0);
      const dep = await Task.findById(dependent.id).lean();
      expect(dep?.dependsOn).toEqual([]);

      const mine = await createTask(otherMember, project.id, { title: 'Mine' });
      const byCreator = await api().delete(`/api/tasks/${mine.id}`).set('Cookie', otherMember.cookie);
      expect(byCreator.status).toBe(204);

      const any = await createTask(owner, project.id, { title: 'Any' });
      const byManager = await api().delete(`/api/tasks/${any.id}`).set('Cookie', manager.cookie);
      expect(byManager.status).toBe(204);

      const gone = await api().get(`/api/tasks/${any.id}`).set('Cookie', owner.cookie);
      expect(gone.status).toBe(404);

      expect(await Activity.countDocuments({ projectId: project.id, type: 'TASK_DELETED' })).toBe(3);
    });
  });
});

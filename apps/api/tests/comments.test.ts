import type { CommentDto, ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Activity } from '../src/models/Activity';
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

interface Fixture {
  owner: TestUser;
  manager: TestUser;
  author: TestUser;
  other: TestUser;
  viewer: TestUser;
  ws: WorkspaceDto;
  project: ProjectDto;
  task: TaskDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const manager = await join(owner, ws.id, 'MANAGER');
  const author = await join(owner, ws.id, 'MEMBER');
  const other = await join(owner, ws.id, 'MEMBER');
  const viewer = await join(owner, ws.id, 'VIEWER');

  const project = await api()
    .post(`/api/workspaces/${ws.id}/projects`)
    .set('Cookie', owner.cookie)
    .send({ name: 'Proj', memberIds: [author.id, other.id, viewer.id] });
  expect(project.status).toBe(201);

  const task = await api()
    .post(`/api/projects/${project.body.data.id}/tasks`)
    .set('Cookie', owner.cookie)
    .send({ title: 'Discuss' });
  expect(task.status).toBe(201);

  return { owner, manager, author, other, viewer, ws, project: project.body.data, task: task.body.data };
}

const comment = (actor: TestUser, taskId: string, body: Record<string, unknown>) =>
  api().post(`/api/tasks/${taskId}/comments`).set('Cookie', actor.cookie).send(body);

describe('Comments', () => {
  it('creates comments, filters mentions to workspace members and bumps commentCount', async () => {
    const { author, other, task, ws } = await fixture();
    const stranger = await createTestUser();

    const res = await comment(author, task.id, { body: 'Hello @other', mentions: [other.id, stranger.id] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      taskId: task.id,
      body: 'Hello @other',
      mentions: [other.id],
      editedAt: null,
      author: { id: author.id },
    });

    const got = await api().get(`/api/tasks/${task.id}`).set('Cookie', author.cookie);
    expect(got.body.data.commentCount).toBe(1);

    const activity = await Activity.findOne({ workspaceId: ws.id, type: 'COMMENT_ADDED' }).sort({ _id: 1 }).lean();
    expect(activity?.target).toMatchObject({ type: 'task', id: task.id });
    expect(activity?.metadata).toMatchObject({ commentId: res.body.data.id, mentions: [other.id] });

    const invalid = await comment(author, task.id, { body: '' });
    expect(invalid.status).toBe(422);
  });

  it('VIEWER can read but not write comments', async () => {
    const { author, viewer, task } = await fixture();
    await comment(author, task.id, { body: 'visible' });

    const denied = await comment(viewer, task.id, { body: 'nope' });
    expect(denied.status).toBe(403);

    const list = await api().get(`/api/tasks/${task.id}/comments`).set('Cookie', viewer.cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('lists comments oldest first with pagination meta', async () => {
    const { author, task } = await fixture();
    for (const body of ['one', 'two', 'three']) {
      const res = await comment(author, task.id, { body });
      expect(res.status).toBe(201);
    }

    const page1 = await api().get(`/api/tasks/${task.id}/comments?limit=2`).set('Cookie', author.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.data.map((c: CommentDto) => c.body)).toEqual(['one', 'two']);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const page2 = await api().get(`/api/tasks/${task.id}/comments?limit=2&page=2`).set('Cookie', author.cookie);
    expect(page2.body.data.map((c: CommentDto) => c.body)).toEqual(['three']);
  });

  it('only the author can edit; editing sets editedAt', async () => {
    const { author, other, owner, task, ws } = await fixture();
    const created = await comment(author, task.id, { body: 'draft' });
    const id: string = created.body.data.id;

    const byOther = await api().patch(`/api/comments/${id}`).set('Cookie', other.cookie).send({ body: 'hijack' });
    expect(byOther.status).toBe(403);

    const byOwner = await api().patch(`/api/comments/${id}`).set('Cookie', owner.cookie).send({ body: 'hijack' });
    expect(byOwner.status).toBe(403);

    const res = await api().patch(`/api/comments/${id}`).set('Cookie', author.cookie).send({ body: 'final' });
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe('final');
    expect(res.body.data.editedAt).not.toBeNull();

    const list = await api().get(`/api/tasks/${task.id}/comments`).set('Cookie', author.cookie);
    expect(list.body.data[0]).toMatchObject({ body: 'final' });
    expect(list.body.data[0].editedAt).not.toBeNull();

    expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'COMMENT_UPDATED' })).toBe(1);

    const missing = await api()
      .patch('/api/comments/64b000000000000000000000')
      .set('Cookie', author.cookie)
      .send({ body: 'x' });
    expect(missing.status).toBe(404);
  });

  it('author or MANAGER+ can delete; other members cannot', async () => {
    const { author, other, manager, owner, task, ws } = await fixture();
    const c1 = (await comment(author, task.id, { body: 'a' })).body.data.id as string;
    const c2 = (await comment(author, task.id, { body: 'b' })).body.data.id as string;
    const c3 = (await comment(author, task.id, { body: 'c' })).body.data.id as string;

    const byOther = await api().delete(`/api/comments/${c1}`).set('Cookie', other.cookie);
    expect(byOther.status).toBe(403);

    const byAuthor = await api().delete(`/api/comments/${c1}`).set('Cookie', author.cookie);
    expect(byAuthor.status).toBe(204);

    const byManager = await api().delete(`/api/comments/${c2}`).set('Cookie', manager.cookie);
    expect(byManager.status).toBe(204);

    const byOwner = await api().delete(`/api/comments/${c3}`).set('Cookie', owner.cookie);
    expect(byOwner.status).toBe(204);

    const again = await api().delete(`/api/comments/${c3}`).set('Cookie', owner.cookie);
    expect(again.status).toBe(404);

    const got = await api().get(`/api/tasks/${task.id}`).set('Cookie', author.cookie);
    expect(got.body.data.commentCount).toBe(0);

    expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'COMMENT_DELETED' })).toBe(3);
  });

  it('non-members of the workspace cannot access comments at all', async () => {
    const { author, task } = await fixture();
    const stranger = await createTestUser();
    const created = await comment(author, task.id, { body: 'private' });

    const list = await api().get(`/api/tasks/${task.id}/comments`).set('Cookie', stranger.cookie);
    expect(list.status).toBe(403);

    const edit = await api()
      .patch(`/api/comments/${created.body.data.id}`)
      .set('Cookie', stranger.cookie)
      .send({ body: 'x' });
    expect(edit.status).toBe(403);
  });
});

import type { NotificationDto, ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Notification } from '../src/models/Notification';
import { User } from '../src/models/User';
import { sentEmails } from '../src/services/email';
import { api, createTestUser, type TestUser } from './helpers';

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (pred(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const settle = () => new Promise((r) => setTimeout(r, 150));

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

const notificationsFor = (userId: string, type?: string) =>
  Notification.find({ userId, ...(type ? { type } : {}) })
    .sort({ createdAt: 1 })
    .lean();

async function fixture() {
  const owner = await createTestUser({ name: 'Olivia Owner' });
  const ws = await createWorkspace(owner);
  const member = await join(owner, ws.id, 'MEMBER');
  const project = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id] });
  return { owner, member, ws, project };
}

describe('Notifications', () => {
  describe('rules', () => {
    it('notifies the new assignee (never the actor) and emails per preferences', async () => {
      const { owner, member, ws, project } = await fixture();
      const emailsBefore = sentEmails.length;

      const task = await createTask(owner, project.id, { title: 'Ship it', assigneeId: member.id });
      const [n] = await waitFor(() => notificationsFor(member.id, 'TASK_ASSIGNED'), (l) => l.length === 1);
      expect(n).toMatchObject({
        workspaceId: expect.anything(),
        title: 'Olivia Owner assigned you WEB-1',
        body: 'Ship it',
        link: `/w/${ws.id}/projects/${project.id}/board?task=${task.id}`,
        readAt: null,
      });
      expect(String(n?.actorId)).toBe(owner.id);
      expect(String(n?.entity?.id)).toBe(task.id);

      const emailed = await waitFor(() => Notification.findById(n?._id).lean(), (d) => d?.emailedAt != null);
      expect(emailed?.emailedAt).toBeInstanceOf(Date);
      const mail = sentEmails.slice(emailsBefore).find((m) => m.to === member.user.email);
      expect(mail?.subject).toBe('Olivia Owner assigned you WEB-1');
      expect(mail?.html).toContain(`/w/${ws.id}/projects/${project.id}/board?task=${task.id}`);
      expect(mail?.html).toContain('Open in NEXUS');

      // Self-assignment never notifies
      await createTask(owner, project.id, { title: 'Mine', assigneeId: owner.id });
      await settle();
      expect(await Notification.countDocuments({ userId: owner.id, type: 'TASK_ASSIGNED' })).toBe(0);
    });

    it('respects email and inApp preferences', async () => {
      const { owner, member, project } = await fixture();
      await User.updateOne({ _id: member.id }, { $set: { 'preferences.notifications.email': false } });
      const before = sentEmails.length;

      await createTask(owner, project.id, { title: 'Quiet', assigneeId: member.id });
      const [n] = await waitFor(() => notificationsFor(member.id, 'TASK_ASSIGNED'), (l) => l.length === 1);
      await settle();
      expect((await Notification.findById(n?._id).lean())?.emailedAt).toBeNull();
      expect(sentEmails.slice(before).some((m) => m.to === member.user.email)).toBe(false);

      await User.updateOne({ _id: member.id }, { $set: { 'preferences.notifications.email': true, 'preferences.notifications.taskAssigned': false } });
      await createTask(owner, project.id, { title: 'Still quiet', assigneeId: member.id });
      await waitFor(() => notificationsFor(member.id, 'TASK_ASSIGNED'), (l) => l.length === 2);
      await settle();
      expect(sentEmails.slice(before).some((m) => m.to === member.user.email)).toBe(false);

      await User.updateOne({ _id: member.id }, { $set: { 'preferences.notifications.inApp': false } });
      await createTask(owner, project.id, { title: 'Silence', assigneeId: member.id });
      await settle();
      expect(await Notification.countDocuments({ userId: member.id })).toBe(2);
    });

    it('collapses repeated identical notifications within 60 s', async () => {
      const { owner, member, project } = await fixture();
      const task = await createTask(owner, project.id, { title: 'Flip flop' });

      await api().patch(`/api/tasks/${task.id}`).set('Cookie', owner.cookie).send({ assigneeId: member.id });
      await api().patch(`/api/tasks/${task.id}`).set('Cookie', owner.cookie).send({ assigneeId: null });
      await api().patch(`/api/tasks/${task.id}`).set('Cookie', owner.cookie).send({ assigneeId: member.id });
      await waitFor(() => notificationsFor(member.id, 'TASK_ASSIGNED'), (l) => l.length === 1);
      await settle();
      expect(await Notification.countDocuments({ userId: member.id, type: 'TASK_ASSIGNED' })).toBe(1);
    });

    it('notifies the creator on completion via update or move', async () => {
      const { owner, member, project } = await fixture();
      const t1 = await createTask(owner, project.id, { title: 'Finish me', assigneeId: member.id });
      await api().patch(`/api/tasks/${t1.id}`).set('Cookie', member.cookie).send({ status: 'DONE' });
      const [n] = await waitFor(() => notificationsFor(owner.id, 'TASK_COMPLETED'), (l) => l.length === 1);
      expect(n?.title).toBe(`${member.user.name} completed WEB-1`);

      const t2 = await createTask(owner, project.id, { title: 'Drag me', assigneeId: member.id });
      await api().patch(`/api/tasks/${t2.id}/move`).set('Cookie', member.cookie).send({ status: 'DONE' });
      await waitFor(() => notificationsFor(owner.id, 'TASK_COMPLETED'), (l) => l.length === 2);

      // Completing your own task is silent
      const t3 = await createTask(member, project.id, { title: 'Solo' });
      await api().patch(`/api/tasks/${t3.id}`).set('Cookie', member.cookie).send({ status: 'DONE' });
      await settle();
      expect(await Notification.countDocuments({ userId: member.id, type: 'TASK_COMPLETED' })).toBe(0);
    });

    it('notifies task watchers on comments and mentioned users with MENTION', async () => {
      const { owner, member, ws, project } = await fixture();
      const third = await join(owner, ws.id, 'MEMBER');
      await api().post(`/api/projects/${project.id}/members`).set('Cookie', owner.cookie).send({ userIds: [third.id] });
      const task = await createTask(owner, project.id, { title: 'Discuss', assigneeId: third.id });

      const res = await api()
        .post(`/api/tasks/${task.id}/comments`)
        .set('Cookie', member.cookie)
        .send({ body: 'Looks good @third', mentions: [third.id] });
      expect(res.status).toBe(201);

      const [commented] = await waitFor(() => notificationsFor(owner.id, 'COMMENT_ADDED'), (l) => l.length === 1);
      expect(commented).toMatchObject({ title: `${member.user.name} commented on WEB-1`, body: 'Looks good @third' });
      const [mention] = await waitFor(() => notificationsFor(third.id, 'MENTION'), (l) => l.length === 1);
      expect(mention?.title).toBe(`${member.user.name} mentioned you in WEB-1`);
      await settle();
      // Mentioned assignee gets MENTION instead of COMMENT_ADDED
      expect(await Notification.countDocuments({ userId: third.id, type: 'COMMENT_ADDED' })).toBe(0);
      expect(await Notification.countDocuments({ userId: member.id })).toBe(0);
    });

    it('tells owners and admins when someone joins', async () => {
      const owner = await createTestUser({ name: 'Boss' });
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');
      await waitFor(() => notificationsFor(owner.id, 'MEMBER_JOINED'), (l) => l.length === 1);

      const member = await join(owner, ws.id, 'MEMBER');
      const [, n] = await waitFor(() => notificationsFor(owner.id, 'MEMBER_JOINED'), (l) => l.length === 2);
      await waitFor(() => notificationsFor(admin.id, 'MEMBER_JOINED'), (l) => l.length === 1);
      expect(n).toMatchObject({ title: `${member.user.name} joined Acme Inc`, link: `/w/${ws.id}/members` });
      expect(await Notification.countDocuments({ userId: member.id })).toBe(0);
    });

    it('sends NEW_MESSAGE for DMs unless muted', async () => {
      const { owner, member, ws } = await fixture();
      const dm = await api().post(`/api/workspaces/${ws.id}/channels/dm`).set('Cookie', owner.cookie).send({ userId: member.id });
      const channelId: string = dm.body.data.id;

      await api().post(`/api/channels/${channelId}/messages`).set('Cookie', owner.cookie).send({ body: 'Psst' });
      const [n] = await waitFor(() => notificationsFor(member.id, 'NEW_MESSAGE'), (l) => l.length === 1);
      expect(n).toMatchObject({ title: 'New message from Olivia Owner', body: 'Psst', link: `/w/${ws.id}/chat/${channelId}` });

      await api().post(`/api/channels/${channelId}/mute`).set('Cookie', member.cookie).send({ muted: true });
      await api().post(`/api/channels/${channelId}/messages`).set('Cookie', owner.cookie).send({ body: 'Again' });
      await settle();
      expect(await Notification.countDocuments({ userId: member.id, type: 'NEW_MESSAGE' })).toBe(1);
      expect(await Notification.countDocuments({ userId: owner.id, type: { $in: ['NEW_MESSAGE', 'MENTION'] } })).toBe(0);
    });
  });

  describe('REST', () => {
    it('lists, counts, marks read and deletes', async () => {
      const { owner, member, ws, project } = await fixture();
      const other = await createWorkspace(owner, 'Other');
      const otherMember = await join(owner, other.id, 'MEMBER');
      const otherProject = await createProject(owner, other.id, { name: 'Side', key: 'SIDE', memberIds: [otherMember.id] });
      await createTask(owner, project.id, { title: 'A', assigneeId: member.id });
      await createTask(owner, otherProject.id, { title: 'B', assigneeId: otherMember.id });
      const t2 = await createTask(owner, project.id, { title: 'C' });
      await api().patch(`/api/tasks/${t2.id}`).set('Cookie', owner.cookie).send({ assigneeId: member.id });
      await waitFor(() => notificationsFor(member.id), (l) => l.length === 2);

      const list = await api().get('/api/notifications').set('Cookie', member.cookie);
      expect(list.status).toBe(200);
      expect(list.body.meta).toMatchObject({ total: 2, page: 1 });
      const items = list.body.data as NotificationDto[];
      expect(items[0]?.title).toContain('WEB-2');
      expect(items[0]?.actor).toMatchObject({ id: owner.id, name: 'Olivia Owner' });
      expect(items[0]?.entity).toMatchObject({ type: 'task' });

      const count = await api().get('/api/notifications/unread-count').set('Cookie', member.cookie);
      expect(count.body.data).toEqual({ total: 2, byWorkspace: { [ws.id]: 2 } });

      const first = items[1] as NotificationDto;
      const read = await api().patch(`/api/notifications/${first.id}/read`).set('Cookie', member.cookie);
      expect(read.status).toBe(200);
      expect(read.body.data.readAt).not.toBeNull();
      const unreadOnly = await api().get('/api/notifications?unread=true').set('Cookie', member.cookie);
      expect(unreadOnly.body.data).toHaveLength(1);
      const byWs = await api().get(`/api/notifications?workspaceId=${other.id}`).set('Cookie', member.cookie);
      expect(byWs.body.data).toHaveLength(0);

      const foreign = await api().patch(`/api/notifications/${first.id}/read`).set('Cookie', owner.cookie);
      expect(foreign.status).toBe(404);

      const all = await api().post('/api/notifications/read-all').set('Cookie', member.cookie).send({});
      expect(all.body.data).toEqual({ updated: 1 });
      expect((await api().get('/api/notifications/unread-count').set('Cookie', member.cookie)).body.data.total).toBe(0);

      const del = await api().delete(`/api/notifications/${first.id}`).set('Cookie', member.cookie);
      expect(del.status).toBe(204);
      const gone = await api().delete(`/api/notifications/${first.id}`).set('Cookie', member.cookie);
      expect(gone.status).toBe(404);
      expect((await api().get('/api/notifications').set('Cookie', member.cookie)).body.meta.total).toBe(1);

      const anon = await api().get('/api/notifications');
      expect(anon.status).toBe(401);
    });
  });
});

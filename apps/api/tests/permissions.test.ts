import {
  PERMISSIONS,
  WORKSPACE_ROLES,
  hasPermission,
  type Permission,
  type ProjectDto,
  type TaskDto,
  type WorkspaceDto,
  type WorkspaceRole,
} from '@nexus/shared';
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
  users: Record<WorkspaceRole, TestUser>;
  ws: WorkspaceDto;
  project: ProjectDto;
  task: TaskDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const users: Record<WorkspaceRole, TestUser> = {
    OWNER: owner,
    ADMIN: await join(owner, ws.id, 'ADMIN'),
    MANAGER: await join(owner, ws.id, 'MANAGER'),
    MEMBER: await join(owner, ws.id, 'MEMBER'),
    VIEWER: await join(owner, ws.id, 'VIEWER'),
  };

  const project = await api()
    .post(`/api/workspaces/${ws.id}/projects`)
    .set('Cookie', owner.cookie)
    .send({ name: 'Matrix', memberIds: WORKSPACE_ROLES.map((r) => users[r].id) });
  expect(project.status).toBe(201);

  const task = await api()
    .post(`/api/projects/${project.body.data.id}/tasks`)
    .set('Cookie', owner.cookie)
    .send({ title: 'Seed' });
  expect(task.status).toBe(201);

  return { users, ws, project: project.body.data, task: task.body.data };
}

interface EndpointCase {
  name: string;
  permission: Permission;
  call: (actor: TestUser, f: Fixture) => ReturnType<ReturnType<typeof api>['get']>;
}

const cases: EndpointCase[] = [
  {
    name: 'PATCH /workspaces/:id',
    permission: 'workspace:update',
    call: (a, f) => api().patch(`/api/workspaces/${f.ws.id}`).set('Cookie', a.cookie).send({ description: 'x' }),
  },
  {
    name: 'GET /workspaces/:id/invitations',
    permission: 'member:invite',
    call: (a, f) => api().get(`/api/workspaces/${f.ws.id}/invitations`).set('Cookie', a.cookie),
  },
  {
    name: 'POST /workspaces/:id/projects',
    permission: 'project:create',
    call: (a, f) =>
      api().post(`/api/workspaces/${f.ws.id}/projects`).set('Cookie', a.cookie).send({ name: `P ${a.id}` }),
  },
  {
    name: 'PATCH /projects/:id',
    permission: 'project:update',
    call: (a, f) => api().patch(`/api/projects/${f.project.id}`).set('Cookie', a.cookie).send({ description: 'd' }),
  },
  {
    name: 'POST /projects/:id/tasks',
    permission: 'task:create',
    call: (a, f) => api().post(`/api/projects/${f.project.id}/tasks`).set('Cookie', a.cookie).send({ title: 'T' }),
  },
  {
    name: 'GET /projects/:id/tasks',
    permission: 'task:view',
    call: (a, f) => api().get(`/api/projects/${f.project.id}/tasks`).set('Cookie', a.cookie),
  },
  {
    name: 'PATCH /tasks/:id',
    permission: 'task:update',
    call: (a, f) => api().patch(`/api/tasks/${f.task.id}`).set('Cookie', a.cookie).send({ priority: 'HIGH' }),
  },
  {
    name: 'POST /tasks/:id/comments',
    permission: 'comment:create',
    call: (a, f) => api().post(`/api/tasks/${f.task.id}/comments`).set('Cookie', a.cookie).send({ body: 'hi' }),
  },
  {
    name: 'GET /workspaces/:id/activities',
    permission: 'activity:view',
    call: (a, f) => api().get(`/api/workspaces/${f.ws.id}/activities`).set('Cookie', a.cookie),
  },
  {
    name: 'POST /workspaces/:id/transfer (no-op target)',
    permission: 'workspace:transfer',
    // Transferring to a non-member yields 404 once authorized; 403 when not.
    call: (a, f) =>
      api()
        .post(`/api/workspaces/${f.ws.id}/transfer`)
        .set('Cookie', a.cookie)
        .send({ userId: '64b000000000000000000000' }),
  },
];

describe('Permissions matrix', () => {
  it('matches PERMISSIONS for every role x endpoint', async () => {
    const f = await fixture();
    const failures: string[] = [];

    for (const c of cases) {
      for (const role of WORKSPACE_ROLES) {
        const res = await c.call(f.users[role], f);
        const allowed = hasPermission(role, c.permission);
        const ok = allowed ? res.status !== 403 && res.status < 500 : res.status === 403;
        if (!ok) failures.push(`${role} ${c.name}: expected ${allowed ? 'allowed' : '403'}, got ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('exposes the same role sets the API relies on', () => {
    expect(PERMISSIONS['workspace:delete']).toEqual(['OWNER']);
    expect(hasPermission('VIEWER', 'task:create')).toBe(false);
    expect(hasPermission('MEMBER', 'task:create')).toBe(true);
  });

  it('rejects unauthenticated, unverified and non-member callers', async () => {
    const f = await fixture();
    const stranger = await createTestUser();
    const unverified = await createTestUser({ emailVerified: false });

    const anon = await api().get(`/api/workspaces/${f.ws.id}`);
    expect(anon.status).toBe(401);

    const nonMember = await api().get(`/api/workspaces/${f.ws.id}`).set('Cookie', stranger.cookie);
    expect(nonMember.status).toBe(403);
    const nonMemberTask = await api().get(`/api/tasks/${f.task.id}`).set('Cookie', stranger.cookie);
    expect(nonMemberTask.status).toBe(403);

    const write = await api().post('/api/workspaces').set('Cookie', unverified.cookie).send({ name: 'Nope' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    const read = await api().get('/api/workspaces').set('Cookie', unverified.cookie);
    expect(read.status).toBe(200);
  });

  it('MEMBER/VIEWER need project membership even with the workspace permission', async () => {
    const f = await fixture();
    const owner = f.users.OWNER;
    const hidden = await api()
      .post(`/api/workspaces/${f.ws.id}/projects`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Hidden' });

    const memberList = await api().get(`/api/projects/${hidden.body.data.id}/tasks`).set('Cookie', f.users.MEMBER.cookie);
    expect(memberList.status).toBe(403);
    const memberCreate = await api()
      .post(`/api/projects/${hidden.body.data.id}/tasks`)
      .set('Cookie', f.users.MEMBER.cookie)
      .send({ title: 'x' });
    expect(memberCreate.status).toBe(403);

    const managerList = await api().get(`/api/projects/${hidden.body.data.id}/tasks`).set('Cookie', f.users.MANAGER.cookie);
    expect(managerList.status).toBe(200);
  });

  it('applies role changes immediately (membership cache invalidation)', async () => {
    const f = await fixture();
    const member = f.users.MEMBER;

    const before = await api()
      .post(`/api/workspaces/${f.ws.id}/projects`)
      .set('Cookie', member.cookie)
      .send({ name: 'Before' });
    expect(before.status).toBe(403);

    const promote = await api()
      .patch(`/api/workspaces/${f.ws.id}/members/${member.id}`)
      .set('Cookie', f.users.OWNER.cookie)
      .send({ role: 'MANAGER' });
    expect(promote.status).toBe(200);

    const after = await api()
      .post(`/api/workspaces/${f.ws.id}/projects`)
      .set('Cookie', member.cookie)
      .send({ name: 'After' });
    expect(after.status).toBe(201);

    const removed = await api()
      .delete(`/api/workspaces/${f.ws.id}/members/${member.id}`)
      .set('Cookie', f.users.OWNER.cookie);
    expect(removed.status).toBe(204);

    const gone = await api().get(`/api/workspaces/${f.ws.id}`).set('Cookie', member.cookie);
    expect(gone.status).toBe(403);
  });
});

describe('GET /activities/me', () => {
  it('aggregates activity across the caller workspaces, newest first, paginated', async () => {
    const owner = await createTestUser();
    const ws1 = await createWorkspace(owner, 'One');
    const ws2 = await createWorkspace(owner, 'Two');
    const viewer = await join(owner, ws1.id, 'VIEWER');
    await createWorkspace(viewer, 'Mine');

    for (const ws of [ws1, ws2]) {
      const p = await api().post(`/api/workspaces/${ws.id}/projects`).set('Cookie', owner.cookie).send({ name: 'Proj' });
      await api().post(`/api/projects/${p.body.data.id}/tasks`).set('Cookie', owner.cookie).send({ title: 'T' });
    }

    const page1 = await api().get('/api/activities/me?limit=3').set('Cookie', owner.cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(3);
    // ws1: created, invite, joined, project, task = 5; ws2: created, project, task = 3
    expect(page1.body.meta).toEqual({ page: 1, limit: 3, total: 8, totalPages: 3 });
    expect(page1.body.data[0].type).toBe('TASK_CREATED');
    expect(page1.body.data[0].workspaceId).toBe(ws2.id);
    const times = page1.body.data.map((a: { createdAt: string }) => a.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const page3 = await api().get('/api/activities/me?limit=3&page=3').set('Cookie', owner.cookie);
    expect(page3.body.data).toHaveLength(2);
    expect(page3.body.data[1].type).toBe('WORKSPACE_CREATED');

    // The viewer only sees ws1 plus their own workspace, never ws2
    const asViewer = await api().get('/api/activities/me?limit=50').set('Cookie', viewer.cookie);
    const wsIds = new Set(asViewer.body.data.map((a: { workspaceId: string }) => a.workspaceId));
    expect(wsIds.has(ws1.id)).toBe(true);
    expect(wsIds.has(ws2.id)).toBe(false);
    expect(asViewer.body.meta.total).toBe(6);

    const nobody = await createTestUser();
    const empty = await api().get('/api/activities/me').set('Cookie', nobody.cookie);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.total).toBe(0);

    const anon = await api().get('/api/activities/me');
    expect(anon.status).toBe(401);
  });
});

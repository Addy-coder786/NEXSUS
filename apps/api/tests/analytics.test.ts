import type { ProjectAnalyticsDto, ProjectDto, TaskDto, WorkspaceAnalyticsDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Types } from 'mongoose';
import { events } from '../src/events';
import { Task } from '../src/models/Task';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { startOfWeekUTC, weekStarts } from '../src/modules/analytics/analytics.service';
import { runDeadlineScan } from '../src/modules/analytics/deadline.job';
import { assessHealth, healthStatus } from '../src/modules/analytics/health';
import { api, createTestUser, type TestUser } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

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

async function createTask(actor: TestUser, projectId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/projects/${projectId}/tasks`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as TaskDto;
}

/** Rewrites timestamps through the raw driver (createdAt is immutable for mongoose) to simulate history. */
async function backdate(taskId: string, fields: { createdAt?: Date; completedAt?: Date | null }) {
  await Task.collection.updateOne({ _id: new Types.ObjectId(taskId) }, { $set: fields });
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  other: TestUser;
  viewer: TestUser;
  ws: WorkspaceDto;
  web: ProjectDto;
  empty: ProjectDto;
  tasks: Record<'overdueUrgent' | 'dueSoon' | 'doneRecent' | 'doneOld' | 'blocked' | 'overdueUnassigned', TaskDto>;
}

/**
 * WEB project: 6 tasks.
 *  - overdueUrgent: TODO, member, due 2 days ago, URGENT
 *  - dueSoon: IN_PROGRESS, member, due in 3 days
 *  - doneRecent: DONE by other, created 5 days ago, completed yesterday (4-day cycle)
 *  - doneOld: DONE by other, created 20 days ago, completed 10 days ago (10-day cycle)
 *  - blocked: TODO, unassigned, depends on overdueUrgent
 *  - overdueUnassigned: BACKLOG, unassigned, due yesterday
 */
async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER');
  const other = await addMember(ws.id, 'MEMBER');
  const viewer = await addMember(ws.id, 'VIEWER');
  const web = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id, other.id] });
  const empty = await createProject(owner, ws.id, { name: 'API', key: 'API', memberIds: [viewer.id] });

  const overdueUrgent = await createTask(owner, web.id, { title: 'Ship it', assigneeId: member.id, priority: 'URGENT', dueDate: daysAgo(2).toISOString() });
  const dueSoon = await createTask(owner, web.id, { title: 'Polish', assigneeId: member.id, status: 'IN_PROGRESS', dueDate: daysAhead(3).toISOString() });
  const doneRecent = await createTask(owner, web.id, { title: 'Done recently', assigneeId: other.id, status: 'DONE' });
  const doneOld = await createTask(owner, web.id, { title: 'Done long ago', assigneeId: other.id, status: 'DONE' });
  const blocked = await createTask(owner, web.id, { title: 'Waiting', dependsOn: [overdueUrgent.id] });
  const overdueUnassigned = await createTask(owner, web.id, { title: 'Nobody', status: 'BACKLOG', dueDate: daysAgo(1).toISOString() });

  await backdate(doneRecent.id, { createdAt: daysAgo(5), completedAt: daysAgo(1) });
  await backdate(doneOld.id, { createdAt: daysAgo(20), completedAt: daysAgo(10) });

  return { owner, member, other, viewer, ws, web, empty, tasks: { overdueUrgent, dueSoon, doneRecent, doneOld, blocked, overdueUnassigned } };
}

describe('health', () => {
  it('scores a healthy project at 100 with no reasons', () => {
    const h = assessHealth({ overdue: 0, blocked: 0, open: 3, unassignedOpen: 0, completedLast7Days: 2, progressPercent: 40, projectDueDate: null });
    expect(h).toEqual({ status: 'ON_TRACK', score: 100, reasons: [], recommendation: null });
  });

  it('caps overdue and blocked deductions', () => {
    const overdue = assessHealth({ overdue: 10, blocked: 0, open: 10, unassignedOpen: 0, completedLast7Days: 1, progressPercent: 0, projectDueDate: null });
    expect(overdue.score).toBe(60);
    expect(overdue.status).toBe('AT_RISK');
    expect(overdue.reasons).toHaveLength(1);

    const blocked = assessHealth({ overdue: 0, blocked: 10, open: 10, unassignedOpen: 0, completedLast7Days: 1, progressPercent: 0, projectDueDate: null });
    expect(blocked.score).toBe(80);
    expect(blocked.status).toBe('ON_TRACK');
  });

  it('applies the unassigned, due-date and stale deductions only when their conditions hold', () => {
    const base = { overdue: 0, blocked: 0, completedLast7Days: 1, progressPercent: 50, projectDueDate: null as Date | null };
    expect(assessHealth({ ...base, open: 4, unassignedOpen: 1 }).score).toBe(100); // exactly 25% is fine
    expect(assessHealth({ ...base, open: 4, unassignedOpen: 2 }).score).toBe(90);
    expect(assessHealth({ ...base, open: 0, unassignedOpen: 0 }).score).toBe(100);

    const past = new Date(Date.now() - DAY);
    expect(assessHealth({ ...base, open: 2, unassignedOpen: 0, projectDueDate: past }).score).toBe(85);
    expect(assessHealth({ ...base, open: 0, unassignedOpen: 0, projectDueDate: past, progressPercent: 100 }).score).toBe(100);
    expect(assessHealth({ ...base, open: 2, unassignedOpen: 0, projectDueDate: new Date(Date.now() + DAY) }).score).toBe(100);

    expect(assessHealth({ ...base, open: 6, unassignedOpen: 0, completedLast7Days: 0 }).score).toBe(90);
    expect(assessHealth({ ...base, open: 5, unassignedOpen: 0, completedLast7Days: 0 }).score).toBe(100);
  });

  it('stacks deductions, floors at 0 and recommends the most impactful fix', () => {
    const h = assessHealth({
      overdue: 10,
      blocked: 10,
      open: 20,
      unassignedOpen: 10,
      completedLast7Days: 0,
      progressPercent: 10,
      projectDueDate: new Date(Date.now() - DAY),
      oldestOverdue: { key: 'WEB-7', title: 'Fix prod', priority: 'URGENT' },
    });
    expect(h.score).toBe(5);
    expect(h.status).toBe('OFF_TRACK');
    expect(h.reasons).toHaveLength(5);
    expect(h.recommendation).toContain('WEB-7');
    expect(h.recommendation).toContain('urgent');

    const floored = assessHealth({
      overdue: 10,
      blocked: 10,
      open: 20,
      unassignedOpen: 10,
      completedLast7Days: 0,
      progressPercent: 10,
      projectDueDate: new Date(Date.now() - DAY),
      now: new Date(),
    });
    expect(floored.score).toBeGreaterThanOrEqual(0);
  });

  it('maps scores to statuses at the documented thresholds', () => {
    expect(healthStatus(100)).toBe('ON_TRACK');
    expect(healthStatus(75)).toBe('ON_TRACK');
    expect(healthStatus(74)).toBe('AT_RISK');
    expect(healthStatus(45)).toBe('AT_RISK');
    expect(healthStatus(44)).toBe('OFF_TRACK');
    expect(healthStatus(0)).toBe('OFF_TRACK');
  });
});

describe('week helpers', () => {
  it('starts weeks on Monday (UTC) and produces trailing buckets oldest first', () => {
    const wednesday = new Date('2026-10-07T15:00:00.000Z');
    expect(startOfWeekUTC(wednesday).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(startOfWeekUTC(new Date('2026-10-05T00:00:00.000Z')).toISOString()).toBe('2026-10-05T00:00:00.000Z');
    expect(startOfWeekUTC(new Date('2026-10-04T23:59:59.000Z')).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    const starts = weekStarts(3, wednesday).map((d) => d.toISOString());
    expect(starts).toEqual(['2026-09-21T00:00:00.000Z', '2026-09-28T00:00:00.000Z', '2026-10-05T00:00:00.000Z']);
  });
});

describe('Analytics', () => {
  describe('GET /projects/:id/analytics', () => {
    it('aggregates summary, velocity, workload, health and cycle time', async () => {
      const f = await fixture();
      const res = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(res.status).toBe(200);
      const data = res.body.data as ProjectAnalyticsDto;

      expect(data.projectId).toBe(f.web.id);
      expect(data.summary).toEqual({
        total: 6,
        byStatus: { BACKLOG: 1, TODO: 2, IN_PROGRESS: 1, REVIEW: 0, DONE: 2 },
        byPriority: { LOW: 0, MEDIUM: 5, HIGH: 0, URGENT: 1 },
        overdue: 2,
        unassigned: 2,
        blocked: 1,
        dueNext7Days: 1,
        completedLast7Days: 1,
        createdLast7Days: 5,
        progressPercent: 33,
      });

      // Velocity: 8 trailing Monday-aligned weeks; totals match the seeded tasks.
      expect(data.velocity).toHaveLength(8);
      for (const point of data.velocity) {
        const d = new Date(point.weekStart);
        expect(d.getUTCDay()).toBe(1);
        expect(d.toISOString()).toBe(point.weekStart);
      }
      const bucket = (date: Date) => data.velocity.find((p) => p.weekStart === startOfWeekUTC(date).toISOString());
      expect(data.velocity.reduce((n, p) => n + p.completed, 0)).toBe(2);
      expect(data.velocity.reduce((n, p) => n + p.created, 0)).toBe(6);
      expect(bucket(daysAgo(1))?.completed).toBeGreaterThanOrEqual(1);
      expect(bucket(daysAgo(10))?.completed).toBeGreaterThanOrEqual(1);
      expect(bucket(daysAgo(20))?.created).toBeGreaterThanOrEqual(1);
      expect(data.velocity[7]?.weekStart).toBe(startOfWeekUTC(new Date()).toISOString());

      expect(data.workload).toHaveLength(2);
      expect(data.workload[0]).toMatchObject({ user: { id: f.member.id }, open: 2, inProgress: 1, overdue: 1, completedLast7Days: 0 });
      expect(data.workload[1]).toMatchObject({ user: { id: f.other.id }, open: 0, inProgress: 0, overdue: 0, completedLast7Days: 1 });

      // 100 - 16 (2 overdue) - 5 (1 blocked) - 10 (2 of 4 open unassigned)
      expect(data.health.score).toBe(69);
      expect(data.health.status).toBe('AT_RISK');
      expect(data.health.reasons).toHaveLength(3);
      expect(data.health.recommendation).toContain(f.tasks.overdueUrgent.key);

      expect(data.avgCycleTimeDays).toBe(7);
      expect(typeof data.generatedAt).toBe('string');
    });

    it('honours the weeks parameter and validates it', async () => {
      const f = await fixture();
      const res = await api().get(`/api/projects/${f.web.id}/analytics?weeks=4`).set('Cookie', f.member.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.velocity).toHaveLength(4);
      expect((await api().get(`/api/projects/${f.web.id}/analytics?weeks=1`).set('Cookie', f.owner.cookie)).status).toBe(422);
      expect((await api().get(`/api/projects/${f.web.id}/analytics?weeks=27`).set('Cookie', f.owner.cookie)).status).toBe(422);
    });

    it('caches for 60 s and invalidates on task events', async () => {
      const f = await fixture();
      const first = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      // Direct DB writes do not emit events, so the cached result is served unchanged.
      await Task.collection.updateOne({ _id: new Types.ObjectId(f.tasks.blocked.id) }, { $set: { status: 'DONE' } });
      const cached = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(cached.body.data.generatedAt).toBe(first.body.data.generatedAt);
      expect(cached.body.data.summary.byStatus.DONE).toBe(2);

      // A task written through the API emits task.created, which drops the cache.
      await createTask(f.owner, f.web.id, { title: 'Sneaky new task' });
      await new Promise((resolve) => setImmediate(resolve));
      const fresh = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(fresh.body.data.summary.total).toBe(7);
      expect(fresh.body.data.summary.byStatus.DONE).toBe(3);
      expect(fresh.body.data.generatedAt).not.toBe(first.body.data.generatedAt);

      // Explicit domain events invalidate too.
      const again = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(again.body.data.generatedAt).toBe(fresh.body.data.generatedAt);
      events.emit('task.deleted', { workspaceId: f.ws.id, projectId: f.web.id, taskId: f.tasks.blocked.id, actorId: f.owner.id });
      await new Promise((resolve) => setImmediate(resolve));
      const afterEvent = await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(afterEvent.body.data.generatedAt).not.toBe(fresh.body.data.generatedAt);
    });

    it('requires project access', async () => {
      const f = await fixture();
      expect((await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', f.viewer.cookie)).status).toBe(403);
      const stranger = await createTestUser();
      expect((await api().get(`/api/projects/${f.web.id}/analytics`).set('Cookie', stranger.cookie)).status).toBe(403);
      expect((await api().get(`/api/projects/${f.web.id}/analytics`)).status).toBe(401);
      expect((await api().get('/api/projects/64b000000000000000000000/analytics').set('Cookie', f.owner.cookie)).status).toBe(404);
    });
  });

  describe('GET /workspaces/:id/analytics', () => {
    it('rolls up accessible projects with per-project progress and health', async () => {
      const f = await fixture();
      const res = await api().get(`/api/workspaces/${f.ws.id}/analytics`).set('Cookie', f.owner.cookie);
      expect(res.status).toBe(200);
      const data = res.body.data as WorkspaceAnalyticsDto;

      expect(data.workspaceId).toBe(f.ws.id);
      expect(data.summary.total).toBe(6);
      expect(data.summary.blocked).toBe(1);
      expect(data.velocity).toHaveLength(8);
      expect(data.workload).toHaveLength(2);
      expect(data.activeMembers7Days).toBeGreaterThanOrEqual(1);

      expect(data.projects.map((p) => p.key)).toEqual(['WEB', 'API']);
      expect(data.projects[0]).toMatchObject({
        projectId: f.web.id,
        name: 'Web App',
        total: 6,
        done: 2,
        overdue: 2,
        progressPercent: 33,
        health: 'AT_RISK',
        status: 'ACTIVE',
        dueDate: null,
      });
      expect(data.projects[1]).toMatchObject({ key: 'API', total: 0, done: 0, overdue: 0, progressPercent: 0, health: 'ON_TRACK' });
    });

    it('limits restricted roles to their projects and caches per viewer', async () => {
      const f = await fixture();
      const asViewer = await api().get(`/api/workspaces/${f.ws.id}/analytics`).set('Cookie', f.viewer.cookie);
      expect(asViewer.status).toBe(200);
      expect(asViewer.body.data.projects.map((p: { key: string }) => p.key)).toEqual(['API']);
      expect(asViewer.body.data.summary.total).toBe(0);

      const asMember = await api().get(`/api/workspaces/${f.ws.id}/analytics`).set('Cookie', f.member.cookie);
      expect(asMember.body.data.projects.map((p: { key: string }) => p.key)).toEqual(['WEB']);
      expect(asMember.body.data.summary.total).toBe(6);

      const stranger = await createTestUser();
      expect((await api().get(`/api/workspaces/${f.ws.id}/analytics`).set('Cookie', stranger.cookie)).status).toBe(403);
    });
  });

  describe('deadline scan', () => {
    it('emits due_soon / overdue once per assigned task and flags the task', async () => {
      const f = await fixture();
      const soon = await createTask(f.owner, f.web.id, { title: 'Due in 5h', assigneeId: f.member.id, dueDate: new Date(Date.now() + 5 * HOUR).toISOString() });
      await createTask(f.owner, f.web.id, { title: 'Done but overdue', assigneeId: f.member.id, status: 'DONE', dueDate: daysAgo(3).toISOString() });

      const dueSoon: TaskDto[] = [];
      const overdue: TaskDto[] = [];
      const offs = [
        events.on('task.due_soon', ({ task }) => {
          dueSoon.push(task);
        }),
        events.on('task.overdue', ({ task }) => {
          overdue.push(task);
        }),
      ];

      const first = await runDeadlineScan();
      expect(first).toEqual({ dueSoon: 1, overdue: 1 });
      expect(dueSoon.map((t) => t.id)).toEqual([soon.id]);
      expect(overdue.map((t) => t.id)).toEqual([f.tasks.overdueUrgent.id]);
      expect(overdue[0]?.assignee?.id).toBe(f.member.id);

      const flagged = await Task.findById(f.tasks.overdueUrgent.id).lean();
      expect(flagged?.reminders?.overdueAt).toBeInstanceOf(Date);
      expect(flagged?.reminders?.dueSoonAt).toBeNull();
      const flaggedSoon = await Task.findById(soon.id).lean();
      expect(flaggedSoon?.reminders?.dueSoonAt).toBeInstanceOf(Date);

      const second = await runDeadlineScan();
      expect(second).toEqual({ dueSoon: 0, overdue: 0 });

      // Once the due-soon task slips past its date it is reported as overdue (a different flag).
      const later = new Date(Date.now() + 6 * HOUR);
      const third = await runDeadlineScan(later);
      expect(third).toEqual({ dueSoon: 0, overdue: 1 });
      expect(overdue.map((t) => t.id)).toEqual([f.tasks.overdueUrgent.id, soon.id]);

      offs.forEach((off) => off());
    });
  });
});

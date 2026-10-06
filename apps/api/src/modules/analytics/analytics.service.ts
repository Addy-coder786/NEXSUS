import { Types, type FilterQuery, type PipelineStage } from 'mongoose';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type ProjectAnalyticsDto,
  type ProjectProgressRow,
  type TaskPriority,
  type TaskStatus,
  type TaskSummaryStats,
  type VelocityPoint,
  type WorkloadRow,
  type WorkspaceAnalyticsDto,
  type WorkspaceRole,
} from '@nexus/shared';
import { cache } from '../../config/redis';
import { canSeeAllProjects } from '../../middleware/authorize';
import { Activity } from '../../models/Activity';
import { Project, type ProjectLean } from '../../models/Project';
import { Task, type ITask } from '../../models/Task';
import { loadUserMap } from '../workspaces/user.lookup';
import { assessHealth } from './health';

export const ANALYTICS_CACHE_TTL_SEC = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const cacheKeys = {
  project: (projectId: string, weeks: number) => `analytics:project:${projectId}:${weeks}`,
  workspace: (workspaceId: string, weeks: number, viewer: string) => `analytics:workspace:${workspaceId}:${weeks}:${viewer}`,
  projectPrefix: (projectId: string) => `analytics:project:${projectId}:`,
  workspacePrefix: (workspaceId: string) => `analytics:workspace:${workspaceId}:`,
};

// ---------- week helpers ----------

/** Monday 00:00 UTC of the week containing `d`. */
export function startOfWeekUTC(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

/** The Monday boundaries of the trailing `weeks` weeks, oldest first (last one is the current week). */
export function weekStarts(weeks: number, now: Date): Date[] {
  const current = startOfWeekUTC(now).getTime();
  const out: Date[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) out.push(new Date(current - i * WEEK_MS));
  return out;
}

// ---------- aggregation rows ----------

type CountRow = { n: number };
type KeyedCount = { _id: string; n: number };
type DateCount = { _id: Date; n: number };

interface SummaryFacet {
  total: CountRow[];
  byStatus: KeyedCount[];
  byPriority: KeyedCount[];
  overdue: CountRow[];
  unassigned: CountRow[];
  dueNext7Days: CountRow[];
  completedLast7Days: CountRow[];
  createdLast7Days: CountRow[];
  blocked: CountRow[];
}

interface TrendFacet {
  created: DateCount[];
  completed: DateCount[];
  cycle: { avgMs: number | null }[];
}

interface WorkloadAgg {
  _id: Types.ObjectId;
  open: number;
  inProgress: number;
  overdue: number;
  completedLast7Days: number;
}

interface ProjectAgg {
  _id: Types.ObjectId;
  total: number;
  done: number;
  overdue: number;
  open: number;
  unassignedOpen: number;
  completedLast7Days: number;
}

const first = (rows: CountRow[]): number => rows[0]?.n ?? 0;

const notDone = { $ne: ['$status', 'DONE'] };
const isDone = { $eq: ['$status', 'DONE'] };
const overdueExpr = (now: Date) => ({ $and: [notDone, { $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] });
const completedSinceExpr = (since: Date) => ({ $and: [isDone, { $ne: ['$completedAt', null] }, { $gte: ['$completedAt', since] }] });
const countIf = (expr: unknown) => ({ $sum: { $cond: [expr, 1, 0] } });

/** Tasks that are not DONE and depend on at least one task that is not DONE. */
function blockedStages(): PipelineStage.FacetPipelineStage[] {
  return [
    { $match: { status: { $ne: 'DONE' }, 'dependsOn.0': { $exists: true } } },
    { $lookup: { from: Task.collection.name, localField: 'dependsOn', foreignField: '_id', as: 'deps' } },
    { $match: { deps: { $elemMatch: { status: { $ne: 'DONE' } } } } },
  ];
}

async function summaryFor(match: FilterQuery<ITask>, now: Date): Promise<TaskSummaryStats> {
  const ago7 = new Date(now.getTime() - 7 * DAY_MS);
  const in7 = new Date(now.getTime() + 7 * DAY_MS);

  const [facet] = await Task.aggregate<SummaryFacet>([
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'n' }],
        byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        byPriority: [{ $group: { _id: '$priority', n: { $sum: 1 } } }],
        overdue: [{ $match: { status: { $ne: 'DONE' }, dueDate: { $ne: null, $lt: now } } }, { $count: 'n' }],
        unassigned: [{ $match: { status: { $ne: 'DONE' }, assigneeId: null } }, { $count: 'n' }],
        dueNext7Days: [{ $match: { status: { $ne: 'DONE' }, dueDate: { $gte: now, $lte: in7 } } }, { $count: 'n' }],
        completedLast7Days: [{ $match: { status: 'DONE', completedAt: { $gte: ago7 } } }, { $count: 'n' }],
        createdLast7Days: [{ $match: { createdAt: { $gte: ago7 } } }, { $count: 'n' }],
        blocked: [...blockedStages(), { $count: 'n' }],
      },
    },
  ]);

  const byStatus = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  for (const row of facet?.byStatus ?? []) if (row._id in byStatus) byStatus[row._id as TaskStatus] = row.n;
  const byPriority = Object.fromEntries(TASK_PRIORITIES.map((p) => [p, 0])) as Record<TaskPriority, number>;
  for (const row of facet?.byPriority ?? []) if (row._id in byPriority) byPriority[row._id as TaskPriority] = row.n;

  const total = first(facet?.total ?? []);
  return {
    total,
    byStatus,
    byPriority,
    overdue: first(facet?.overdue ?? []),
    unassigned: first(facet?.unassigned ?? []),
    blocked: first(facet?.blocked ?? []),
    dueNext7Days: first(facet?.dueNext7Days ?? []),
    completedLast7Days: first(facet?.completedLast7Days ?? []),
    createdLast7Days: first(facet?.createdLast7Days ?? []),
    progressPercent: total ? Math.round((byStatus.DONE / total) * 100) : 0,
  };
}

async function trendsFor(
  match: FilterQuery<ITask>,
  weeks: number,
  now: Date,
): Promise<{ velocity: VelocityPoint[]; avgCycleTimeDays: number | null }> {
  const starts = weekStarts(weeks, now);
  const windowStart = starts[0] ?? startOfWeekUTC(now);
  const truncate = (field: string) => ({ $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday' } });

  const [facet] = await Task.aggregate<TrendFacet>([
    { $match: match },
    {
      $facet: {
        created: [
          { $match: { createdAt: { $gte: windowStart } } },
          { $group: { _id: truncate('$createdAt'), n: { $sum: 1 } } },
        ],
        completed: [
          { $match: { status: 'DONE', completedAt: { $gte: windowStart } } },
          { $group: { _id: truncate('$completedAt'), n: { $sum: 1 } } },
        ],
        cycle: [
          { $match: { status: 'DONE', completedAt: { $gte: windowStart } } },
          { $group: { _id: null, avgMs: { $avg: { $subtract: ['$completedAt', '$createdAt'] } } } },
        ],
      },
    },
  ]);

  const byTime = (rows: DateCount[]) => new Map(rows.map((r) => [new Date(r._id).getTime(), r.n]));
  const created = byTime(facet?.created ?? []);
  const completed = byTime(facet?.completed ?? []);
  const velocity = starts.map((d) => ({
    weekStart: d.toISOString(),
    created: created.get(d.getTime()) ?? 0,
    completed: completed.get(d.getTime()) ?? 0,
  }));

  const avgMs = facet?.cycle[0]?.avgMs ?? null;
  const avgCycleTimeDays = avgMs === null ? null : Math.round((avgMs / DAY_MS) * 10) / 10;
  return { velocity, avgCycleTimeDays };
}

async function workloadFor(match: FilterQuery<ITask>, now: Date): Promise<WorkloadRow[]> {
  const ago7 = new Date(now.getTime() - 7 * DAY_MS);
  const rows = await Task.aggregate<WorkloadAgg>([
    { $match: { ...match, assigneeId: { $ne: null } } },
    {
      $group: {
        _id: '$assigneeId',
        open: countIf(notDone),
        inProgress: countIf({ $eq: ['$status', 'IN_PROGRESS'] }),
        overdue: countIf(overdueExpr(now)),
        completedLast7Days: countIf(completedSinceExpr(ago7)),
      },
    },
    { $sort: { open: -1, overdue: -1, _id: 1 } },
    { $limit: 100 },
  ]);
  const users = await loadUserMap(rows.map((r) => r._id));
  return rows.map((r) => ({
    user: users.get(r._id),
    open: r.open,
    inProgress: r.inProgress,
    overdue: r.overdue,
    completedLast7Days: r.completedLast7Days,
  }));
}

async function oldestOverdue(projectId: Types.ObjectId, now: Date) {
  const [row] = await Task.aggregate<{ key: string; title: string; priority: string }>([
    { $match: { projectId, status: { $ne: 'DONE' }, dueDate: { $ne: null, $lt: now } } },
    { $addFields: { _urgent: { $cond: [{ $eq: ['$priority', 'URGENT'] }, 1, 0] } } },
    { $sort: { _urgent: -1, dueDate: 1, _id: 1 } },
    { $limit: 1 },
    { $project: { _id: 0, key: 1, title: 1, priority: 1 } },
  ]);
  return row ?? null;
}

// ---------- project ----------

export async function computeProjectAnalytics(project: ProjectLean, weeks: number, now = new Date()): Promise<ProjectAnalyticsDto> {
  const match: FilterQuery<ITask> = { projectId: project._id };
  const [summary, trends, workload, overdueTask] = await Promise.all([
    summaryFor(match, now),
    trendsFor(match, weeks, now),
    workloadFor(match, now),
    oldestOverdue(project._id, now),
  ]);

  const health = assessHealth({
    overdue: summary.overdue,
    blocked: summary.blocked,
    open: summary.total - summary.byStatus.DONE,
    unassignedOpen: summary.unassigned,
    completedLast7Days: summary.completedLast7Days,
    progressPercent: summary.progressPercent,
    projectDueDate: project.dueDate,
    now,
    oldestOverdue: overdueTask,
  });

  return {
    projectId: String(project._id),
    summary,
    velocity: trends.velocity,
    workload,
    health,
    avgCycleTimeDays: trends.avgCycleTimeDays,
    generatedAt: now.toISOString(),
  };
}

export async function getProjectAnalytics(project: ProjectLean, weeks: number): Promise<ProjectAnalyticsDto> {
  const key = cacheKeys.project(String(project._id), weeks);
  const hit = await cache.get<ProjectAnalyticsDto>(key);
  if (hit) return hit;
  const dto = await computeProjectAnalytics(project, weeks);
  await cache.set(key, dto, ANALYTICS_CACHE_TTL_SEC);
  return dto;
}

// ---------- workspace ----------

async function projectRows(projects: ProjectLean[], match: FilterQuery<ITask>, now: Date): Promise<ProjectProgressRow[]> {
  if (projects.length === 0) return [];
  const ago7 = new Date(now.getTime() - 7 * DAY_MS);
  const [rows, blockedRows] = await Promise.all([
    Task.aggregate<ProjectAgg>([
      { $match: match },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          done: countIf(isDone),
          overdue: countIf(overdueExpr(now)),
          open: countIf(notDone),
          unassignedOpen: countIf({ $and: [notDone, { $eq: ['$assigneeId', null] }] }),
          completedLast7Days: countIf(completedSinceExpr(ago7)),
        },
      },
    ]),
    Task.aggregate<KeyedCount>([{ $match: match }, ...blockedStages(), { $group: { _id: '$projectId', n: { $sum: 1 } } }]),
  ]);
  const byProject = new Map(rows.map((r) => [String(r._id), r]));
  const blocked = new Map(blockedRows.map((r) => [String(r._id), r.n]));

  return projects.map((p) => {
    const id = String(p._id);
    const agg = byProject.get(id);
    const total = agg?.total ?? 0;
    const done = agg?.done ?? 0;
    const progressPercent = total ? Math.round((done / total) * 100) : 0;
    const health = assessHealth({
      overdue: agg?.overdue ?? 0,
      blocked: blocked.get(id) ?? 0,
      open: agg?.open ?? 0,
      unassignedOpen: agg?.unassignedOpen ?? 0,
      completedLast7Days: agg?.completedLast7Days ?? 0,
      progressPercent,
      projectDueDate: p.dueDate,
      now,
    });
    return {
      projectId: id,
      name: p.name,
      key: p.key,
      color: p.color,
      status: p.status,
      total,
      done,
      overdue: agg?.overdue ?? 0,
      progressPercent,
      health: health.status,
      dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    };
  });
}

export async function computeWorkspaceAnalytics(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  weeks: number,
  now = new Date(),
): Promise<WorkspaceAnalyticsDto> {
  const wsId = new Types.ObjectId(workspaceId);
  const projectFilter: FilterQuery<ProjectLean> = { workspaceId: wsId };
  if (!canSeeAllProjects(role)) projectFilter.memberIds = new Types.ObjectId(userId);
  const projects = await Project.find(projectFilter).sort({ createdAt: 1 }).lean();
  const projectIds = projects.map((p) => p._id);
  const match: FilterQuery<ITask> = { workspaceId: wsId, projectId: { $in: projectIds } };
  const ago7 = new Date(now.getTime() - 7 * DAY_MS);

  const [summary, trends, workload, rows, activeActors] = await Promise.all([
    summaryFor(match, now),
    trendsFor(match, weeks, now),
    workloadFor(match, now),
    projectRows(projects, match, now),
    Activity.distinct('actorId', { workspaceId: wsId, createdAt: { $gte: ago7 } }),
  ]);

  return {
    workspaceId,
    summary,
    velocity: trends.velocity,
    workload,
    projects: rows,
    activeMembers7Days: activeActors.length,
    generatedAt: now.toISOString(),
  };
}

export async function getWorkspaceAnalytics(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  weeks: number,
): Promise<WorkspaceAnalyticsDto> {
  const viewer = canSeeAllProjects(role) ? 'all' : userId;
  const key = cacheKeys.workspace(workspaceId, weeks, viewer);
  const hit = await cache.get<WorkspaceAnalyticsDto>(key);
  if (hit) return hit;
  const dto = await computeWorkspaceAnalytics(workspaceId, userId, role, weeks);
  await cache.set(key, dto, ANALYTICS_CACHE_TTL_SEC);
  return dto;
}

/** Drops cached analytics for a project and its workspace (called on task.* events). */
export async function invalidateAnalytics(workspaceId: string, projectId: string | null): Promise<void> {
  await Promise.all([
    cache.delByPrefix(cacheKeys.workspacePrefix(workspaceId)),
    projectId ? cache.delByPrefix(cacheKeys.projectPrefix(projectId)) : Promise.resolve(),
  ]);
}

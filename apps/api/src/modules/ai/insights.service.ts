import { Types } from 'mongoose';
import { z } from 'zod';
import type {
  DocumentSummaryResultDto,
  ProjectInsightDto,
  WorkspaceDigestDto,
  WorkspaceRole,
} from '@nexus/shared';
import { cache } from '../../config/redis';
import { canSeeAllProjects } from '../../middleware/authorize';
import { Activity } from '../../models/Activity';
import type { DocumentLean } from '../documents/document.service';
import { Project, type ProjectLean } from '../../models/Project';
import { Task } from '../../models/Task';
import { getProjectAnalytics, getWorkspaceAnalytics } from '../analytics/analytics.service';
import { retrieve } from '../rag/rag.service';
import { loadUserMap } from '../workspaces/user.lookup';
import { generateStructured, js, workspaceData } from './ai.client';

const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_TTL_SEC = 24 * 60 * 60;
const INSIGHT_TTL_SEC = 30 * 60;
const DIGEST_TTL_SEC = 60 * 60;
const DOCUMENT_CHAR_LIMIT = 150_000;

export const aiCacheKeys = {
  summary: (documentId: string, version: number, length: string) => `ai:summary:${documentId}:${version}:${length}`,
  insight: (projectId: string) => `ai:insight:${projectId}`,
  digest: (workspaceId: string, days: number, viewer: string) => `ai:digest:${workspaceId}:${days}:${viewer}`,
};

/** Called on task.* events: the next insight request rebuilds from fresh data. */
export async function invalidateProjectInsight(projectId: string): Promise<void> {
  await cache.del(aiCacheKeys.insight(projectId));
}

const clip = (max: number) => z.string().transform((v) => v.slice(0, max));

// ---------- document summary ----------

const summarySchema = js.obj({
  summary: js.str('The summary, in plain prose'),
  keyPoints: js.arr(js.str()),
  actionItems: js.arr(js.str(), 'Concrete follow-ups the document asks for; empty when there are none'),
});
const summaryValidator = z.object({
  summary: clip(4000),
  keyPoints: z.array(clip(500)).transform((v) => v.slice(0, 12)),
  actionItems: z.array(clip(500)).transform((v) => v.slice(0, 12)),
});

export async function summarizeDocument(
  doc: DocumentLean,
  userId: string,
  length: 'short' | 'detailed',
): Promise<DocumentSummaryResultDto> {
  const documentId = String(doc._id);
  const key = aiCacheKeys.summary(documentId, doc.version, length);
  const hit = await cache.get<DocumentSummaryResultDto>(key);
  if (hit) return hit;

  const guidance =
    length === 'short'
      ? 'Write a 2-3 sentence summary and at most 5 key points.'
      : 'Write a thorough summary of 2-4 paragraphs and up to 10 key points.';
  const result = await generateStructured({
    ctx: { workspaceId: String(doc.workspaceId), userId, feature: 'document_summary' },
    system: 'You summarise team documents accurately and neutrally. Use only what the document says.',
    prompt: `${guidance}\n\n${workspaceData(`document "${doc.title}"`, `${doc.title}\n\n${doc.contentText.slice(0, DOCUMENT_CHAR_LIMIT)}`)}`,
    schema: summarySchema,
    validator: summaryValidator,
    effort: 'low',
  });

  const dto: DocumentSummaryResultDto = { documentId, version: doc.version, ...result, generatedAt: new Date().toISOString() };
  await cache.set(key, dto, SUMMARY_TTL_SEC);
  return dto;
}

// ---------- project insights ----------

const insightSchema = js.obj({
  narrative: js.str('One plain-language paragraph on where the project stands'),
  blockers: js.arr(js.obj({ taskId: js.nullableStr('Id of the blocking task from the data, or null'), text: js.str() })),
  risks: js.arr(js.str()),
  recommendations: js.arr(js.str()),
  recentHighlights: js.arr(js.str(), 'What happened this week'),
});
const insightValidator = z.object({
  narrative: clip(2000),
  blockers: z.array(z.object({ taskId: z.string().nullable(), text: clip(300) })).transform((v) => v.slice(0, 8)),
  risks: z.array(clip(300)).transform((v) => v.slice(0, 8)),
  recommendations: z.array(clip(300)).transform((v) => v.slice(0, 8)),
  recentHighlights: z.array(clip(300)).transform((v) => v.slice(0, 8)),
});

/**
 * Narrative insights over deterministic analytics. Health status and score always come from the
 * analytics health assessment, never from the model. Cached 30 minutes per project.
 */
export async function projectInsights(
  project: ProjectLean,
  userId: string,
  role: WorkspaceRole,
  refresh: boolean,
): Promise<ProjectInsightDto> {
  const projectId = String(project._id);
  const key = aiCacheKeys.insight(projectId);
  if (!refresh) {
    const hit = await cache.get<ProjectInsightDto>(key);
    if (hit) return { ...hit, cached: true };
  }

  const now = Date.now();
  const [analytics, overdue, blocked, activity, context] = await Promise.all([
    getProjectAnalytics(project, 4),
    Task.find({ projectId: project._id, status: { $ne: 'DONE' }, dueDate: { $ne: null, $lt: new Date(now) } })
      .sort({ dueDate: 1 })
      .limit(15)
      .select('key title dueDate assigneeId priority')
      .lean(),
    Task.find({ projectId: project._id, status: { $ne: 'DONE' }, 'dependsOn.0': { $exists: true } })
      .limit(30)
      .select('key title dependsOn')
      .lean(),
    Activity.find({ projectId: project._id, createdAt: { $gte: new Date(now - 7 * DAY_MS) } })
      .sort({ createdAt: -1 })
      .limit(60)
      .lean(),
    retrieve({ workspaceId: String(project.workspaceId), userId, role, query: `${project.name} risks blockers decisions`, projectId, limit: 5 }).catch(() => []),
  ]);

  // Only dependencies that are still open actually block.
  const depIds = [...new Set(blocked.flatMap((t) => t.dependsOn.map(String)))];
  const openDeps = await Task.find({ _id: { $in: depIds }, status: { $ne: 'DONE' } }).select('key title').lean();
  const openDepIds = new Map(openDeps.map((d) => [String(d._id), d]));
  const blockedRows = blocked
    .map((t) => ({ id: String(t._id), key: t.key, title: t.title, waitingOn: t.dependsOn.flatMap((d) => openDepIds.get(String(d))?.key ?? []) }))
    .filter((t) => t.waitingOn.length);

  const users = await loadUserMap([...overdue.map((t) => t.assigneeId), ...activity.map((a) => a.actorId)]);
  const data = {
    project: { name: project.name, key: project.key, description: project.description, status: project.status, dueDate: project.dueDate },
    health: analytics.health,
    summary: analytics.summary,
    velocity: analytics.velocity,
    workload: analytics.workload.map((w) => ({ name: w.user.name, open: w.open, inProgress: w.inProgress, overdue: w.overdue })),
    overdueTasks: overdue.map((t) => ({ id: String(t._id), key: t.key, title: t.title, priority: t.priority, due: t.dueDate, assignee: users.getOrNull(t.assigneeId)?.name ?? null })),
    blockedTasks: blockedRows,
    activityLast7Days: activity.map((a) => ({ type: a.type, actor: users.get(a.actorId).name, target: a.target?.title ?? null, at: a.createdAt })),
    relatedContext: context.map((c) => ({ type: c.sourceType, title: c.title, text: c.text.slice(0, 600) })),
  };

  const result = await generateStructured({
    ctx: { workspaceId: String(project.workspaceId), userId, feature: 'project_insights' },
    system:
      'You are a pragmatic delivery lead. Explain project status to the team in plain language, grounded only in the provided data. ' +
      'Do not restate the health score; explain it. Blockers must reference real tasks from the data (use their ids). Keep each list item to one sentence.',
    prompt: workspaceData('project analytics', JSON.stringify(data)),
    schema: insightSchema,
    validator: insightValidator,
    effort: 'medium',
  });

  const knownTaskIds = new Set([...overdue.map((t) => String(t._id)), ...blockedRows.map((t) => t.id)]);
  const dto: ProjectInsightDto = {
    projectId,
    health: analytics.health.status,
    score: analytics.health.score,
    narrative: result.narrative,
    blockers: result.blockers.map((b) => ({ taskId: b.taskId && knownTaskIds.has(b.taskId) ? b.taskId : null, text: b.text })),
    risks: result.risks,
    recommendations: result.recommendations,
    recentHighlights: result.recentHighlights,
    generatedAt: new Date().toISOString(),
    cached: false,
  };
  await cache.set(key, dto, INSIGHT_TTL_SEC);
  return dto;
}

// ---------- workspace digest ----------

const digestSchema = js.obj({
  summary: js.str('A short paragraph on the period'),
  highlights: js.arr(js.str()),
  atRiskProjects: js.arr(js.obj({ projectId: js.str(), reason: js.str() })),
});
const digestValidator = z.object({
  summary: clip(2000),
  highlights: z.array(clip(300)).transform((v) => v.slice(0, 10)),
  atRiskProjects: z.array(z.object({ projectId: z.string(), reason: clip(300) })),
});

export async function workspaceDigest(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  days: number,
): Promise<WorkspaceDigestDto> {
  const viewer = canSeeAllProjects(role) ? 'all' : userId;
  const key = aiCacheKeys.digest(workspaceId, days, viewer);
  const hit = await cache.get<WorkspaceDigestDto>(key);
  if (hit) return hit;

  const ws = new Types.ObjectId(workspaceId);
  const analytics = await getWorkspaceAnalytics(workspaceId, userId, role, 4);
  const visibleIds = analytics.projects.map((p) => new Types.ObjectId(p.projectId));
  const [projects, activity] = await Promise.all([
    Project.find({ _id: { $in: visibleIds } }).select('name').lean(),
    Activity.find({
      workspaceId: ws,
      createdAt: { $gte: new Date(Date.now() - days * DAY_MS) },
      $or: [{ projectId: null }, { projectId: { $in: visibleIds } }],
    })
      .sort({ createdAt: -1 })
      .limit(150)
      .lean(),
  ]);
  const names = new Map(projects.map((p) => [String(p._id), p.name]));
  const users = await loadUserMap(activity.map((a) => a.actorId));

  const data = {
    periodDays: days,
    summary: analytics.summary,
    projects: analytics.projects.map((p) => ({ projectId: p.projectId, name: p.name, health: p.health, progress: p.progressPercent, overdue: p.overdue, due: p.dueDate })),
    activity: activity.map((a) => ({ type: a.type, actor: users.get(a.actorId).name, target: a.target?.title ?? null, project: a.projectId ? names.get(String(a.projectId)) : null })),
  };

  const result = await generateStructured({
    ctx: { workspaceId, userId, feature: 'workspace_digest' },
    system:
      'You write a concise weekly digest for a team workspace, grounded only in the provided data. ' +
      'atRiskProjects must use projectId values from the data and only include projects that are AT_RISK, OFF_TRACK or clearly slipping.',
    prompt: workspaceData('workspace activity', JSON.stringify(data)),
    schema: digestSchema,
    validator: digestValidator,
    effort: 'medium',
  });

  const dto: WorkspaceDigestDto = {
    workspaceId,
    periodDays: days,
    summary: result.summary,
    highlights: result.highlights,
    atRiskProjects: result.atRiskProjects.flatMap((p) => {
      const name = names.get(p.projectId);
      return name ? [{ projectId: p.projectId, name, reason: p.reason }] : [];
    }),
    generatedAt: new Date().toISOString(),
  };
  await cache.set(key, dto, DIGEST_TTL_SEC);
  return dto;
}

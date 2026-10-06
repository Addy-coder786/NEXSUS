import { Types } from 'mongoose';
import { logger } from '../../config/logger';
import { events } from '../../events';
import { defineJob, scheduleRepeating } from '../../jobs';
import { Project, type ProjectLean } from '../../models/Project';
import { Task } from '../../models/Task';
import { buildTaskDto } from '../tasks/task.service';
import { invalidateAnalytics } from './analytics.service';

const HOUR_MS = 60 * 60 * 1000;
const DUE_SOON_WINDOW_MS = 24 * HOUR_MS;

export interface DeadlineScanResult {
  dueSoon: number;
  overdue: number;
}

/**
 * Flags tasks that are due within 24 h or already overdue (not DONE, with an assignee) and emits
 * `task.due_soon` / `task.overdue` exactly once per task, recording the flag in `task.reminders`.
 */
export async function runDeadlineScan(now = new Date()): Promise<DeadlineScanResult> {
  const soon = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
  const candidates = await Task.find({
    status: { $ne: 'DONE' },
    assigneeId: { $ne: null },
    dueDate: { $ne: null },
    $or: [
      { dueDate: { $lt: now }, 'reminders.overdueAt': null },
      { dueDate: { $gte: now, $lte: soon }, 'reminders.dueSoonAt': null },
    ],
  })
    .sort({ dueDate: 1 })
    .lean();

  const result: DeadlineScanResult = { dueSoon: 0, overdue: 0 };
  if (candidates.length === 0) return result;

  const projectIds = [...new Set(candidates.map((t) => String(t.projectId)))].map((id) => new Types.ObjectId(id));
  const projects = new Map<string, ProjectLean>(
    (await Project.find({ _id: { $in: projectIds } }).lean()).map((p) => [String(p._id), p]),
  );

  for (const task of candidates) {
    const project = projects.get(String(task.projectId));
    if (!project || !task.dueDate) continue;
    const isOverdue = task.dueDate.getTime() < now.getTime();
    const flag = isOverdue ? 'reminders.overdueAt' : 'reminders.dueSoonAt';

    // Claim the flag first so concurrent scans never emit twice for the same task.
    const claimed = await Task.updateOne({ _id: task._id, [flag]: null }, { $set: { [flag]: now } }, { timestamps: false });
    if (claimed.modifiedCount === 0) continue;

    try {
      const dto = await buildTaskDto(task, project);
      if (isOverdue) {
        result.overdue += 1;
        events.emit('task.overdue', { task: dto });
      } else {
        result.dueSoon += 1;
        events.emit('task.due_soon', { task: dto });
      }
    } catch (err) {
      logger.error({ err, taskId: String(task._id) }, 'Failed to emit deadline reminder');
    }
  }
  return result;
}

defineJob('deadline.scan', async () => {
  const { dueSoon, overdue } = await runDeadlineScan();
  if (dueSoon || overdue) logger.info({ dueSoon, overdue }, 'Deadline scan emitted reminders');
});

void scheduleRepeating('deadline.scan', {}, HOUR_MS);

// ---------- analytics cache invalidation on task changes ----------

events.on('task.created', ({ task }) => invalidateAnalytics(task.workspaceId, task.projectId));
events.on('task.updated', ({ task }) => invalidateAnalytics(task.workspaceId, task.projectId));
events.on('task.moved', ({ task }) => invalidateAnalytics(task.workspaceId, task.projectId));
events.on('task.deleted', ({ workspaceId, projectId }) => invalidateAnalytics(workspaceId, projectId));

import type { HealthAssessment, ProjectHealth } from '@nexus/shared';

export interface HealthInput {
  /** Open (not DONE) tasks whose due date has passed. */
  overdue: number;
  /** Open tasks with at least one unfinished dependency. */
  blocked: number;
  /** All not-DONE tasks. */
  open: number;
  /** Open tasks without an assignee. */
  unassignedOpen: number;
  completedLast7Days: number;
  /** 0..100 */
  progressPercent: number;
  projectDueDate: Date | null;
  now?: Date;
  /** Most impactful overdue task (oldest URGENT, else oldest), for the recommendation. */
  oldestOverdue?: { key: string; title: string; priority: string } | null;
}

export const HEALTH_THRESHOLDS = { ON_TRACK: 75, AT_RISK: 45 } as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function healthStatus(score: number): ProjectHealth {
  if (score >= HEALTH_THRESHOLDS.ON_TRACK) return 'ON_TRACK';
  if (score >= HEALTH_THRESHOLDS.AT_RISK) return 'AT_RISK';
  return 'OFF_TRACK';
}

/**
 * Pure health score. Starts at 100 and deducts:
 *  -8 per overdue task (max -40), -5 per blocked task (max -20),
 *  -10 when more than 25% of open tasks are unassigned,
 *  -15 when the project due date passed with progress < 100,
 *  -10 when nothing was completed in the last 7 days while more than 5 tasks are open.
 */
export function assessHealth(input: HealthInput): HealthAssessment {
  const now = input.now ?? new Date();
  let score = 100;
  const reasons: string[] = [];
  const deductions: { points: number; recommendation: string }[] = [];

  if (input.overdue > 0) {
    const points = Math.min(40, input.overdue * 8);
    score -= points;
    reasons.push(`${plural(input.overdue, 'task')} ${input.overdue === 1 ? 'is' : 'are'} overdue.`);
    const target = input.oldestOverdue;
    deductions.push({
      points,
      recommendation: target
        ? `Resolve the oldest overdue ${target.priority === 'URGENT' ? 'urgent ' : ''}task ${target.key} "${target.title}" first.`
        : `Clear the ${plural(input.overdue, 'overdue task')} or move their due dates.`,
    });
  }

  if (input.blocked > 0) {
    const points = Math.min(20, input.blocked * 5);
    score -= points;
    reasons.push(`${plural(input.blocked, 'task')} ${input.blocked === 1 ? 'is' : 'are'} blocked by unfinished dependencies.`);
    deductions.push({ points, recommendation: `Finish the dependencies holding up ${plural(input.blocked, 'blocked task')}.` });
  }

  if (input.open > 0 && input.unassignedOpen / input.open > 0.25) {
    const pct = Math.round((input.unassignedOpen / input.open) * 100);
    score -= 10;
    reasons.push(`${pct}% of open tasks (${input.unassignedOpen}) have no assignee.`);
    deductions.push({ points: 10, recommendation: `Assign owners to the ${plural(input.unassignedOpen, 'unassigned task')}.` });
  }

  if (input.projectDueDate && input.projectDueDate.getTime() < now.getTime() && input.progressPercent < 100) {
    score -= 15;
    reasons.push(`The project due date has passed with ${input.progressPercent}% of tasks done.`);
    deductions.push({
      points: 15,
      recommendation: 'The project is past its due date: re-plan the deadline or close out the remaining work.',
    });
  }

  if (input.completedLast7Days === 0 && input.open > 5) {
    score -= 10;
    reasons.push(`No tasks were completed in the last 7 days while ${input.open} remain open.`);
    deductions.push({ points: 10, recommendation: 'Nothing shipped this week: pick the smallest open tasks and close them.' });
  }

  score = Math.max(0, Math.min(100, score));
  const top = deductions.sort((a, b) => b.points - a.points)[0];
  return { status: healthStatus(score), score, reasons, recommendation: top?.recommendation ?? null };
}

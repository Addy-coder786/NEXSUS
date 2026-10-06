import type { TaskDto, TaskStatus } from '@nexus/shared';

export const POSITION_GAP = 1024;

/**
 * Fractional position for a card placed between two neighbours.
 * - both neighbours: midpoint
 * - only a previous card: prev + GAP (append)
 * - only a next card: next - GAP (prepend)
 * - empty column: GAP
 */
export function computePosition(prev: number | undefined, next: number | undefined): number {
  if (prev !== undefined && next !== undefined) return (prev + next) / 2;
  if (prev !== undefined) return prev + POSITION_GAP;
  if (next !== undefined) return next - POSITION_GAP;
  return POSITION_GAP;
}

/**
 * Position for inserting at `index` into a column whose current (sorted) positions are given.
 * `index` is clamped to [0, positions.length].
 */
export function computeInsertPosition(positions: readonly number[], index: number): number {
  const i = Math.max(0, Math.min(index, positions.length));
  return computePosition(positions[i - 1], positions[i]);
}

export type TasksByStatus = Record<TaskStatus, TaskDto[]>;

/** Groups tasks by status, each column sorted by ascending position (ties by creation). */
export function groupTasksByStatus(tasks: readonly TaskDto[], statuses: readonly TaskStatus[]): TasksByStatus {
  const groups = Object.fromEntries(statuses.map((s) => [s, [] as TaskDto[]])) as TasksByStatus;
  for (const task of tasks) {
    const bucket = groups[task.status];
    if (bucket) bucket.push(task);
  }
  for (const status of statuses) {
    groups[status].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }
  return groups;
}

/**
 * Given a drag result, compute the new status and position.
 * `overTaskId` is the card the pointer was over (null when dropped on the column body).
 * `targetStatus` is the column the pointer was over.
 */
export function resolveDrop(args: {
  active: TaskDto;
  overTaskId: string | null;
  targetStatus: TaskStatus;
  columns: TasksByStatus;
}): { status: TaskStatus; position: number } | null {
  const { active, overTaskId, targetStatus, columns } = args;
  const target = columns[targetStatus].filter((t) => t.id !== active.id);
  const positions = target.map((t) => t.position);

  // Dropped onto itself: nothing to do.
  if (overTaskId === active.id) return null;

  if (!overTaskId) {
    // Dropped on the column itself: append to the end (no-op if already last in same column).
    if (targetStatus === active.status) {
      const current = columns[targetStatus];
      if (current[current.length - 1]?.id === active.id) return null;
    }
    return { status: targetStatus, position: computeInsertPosition(positions, positions.length) };
  }

  const overIndex = target.findIndex((t) => t.id === overTaskId);
  if (overIndex === -1) {
    return { status: targetStatus, position: computeInsertPosition(positions, positions.length) };
  }

  // Within the same column: moving down means we land *after* the hovered card.
  let insertIndex = overIndex;
  if (targetStatus === active.status) {
    const originalIndex = columns[targetStatus].findIndex((t) => t.id === active.id);
    const originalOverIndex = columns[targetStatus].findIndex((t) => t.id === overTaskId);
    if (originalIndex === originalOverIndex) return null;
    if (originalIndex < originalOverIndex) insertIndex = overIndex + 1;
  }
  return { status: targetStatus, position: computeInsertPosition(positions, insertIndex) };
}

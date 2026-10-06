import {
  format,
  formatDistanceToNowStrict,
  isBefore,
  isToday,
  isTomorrow,
  isYesterday,
  isThisYear,
  parseISO,
  startOfDay,
} from 'date-fns';

function toDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

/** "Oct 6" or "Oct 6, 2025" when not this year. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, isThisYear(d) ? 'MMM d' : 'MMM d, yyyy');
}

/** "Oct 6, 2025 at 14:05" */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, "MMM d, yyyy 'at' HH:mm");
}

/** "3 minutes ago", "2 days ago", "just now" */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (Math.abs(diff) < 45_000) return 'just now';
  return `${formatDistanceToNowStrict(d)} ago`;
}

/** Friendly due-date label: Today, Tomorrow, Yesterday or a short date. */
export function formatDueDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isYesterday(d)) return 'Yesterday';
  return formatDate(d);
}

/** A task is overdue when its due date is before today and it is not completed. */
export function isOverdue(
  dueDate: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!dueDate || completedAt) return false;
  const d = toDate(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  return isBefore(d, startOfDay(now));
}

/** Value for a native <input type="date"> from an ISO string. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const d = parseISO(value);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy-MM-dd');
}

/** ISO string (noon UTC, avoids timezone day-shift) from a date input value, or null when empty. */
export function fromDateInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

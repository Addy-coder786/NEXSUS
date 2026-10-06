import { describe, expect, it } from 'vitest';
import { formatDueDate, fromDateInputValue, isOverdue, toDateInputValue } from './format';

describe('isOverdue', () => {
  const now = new Date('2026-10-06T10:00:00.000Z');

  it('is true for a due date before today when not completed', () => {
    expect(isOverdue('2026-10-01T12:00:00.000Z', null, now)).toBe(true);
  });
  it('is false for today or future dates', () => {
    expect(isOverdue('2026-10-06T23:00:00.000Z', null, now)).toBe(false);
    expect(isOverdue('2026-10-09T12:00:00.000Z', null, now)).toBe(false);
  });
  it('is false once the task is completed, even if late', () => {
    expect(isOverdue('2026-10-01T12:00:00.000Z', '2026-10-03T12:00:00.000Z', now)).toBe(false);
  });
  it('is false without a due date or with garbage', () => {
    expect(isOverdue(null, null, now)).toBe(false);
    expect(isOverdue('not-a-date', null, now)).toBe(false);
  });
});

describe('date input helpers', () => {
  it('round-trips an ISO date through the native input value', () => {
    const iso = fromDateInputValue('2026-10-06');
    expect(iso).toBe('2026-10-06T12:00:00.000Z');
    expect(toDateInputValue(iso)).toBe('2026-10-06');
  });
  it('returns null / empty for empty input', () => {
    expect(fromDateInputValue('')).toBeNull();
    expect(toDateInputValue(null)).toBe('');
  });
});

describe('formatDueDate', () => {
  it('labels today and tomorrow', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    expect(formatDueDate(today.toISOString())).toBe('Today');
    expect(formatDueDate(tomorrow.toISOString())).toBe('Tomorrow');
  });
});

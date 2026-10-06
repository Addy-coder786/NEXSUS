import { describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '@nexus/shared';
import { POSITION_GAP, computeInsertPosition, computePosition, groupTasksByStatus, resolveDrop } from './position';
import { makeTask } from '@/test/utils';

describe('computePosition', () => {
  it('returns the midpoint between two neighbours', () => {
    expect(computePosition(1024, 2048)).toBe(1536);
    expect(computePosition(1, 2)).toBe(1.5);
  });
  it('appends after the last card', () => {
    expect(computePosition(3072, undefined)).toBe(3072 + POSITION_GAP);
  });
  it('prepends before the first card (can go negative)', () => {
    expect(computePosition(undefined, 500)).toBe(500 - POSITION_GAP);
  });
  it('defaults in an empty column', () => {
    expect(computePosition(undefined, undefined)).toBe(POSITION_GAP);
  });
});

describe('computeInsertPosition', () => {
  const positions = [1024, 2048, 3072];
  it('inserts at the start, middle and end', () => {
    expect(computeInsertPosition(positions, 0)).toBe(0);
    expect(computeInsertPosition(positions, 1)).toBe(1536);
    expect(computeInsertPosition(positions, 3)).toBe(4096);
  });
  it('clamps out-of-range indexes', () => {
    expect(computeInsertPosition(positions, -5)).toBe(0);
    expect(computeInsertPosition(positions, 99)).toBe(4096);
    expect(computeInsertPosition([], 7)).toBe(POSITION_GAP);
  });
});

describe('groupTasksByStatus', () => {
  it('creates every column and sorts by position', () => {
    const tasks = [
      makeTask({ status: 'TODO', position: 3000 }),
      makeTask({ status: 'TODO', position: 1000 }),
      makeTask({ status: 'DONE', position: 10 }),
    ];
    const groups = groupTasksByStatus(tasks, TASK_STATUSES);
    expect(Object.keys(groups)).toEqual([...TASK_STATUSES]);
    expect(groups.TODO.map((t) => t.position)).toEqual([1000, 3000]);
    expect(groups.DONE).toHaveLength(1);
    expect(groups.BACKLOG).toEqual([]);
  });
});

describe('resolveDrop', () => {
  const a = makeTask({ id: 'a', status: 'TODO', position: 1024 });
  const b = makeTask({ id: 'b', status: 'TODO', position: 2048 });
  const c = makeTask({ id: 'c', status: 'TODO', position: 3072 });
  const d = makeTask({ id: 'd', status: 'REVIEW', position: 1024 });
  const columns = groupTasksByStatus([a, b, c, d], TASK_STATUSES);

  it('drops onto an empty column with the default position', () => {
    expect(resolveDrop({ active: a, overTaskId: null, targetStatus: 'DONE', columns })).toEqual({
      status: 'DONE',
      position: POSITION_GAP,
    });
  });
  it('appends when dropped on a column body', () => {
    expect(resolveDrop({ active: a, overTaskId: null, targetStatus: 'REVIEW', columns })).toEqual({
      status: 'REVIEW',
      position: 2048,
    });
  });
  it('moving down within a column lands after the hovered card', () => {
    // a (1024) dragged over c (3072) -> after c
    expect(resolveDrop({ active: a, overTaskId: 'c', targetStatus: 'TODO', columns })).toEqual({
      status: 'TODO',
      position: 3072 + POSITION_GAP,
    });
  });
  it('moving up within a column lands before the hovered card', () => {
    // c dragged over a -> before a
    expect(resolveDrop({ active: c, overTaskId: 'a', targetStatus: 'TODO', columns })).toEqual({
      status: 'TODO',
      position: 1024 - POSITION_GAP,
    });
  });
  it('cross-column drop over a card inserts before that card', () => {
    // d from REVIEW dropped over b in TODO -> between a and b
    expect(resolveDrop({ active: d, overTaskId: 'b', targetStatus: 'TODO', columns })).toEqual({
      status: 'TODO',
      position: 1536,
    });
  });
  it('returns null for no-op drops', () => {
    expect(resolveDrop({ active: a, overTaskId: 'a', targetStatus: 'TODO', columns })).toBeNull();
    expect(resolveDrop({ active: c, overTaskId: null, targetStatus: 'TODO', columns })).toBeNull();
  });
});

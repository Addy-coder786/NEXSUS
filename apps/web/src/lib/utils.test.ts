import { describe, expect, it } from 'vitest';
import { cn, humanize, initials, truncate } from './utils';

describe('cn', () => {
  it('merges conditional classes and resolves tailwind conflicts', () => {
    const hidden = Boolean(process.env.NEVER_SET);
    expect(cn('p-2', hidden && 'hidden', 'p-4', { 'text-sm': true })).toBe('p-4 text-sm');
  });
});

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('  priya   sharma  patel ')).toBe('PP');
  });
  it('handles single names and empty strings', () => {
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('?');
  });
});

describe('humanize', () => {
  it('turns UPPER_SNAKE into a sentence-case label', () => {
    expect(humanize('IN_PROGRESS')).toBe('In progress');
    expect(humanize('DONE')).toBe('Done');
  });
});

describe('truncate', () => {
  it('shortens long strings only', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('a very long sentence', 8)).toBe('a very ...');
  });
});

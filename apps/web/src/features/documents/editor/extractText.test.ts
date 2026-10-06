import { describe, expect, it } from 'vitest';
import type { RichContent } from '@nexus/shared';
import { excerptOf, extractText } from './extractText';

const doc: RichContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Launch plan' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Ship ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'v2' },
        { type: 'text', text: ' by Friday.' },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write release notes' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'QA pass' }] },
            {
              type: 'taskList',
              content: [
                {
                  type: 'taskItem',
                  attrs: { checked: false },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mobile' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Status' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Priya' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }] },
          ],
        },
      ],
    },
  ],
};

describe('extractText', () => {
  it('flattens nested Tiptap JSON including task lists and tables', () => {
    const text = extractText(doc);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Launch plan');
    expect(lines[1]).toBe('Ship v2 by Friday.');
    expect(text).toContain('Write release notes');
    expect(text).toContain('QA pass');
    expect(text).toContain('Mobile');
    // Cells in a row are separated by a space, rows by newlines.
    expect(text).toContain('Owner Status');
    expect(text).toContain('Priya Done');
    expect(text.indexOf('Owner Status')).toBeLessThan(text.indexOf('Priya Done'));
  });

  it('returns an empty string for empty or malformed input', () => {
    expect(extractText({ type: 'doc', content: [] })).toBe('');
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });

  it('builds an excerpt on a word boundary', () => {
    const long: RichContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'word '.repeat(60).trim() }] }],
    };
    const excerpt = excerptOf(long, 50);
    expect(excerpt.length).toBeLessThanOrEqual(51);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).not.toMatch(/wor…$/);
    expect(excerptOf(doc, 1000)).toBe(extractText(doc).replace(/\s+/g, ' '));
  });
});

import { describe, expect, it } from 'vitest';
import { highlightSegments } from './highlight';

describe('highlightSegments', () => {
  it('flags case-insensitive matches for every query word and escapes regex characters', () => {
    expect(highlightSegments('Ship the Kanban board', 'kanban SHIP')).toEqual([
      { text: 'Ship', match: true },
      { text: ' the ', match: false },
      { text: 'Kanban', match: true },
      { text: ' board', match: false },
    ]);
    expect(highlightSegments('cost (usd)', '(usd)')).toEqual([
      { text: 'cost ', match: false },
      { text: '(usd)', match: true },
    ]);
    expect(highlightSegments('nothing', '')).toEqual([{ text: 'nothing', match: false }]);
  });
});

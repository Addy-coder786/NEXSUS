import { createElement, Fragment, type ReactNode } from 'react';

export interface HighlightSegment {
  text: string;
  match: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits `text` into segments, flagging case-insensitive occurrences of any word in
 * `query`. Pure and framework-free so it is easy to test.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(escapeRegExp);
  if (!text || terms.length === 0) return [{ text, match: false }];
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  const out: HighlightSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx), match: false });
    out.push({ text: m[0], match: true });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false });
  return out;
}

/** Renders `text` with query matches wrapped in `<mark>`. */
export function highlight(text: string, query: string): ReactNode {
  const segments = highlightSegments(text, query);
  return createElement(
    Fragment,
    null,
    ...segments.map((s, i) =>
      s.match
        ? createElement('mark', { key: i, className: 'rounded-sm bg-warning/40 px-0 text-inherit' }, s.text)
        : createElement(Fragment, { key: i }, s.text),
    ),
  );
}

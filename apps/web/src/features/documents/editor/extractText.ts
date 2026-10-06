import type { RichContent } from '@nexus/shared';

interface JsonNode {
  type?: string;
  text?: string;
  content?: unknown[];
}

/** Nodes after which a newline is emitted so paragraphs/cells do not run together. */
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'tableRow',
  'horizontalRule',
]);

function isNode(value: unknown): value is JsonNode {
  return Boolean(value) && typeof value === 'object';
}

const CELL_TYPES = new Set(['tableCell', 'tableHeader']);

function walk(node: JsonNode, out: string[]): void {
  if (typeof node.text === 'string') out.push(node.text);
  if (node.type === 'hardBreak') out.push('\n');
  if (node.type && CELL_TYPES.has(node.type)) {
    // A cell's blocks collapse onto one line; cells in a row are space-separated.
    const inner: string[] = [];
    for (const child of node.content ?? []) if (isNode(child)) walk(child, inner);
    out.push(inner.join('').replace(/\s*\n\s*/g, ' ').trim());
    return;
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child, i) => {
      if (!isNode(child)) return;
      if (i > 0 && child.type && CELL_TYPES.has(child.type)) out.push(' ');
      walk(child, out);
    });
  }
  if (node.type && BLOCK_TYPES.has(node.type)) out.push('\n');
}

/**
 * Plain-text projection of a Tiptap/ProseMirror JSON document, used as `contentText`
 * for search. Block boundaries become newlines, inline text is concatenated as-is,
 * whitespace is collapsed and the result is trimmed.
 */
export function extractText(json: RichContent | JsonNode | null | undefined): string {
  if (!json || typeof json !== 'object') return '';
  const out: string[] = [];
  walk(json as JsonNode, out);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** First `max` characters of the plain text, on a word boundary when possible. */
export function excerptOf(json: RichContent | null | undefined, max = 160): string {
  const text = extractText(json).replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

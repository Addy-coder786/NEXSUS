import type { RichContent } from '@nexus/shared';

/** Tiptap/ProseMirror node shape (structural; the editor owns the real schema). */
interface RichNode {
  type?: string;
  text?: string;
  content?: unknown[];
}

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'listItem',
  'taskItem',
  'bulletList',
  'orderedList',
  'taskList',
  'tableRow',
  'tableCell',
  'tableHeader',
  'horizontalRule',
  'doc',
]);

function isNode(value: unknown): value is RichNode {
  return typeof value === 'object' && value !== null;
}

function walk(node: RichNode, out: string[]): void {
  if (typeof node.text === 'string') out.push(node.text);
  if (node.type === 'hardBreak') out.push('\n');
  if (Array.isArray(node.content)) {
    for (const child of node.content) if (isNode(child)) walk(child, out);
  }
  if (node.type && BLOCK_TYPES.has(node.type)) out.push('\n');
}

/**
 * Plain-text projection of a Tiptap JSON document: text nodes are concatenated, block nodes
 * are separated by newlines, and whitespace is collapsed. Used for search and excerpts when the
 * client does not send `contentText`.
 */
export function richContentToText(content: RichContent | null | undefined): string {
  if (!content || !isNode(content)) return '';
  const out: string[] = [];
  walk(content, out);
  return out
    .join('')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** First `length` characters of the plain text, on a single line. */
export function excerptFromText(text: string, length = 160): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length > length ? single.slice(0, length) : single;
}

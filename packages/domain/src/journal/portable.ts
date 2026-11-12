import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {gfm} from 'micromark-extension-gfm';
import type {JournalContent} from './index.ts';
import {markdownAttachments} from './markdown.ts';

/**
 * Markdown is the stored and portable format of Notes and the Journal (steps.md 40). These helpers
 * only read Markdown: they never rewrite a body, so what is imported is exactly what is saved and
 * what is exported again.
 */

/** What a card shows of an entry: plain-text preview, first own image, checklist progress. */
export interface JournalSummary {
  readonly excerpt: string;
  readonly cover: string | null;
  readonly tasks: { readonly done: number; readonly total: number };
  readonly words: number;
}

type Node = { type: string; value?: string; checked?: boolean | null; children?: Node[] };
const SKIP = new Set(['code', 'html', 'definition', 'image', 'imageReference', 'thematicBreak', 'yaml']);

export function journalSummary(body: string, version: 1 | 2 = 2, maxExcerpt = 220): JournalSummary {
  if (version === 1) {
    const text = body.replace(/\s+/g, ' ').trim();
    return { excerpt: clip(text, maxExcerpt), cover: null, tasks: { done: 0, total: 0 }, words: countWords(text) };
  }
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Node;
  const blocks: string[] = [];
  let done = 0, total = 0;
  const textOf = (node: Node): string => SKIP.has(node.type) ? '' : node.value ?? node.children?.map(textOf).join('') ?? '';
  function visit(node: Node) {
    if (node.type === 'listItem' && typeof node.checked === 'boolean') { total++; if (node.checked) done++; }
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') { const text = textOf(node).trim(); if (text) blocks.push(text); return; }
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  const text = blocks.join(' · ').replace(/\s+/g, ' ').trim();
  const cover = markdownAttachments(body, true)[0]?.url ?? null;
  return { excerpt: clip(text, maxExcerpt), cover, tasks: { done, total }, words: countWords(blocks.join(' ')) };
}

const clip = (text: string, max: number) => [...text].length <= max ? text : [...text].slice(0, max - 1).join('').replace(/\s+\S*$/, '') + '…';
const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Markdown files a person may import at once, and the size of one file. */
export const JOURNAL_IMPORT_LIMITS = Object.freeze({ files: 50, bytes: 200_000 });

const unescapeHeading = (value: string) => value.replace(/\\([\\`*_{}[\]<>()#+.!|~-])/g, '$1');

/** One scalar of the small front-matter subset the export writes (JSON values) or people type (bare words, [a, b] lists). */
function scalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  try { return JSON.parse(value); } catch { /* not JSON: a bare YAML scalar */ }
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (value === 'true' || value === 'false') return value === 'true';
  return value.replace(/^'(.*)'$/, '$1');
}

const DATE = /^[1-9]\d{3}-\d{2}-\d{2}$/;
const validDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
};
const fold = (value: string, max: number) => [...value.replace(/\s+/g, ' ').trim()].slice(0, max).join('');

/**
 * Reads one Markdown file into an entry: optional front matter (title, date, collection or notebook,
 * tags, pinned), then an optional leading `# Title`. The body stays byte-for-byte what follows; the
 * server still validates everything with `parseJournalContent`. Inverse of `journalMarkdown`.
 */
export function parseJournalMarkdown(source: string, fileName: string): JournalContent {
  let text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const meta: Record<string, unknown> = {};
  const front = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (front) {
    for (const line of (front[1] ?? '').split('\n')) {
      const match = /^([A-Za-z]+)\s*:(.*)$/.exec(line);
      if (match) meta[(match[1] ?? '').toLowerCase()] = scalar(match[2] ?? '');
    }
    text = text.slice(front[0].length);
  }
  text = text.replace(/^\n+/, '');
  let title = typeof meta.title === 'string' ? fold(meta.title, 160) : '';
  const heading = /^#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n|$)/.exec(text);
  if (heading) {
    const headingTitle = fold(unescapeHeading(heading[1] ?? ''), 160);
    if (title === '' || title === headingTitle) { title = headingTitle; text = text.slice(heading[0].length).replace(/^\n/, ''); }
  }
  if (title === '') title = fold(fileName.replace(/\.(md|markdown|txt)$/i, '').replace(/[-_]+/g, ' '), 160) || 'Imported note';
  const collectionValue = meta.collection ?? meta.notebook;
  const tags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? meta.tags.split(',') : [];
  return {
    kind: 'note', version: 2, title,
    date: validDate(meta.date),
    body: text,
    collection: typeof collectionValue === 'string' ? fold(collectionValue, 80) : '',
    tags: [...new Set(tags.filter((tag): tag is string => typeof tag === 'string').map(tag => fold(tag.replace(/^#/, ''), 32)).filter(Boolean))].slice(0, 10),
    pinned: meta.pinned === true,
  };
}

/** One entry as a portable Markdown file: front matter when there is metadata, then `# Title`, then the body unchanged. */
export function journalMarkdown(content: JournalContent): string {
  const escape = (value: string) => value.replace(/([\\`*_{}[\]<>()#+.!|~-])/g, '\\$1');
  const body = content.version === 1 ? escape(content.body) : content.body;
  const metadata = content.date || content.collection || content.tags?.length || content.pinned
    ? `---\ntitle: ${JSON.stringify(content.title)}\ndate: ${JSON.stringify(content.date)}\ncollection: ${JSON.stringify(content.collection ?? '')}\ntags: ${JSON.stringify(content.tags ?? [])}\npinned: ${JSON.stringify(content.pinned ?? false)}\n---\n\n`
    : '';
  return `${metadata}# ${escape(content.title)}\n\n${body}`;
}

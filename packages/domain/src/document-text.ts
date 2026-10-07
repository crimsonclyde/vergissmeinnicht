import { foldSearchText } from './document-search.ts';

/**
 * Recognised text of document files (steps.md 16.9). Text is **derived** from an original — embedded
 * PDF text where a page has it, OCR where it does not — and never alters the upload. It is produced
 * only on VMN's own server (HT9: Tesseract as WebAssembly; HT10: MuPDF), is searchable alongside
 * titles, notes and tags under the permissions of its Document, and is untrusted data: shown as plain
 * text, never interpreted. P5: it runs automatically in the background unless a Workspace admin
 * switched it off for the Workspace.
 */

/**
 * The processing state of one file. A file whose text is still to be made is `QUEUED`; `PROCESSING`
 * while a worker holds its lease; `DONE` with whatever text was found (possibly none); `FAILED` after
 * the last attempt; `NOT_APPLICABLE` when nothing can be read (a password-protected PDF, a HEIC
 * without a decoder, HT1).
 */
export const TEXT_STATES = ['QUEUED', 'PROCESSING', 'DONE', 'FAILED', 'NOT_APPLICABLE'] as const;
export type TextState = (typeof TEXT_STATES)[number];

/** How a file's text was obtained. */
export const TEXT_SOURCES = ['EMBEDDED', 'OCR', 'MIXED', 'NONE'] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/** Attempts before a file is `FAILED` (Retry starts again from zero). */
export const MAX_TEXT_ATTEMPTS = 3;
/** Pages of a PDF whose text is read; later pages are not searchable. Same bound as previews. */
export const MAX_TEXT_PAGES = 500;
/** Pages of one file that are recognised by OCR (embedded text costs almost nothing; OCR ~2 s per page, HT9). */
export const MAX_OCR_PAGES = 50;
/** Characters kept per file: bounds storage and the search scan; the rest is not searchable. */
export const MAX_TEXT_CHARS = 200_000;
/** A PDF page with fewer meaningful characters of embedded text than this is treated as a scan and read by OCR. */
export const EMBEDDED_TEXT_MIN_CHARS = 20;
/** Pages are separated by a form feed in the stored text; it never occurs in the text itself. */
export const PAGE_SEPARATOR = '\f';

/** Characters around a hit in a snippet. */
const SNIPPET_CONTEXT = 60;

/**
 * Text as it is stored: NFC, no control or invisible characters except line breaks, runs of spaces
 * collapsed, at most `limit` characters. Recognised text comes from hostile files; it is data.
 */
export function cleanRecognizedText(text: string, limit: number = MAX_TEXT_CHARS): string {
  const cleaned = text
    .normalize('NFC')
    // Controls (except \n), bidi overrides, zero-width and other invisible characters become spaces.
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, (character) => (character === '\n' ? '\n' : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [...cleaned].slice(0, limit).join('');
}

/** Whether a PDF page's embedded text is enough to skip OCR. */
export function hasUsableEmbeddedText(text: string): boolean {
  return text.replace(/[^\p{L}\p{N}]/gu, '').length >= EMBEDDED_TEXT_MIN_CHARS;
}

/** Joins cleaned page texts and cuts the whole at `MAX_TEXT_CHARS`. */
export function joinPageTexts(pages: readonly string[]): string {
  const joined = pages.join(PAGE_SEPARATOR);
  return [...joined].slice(0, MAX_TEXT_CHARS).join('');
}

/**
 * A person's correction of a file's text (16.13): one plain text for the whole file, at most as long
 * as recognised text may be. Cleaned like recognised text — it is just as untrusted — so it never
 * holds a page separator.
 */
export const MAX_CORRECTION_CHARS = MAX_TEXT_CHARS;
export const cleanCorrectedText = (text: string): string => cleanRecognizedText(text, MAX_CORRECTION_CHARS);

/** The folded form a search compares against (as titles and notes, HT7). */
export const recognizedSearchText = (text: string): string => foldSearchText(text);

export interface TextSnippet {
  /** Plain text around the hit, with `…` where it was cut. Never markup. */
  readonly text: string;
  /** 1-based page of the file the hit is on. */
  readonly page: number;
}

/**
 * The first place in `text` where one of `terms` (folded) occurs, as a short plain-text snippet. The
 * text is folded character by character so a position in the folded text maps back to the original
 * (folding can change lengths: `ß` → `ss`, `é` → `e`).
 */
export function findSnippet(text: string, terms: readonly string[]): TextSnippet | undefined {
  if (terms.length === 0) return undefined;
  const characters = [...text];
  let folded = '';
  const origin: number[] = [];
  characters.forEach((character, index) => {
    const part = foldSearchText(character);
    folded += part;
    for (let k = 0; k < part.length; k++) origin.push(index);
  });
  let best = -1;
  let bestLength = 0;
  for (const term of terms) {
    const at = folded.indexOf(term);
    if (at !== -1 && (best === -1 || at < best)) {
      best = at;
      bestLength = term.length;
    }
  }
  if (best === -1) return undefined;
  const start = origin[best] ?? 0;
  const end = origin[best + bestLength - 1] ?? start;
  const from = Math.max(0, start - SNIPPET_CONTEXT);
  const to = Math.min(characters.length, end + 1 + SNIPPET_CONTEXT);
  // The page is the number of separators before the hit; a snippet never spans two pages.
  const before = characters.slice(0, start);
  const page = before.filter((character) => character === PAGE_SEPARATOR).length + 1;
  const pageStart = before.lastIndexOf(PAGE_SEPARATOR) + 1;
  const nextSeparator = characters.indexOf(PAGE_SEPARATOR, end + 1);
  const pageEnd = nextSeparator === -1 ? characters.length : nextSeparator;
  const left = Math.max(from, pageStart);
  const right = Math.min(to, pageEnd);
  const body = characters.slice(left, right).join('').replace(/\s+/g, ' ').trim();
  return { text: `${left > pageStart ? '…' : ''}${body}${right < pageEnd ? '…' : ''}`, page };
}

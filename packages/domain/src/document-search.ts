import { parseDocumentTypeRef, parseDocumentYear, parseFolderId, type DocumentTypeRef, type FolderId } from './document.ts';
import { DomainValidationError } from './errors.ts';
import { normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';

/**
 * Finding Documents (steps.md 16.3): search over titles, notes and tags, filters, sorting and paging.
 *
 * **Matching (HT7).** Text is *folded* before it is compared: compatibility-decomposed, accents and
 * other marks removed, lower-cased, `ß` → `ss`. So "Müll", "MULL" and "mull" are one word, as are
 * "perché" and "perche". A search is split at spaces into terms, and a Document matches when **every**
 * term occurs **somewhere inside** its title, notes or tags — also in the middle of a word, so
 * "rechnung" finds "Stromrechnung". There is no ranking and no stemming.
 */
export const DOCUMENTS_PAGE_SIZE = 50;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_SEARCH_TERMS = 8;
export const MAX_FILTER_TAGS = 10;

export const DOCUMENT_SORTS = ['uploaded', 'documentDate', 'title', 'modified'] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** Newest first for the dates, A → Z for titles. */
export const defaultDirection = (sort: DocumentSort): SortDirection => (sort === 'title' ? 'asc' : 'desc');

/** Text as it is compared: without accents, case or compatibility variants. */
export function foldSearchText(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

/** What a Document is sorted by under "title", and compared by: the folded title. */
export const documentTitleKey = (title: string): string => foldSearchText(title);

/** The folded tags of a Document, as the tag filter compares them. */
export const documentTagKeys = (tags: readonly string[]): string[] => tags.map(foldSearchText);

/** Everything a search looks at, folded: title, tags and notes, one per line (a term never spans two of them). */
export function documentSearchText(content: { readonly title: string; readonly notes: string; readonly tags: readonly string[] }): string {
  return foldSearchText([content.title, ...content.tags, content.notes].join('\n'));
}

/** The folded terms of a search; empty when nothing was typed. Too long or too many terms are refused, not cut. */
export function parseSearchTerms(input: string): string[] {
  const text = input.normalize('NFC').trim();
  if ([...text].length > MAX_SEARCH_LENGTH) throw new DomainValidationError('q', 'search_too_long', 'The search text is too long');
  const terms = [...new Set(foldSearchText(text).split(/\s+/u).filter((term) => term !== ''))];
  if (terms.length > MAX_SEARCH_TERMS) throw new DomainValidationError('q', 'search_too_many_terms', 'Too many search words');
  return terms;
}

/** A term as a `LIKE … ESCAPE '\'` pattern that matches it anywhere: `%` and `_` in the term are literal. */
export const containsPattern = (term: string): string => `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** Where to look: everywhere, only outside any Folder, or in one Folder — with or without what is below it. */
export type DocumentPlace = { readonly kind: 'all' } | { readonly kind: 'top' } | { readonly kind: 'folder'; readonly id: FolderId; readonly withSubfolders: boolean };

export interface DocumentQuery {
  readonly terms: readonly string[];
  readonly place: DocumentPlace;
  readonly type: DocumentTypeRef | null;
  readonly year: number | null;
  /** Folded; a Document must carry all of them. */
  readonly tags: readonly string[];
  /** The uploader's name as recorded on the Document. */
  readonly uploader: string | null;
  readonly sort: DocumentSort;
  readonly direction: SortDirection;
}

export interface DocumentQueryInput {
  readonly q?: string | undefined;
  /** A Folder id, or `top` for Documents outside any Folder; absent = everywhere. */
  readonly folder?: string | undefined;
  readonly subfolders?: boolean | undefined;
  /** `builtin:<key>` or `custom:<id>`. */
  readonly type?: string | undefined;
  readonly year?: number | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly uploader?: string | undefined;
  readonly sort?: string | undefined;
  readonly direction?: string | undefined;
}

function parsePlace(folder: string | undefined, subfolders: boolean): DocumentPlace {
  if (folder === undefined) return { kind: 'all' };
  if (folder === 'top') return { kind: 'top' };
  return { kind: 'folder', id: parseFolderId(folder), withSubfolders: subfolders };
}

function parseTypeFilter(value: string | undefined): DocumentTypeRef | null {
  if (value === undefined) return null;
  if (value.startsWith('builtin:')) return parseDocumentTypeRef({ builtIn: value.slice('builtin:'.length) });
  if (value.startsWith('custom:')) return parseDocumentTypeRef({ customId: value.slice('custom:'.length) });
  throw new DomainValidationError('type', 'invalid_document_type', 'Unknown document type');
}

/** Validates everything a listing can be asked for. Sort and direction are names from a fixed list, never SQL. */
export function parseDocumentQuery(input: DocumentQueryInput): DocumentQuery {
  const sort = input.sort ?? 'uploaded';
  if (!(DOCUMENT_SORTS as readonly string[]).includes(sort)) throw new DomainValidationError('sort', 'invalid_document_sort', 'Unknown sort order');
  const direction = input.direction ?? defaultDirection(sort as DocumentSort);
  if (!(SORT_DIRECTIONS as readonly string[]).includes(direction)) throw new DomainValidationError('direction', 'invalid_document_sort', 'Unknown sort direction');
  const tags = [...new Set((input.tags ?? []).map((tag) => foldSearchText(tag.normalize('NFC').trim())).filter((tag) => tag !== ''))];
  if (tags.length > MAX_FILTER_TAGS) throw new DomainValidationError('tags', 'too_many_tags', 'Too many tags');
  return {
    terms: parseSearchTerms(input.q ?? ''),
    place: parsePlace(input.folder, input.subfolders === true),
    type: parseTypeFilter(input.type),
    year: input.year === undefined ? null : parseDocumentYear(input.year),
    tags,
    uploader: input.uploader === undefined ? null : normalizeSingleLineName(input.uploader, { field: 'uploader', codePrefix: 'uploader', label: 'Uploader', maxLength: 200 }),
    sort: sort as DocumentSort,
    direction: direction as SortDirection,
  };
}

/**
 * Where a page ended: the last Document's value under the sort in use, and its id as the tie-break.
 * The next page continues strictly after it, so Documents added or removed meanwhile neither repeat
 * nor hide one that was already there. `value` is milliseconds for `uploaded` and `modified`, the
 * calendar date or `null` ("no document date" — those come last) for `documentDate`, the folded title
 * for `title`.
 */
export interface DocumentCursor {
  readonly value: string | number | null;
  readonly id: string;
}

const CURSOR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A cursor as it came back from a client: only its shape is checked — it selects nothing by itself. */
export function parseDocumentCursor(input: unknown, sort: DocumentSort): DocumentCursor | undefined {
  if (!Array.isArray(input) || input.length !== 2) return undefined;
  const [value, id] = input as [unknown, unknown];
  if (typeof id !== 'string' || !UUID_V4.test(id)) return undefined;
  const valid =
    sort === 'uploaded' || sort === 'modified'
      ? typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      : sort === 'documentDate'
        ? value === null || (typeof value === 'string' && CURSOR_DATE.test(value))
        : typeof value === 'string' && value.length <= 4000;
  return valid ? { value: value as string | number | null, id } : undefined;
}

import { DomainValidationError } from '../errors.ts';
import { BIDI_CONTROLS, normalizeSingleLineName } from '../text.ts';

export interface JournalContent { readonly kind: 'note'; readonly version: 1 | 2; readonly title: string; readonly date: string | null; readonly body: string; readonly collection?: string; readonly tags?: readonly string[]; readonly pinned?: boolean }
export interface JournalEntry extends JournalContent { readonly id: string; readonly revision: number; readonly archived: boolean; readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: string; readonly updatedBy: string }
export type JournalScope = { readonly workspaceId: string } | { readonly ownerId: string };

/** Bundled entry types. Extensions must supply a bounded parser and a matching presentation renderer. */
export const JOURNAL_TYPES = Object.freeze({ note: { version: 2, maxBody: 50_000 } });
export function parseJournalContent(input: unknown): JournalContent {
  const bad = (): never => { throw new DomainValidationError('entry', 'invalid_journal_entry', 'The journal entry is not valid'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return bad();
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((key) => !['body', 'date', 'kind', 'title', 'version', 'collection', 'tags', 'pinned'].includes(key)) || v.kind !== 'note' || ![1, 2].includes(v.version as number)) return bad();
  if (typeof v.title !== 'string' || typeof v.body !== 'string' || (v.date !== null && (typeof v.date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v.date))) || (v.version === 1 && v.date === null)) return bad();
  if (v.date !== null) { const date = new Date(`${v.date as string}T12:00:00Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.date) return bad(); }
  if (v.collection !== undefined && (typeof v.collection !== 'string' || [...v.collection].length > 80)) return bad();
  if (v.pinned !== undefined && typeof v.pinned !== 'boolean') return bad();
  if (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.length > 10 || v.tags.some((tag) => typeof tag !== 'string' || tag.trim() === '' || [...tag].length > 32))) return bad();
  const label = (value: string) => normalizeSingleLineName(value, { field: 'entry', codePrefix: 'journal_label', label: 'Label', maxLength: 80 });
  if (v.body.length > JOURNAL_TYPES.note.maxBody || [...v.body].some((c) => { const n = c.codePointAt(0) ?? 0; return (n < 32 && ![9, 10, 13].includes(n)) || n === 127; }) || BIDI_CONTROLS.test(v.body)) return bad();
  return { kind: 'note', version: v.version as 1 | 2, title: normalizeSingleLineName(v.title, { field: 'title', codePrefix: 'journal_title', label: 'Title', maxLength: 160 }), date: v.date as string | null, body: v.body, ...(v.collection !== undefined ? { collection: v.collection === '' ? '' : label(v.collection as string) } : {}), ...(v.tags !== undefined ? { tags: [...new Set((v.tags as string[]).map(label))] } : {}), ...(v.pinned !== undefined ? { pinned: v.pinned as boolean } : {}) };
}

export const JOURNAL_NOTICE_VERSION = 1;
export interface JournalRevision { readonly revision: number; readonly content: JournalContent; readonly archived: boolean; readonly at: Date; readonly by: string }
export interface JournalDraft { readonly entryId: string | null; readonly expectedRevision: number; readonly content: JournalContent; readonly archived: boolean; readonly updatedAt: Date }

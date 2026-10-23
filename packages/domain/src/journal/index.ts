import { DomainValidationError } from '../errors.ts';
import { BIDI_CONTROLS, normalizeSingleLineName } from '../text.ts';

export interface JournalContent { readonly kind: 'note'; readonly version: 1; readonly title: string; readonly date: string; readonly body: string }
export interface JournalEntry extends JournalContent { readonly id: string; readonly revision: number; readonly archived: boolean; readonly createdAt: Date; readonly updatedAt: Date; readonly createdBy: string; readonly updatedBy: string }
export type JournalScope = { readonly workspaceId: string } | { readonly ownerId: string };

/** Bundled entry types. Extensions must supply a bounded parser and a matching presentation renderer. */
export const JOURNAL_TYPES = Object.freeze({ note: { version: 1, maxBody: 50_000 } });
export function parseJournalContent(input: unknown): JournalContent {
  const bad = (): never => { throw new DomainValidationError('entry', 'invalid_journal_entry', 'The journal entry is not valid'); };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return bad();
  const v = input as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'body,date,kind,title,version' || v.kind !== 'note' || v.version !== JOURNAL_TYPES.note.version) return bad();
  if (typeof v.title !== 'string' || typeof v.body !== 'string' || typeof v.date !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(v.date)) return bad();
  const date = new Date(`${v.date}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== v.date) return bad();
  if (v.body.length > JOURNAL_TYPES.note.maxBody || [...v.body].some((c) => { const n = c.codePointAt(0) ?? 0; return (n < 32 && ![9, 10, 13].includes(n)) || n === 127; }) || BIDI_CONTROLS.test(v.body)) return bad();
  return { kind: 'note', version: 1, title: normalizeSingleLineName(v.title, { field: 'title', codePrefix: 'journal_title', label: 'Title', maxLength: 160 }), date: v.date, body: v.body.normalize('NFC') };
}

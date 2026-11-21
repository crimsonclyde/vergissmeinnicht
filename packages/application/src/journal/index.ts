import { parseJournalContent, type JournalDraft, type JournalRevision, type JournalContent, type JournalEntry, type JournalScope, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import type { ToolDeps } from '../documents/tools.ts';
import { requireTool } from '../tools/require-tool.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export class JournalNotFoundError extends Error {}
export class JournalConflictError extends Error {}
export class JournalConsentError extends Error {}
/** Narrowing of a library page (steps.md 40). `collection: ''` means entries without a notebook. */
export interface JournalListOptions { readonly collection?: string; readonly tag?: string; readonly month?: string; readonly sort?: 'updated' | 'date' | 'title' }
/** Compact facts about every unarchived entry of a library: notebooks, tags and dated entries. */
export interface JournalOverviewRow { readonly id: string; readonly title: string; readonly date: string | null; readonly collection: string; readonly tags: readonly string[] }
export interface JournalOverview { readonly collections: readonly { name: string; count: number }[]; readonly tags: readonly { name: string; count: number }[]; readonly dated: readonly { id: string; title: string; date: string }[]; readonly total: number }
export interface JournalRepository {
  privacy(actor: User, acknowledge?: boolean): Promise<boolean>;
  history(scope: JournalScope, id: string, before: number): Promise<JournalRevision[]>;
  draft(scope: JournalScope, actor: User, input?: JournalDraft | null): Promise<JournalDraft | null>;
  list(scope: JournalScope, query: string, archived: boolean, offset: number, options?: JournalListOptions): Promise<{ entries: JournalEntry[]; more: boolean }>;
  overview(scope: JournalScope): Promise<JournalOverviewRow[]>;
  find(scope: JournalScope, id: string): Promise<JournalEntry | undefined>;
  /** `newId` (36.22): the id of a new entry chosen by the caller, so a retried create is recognisable. */
  save(scope: JournalScope, actor: User, entry: JournalContent, id: string | undefined, expectedRevision: number, archived: boolean, at: Date, newId?: string): Promise<JournalEntry | 'forbidden' | 'conflict' | 'missing'>;
}
export interface JournalDeps extends ToolDeps { readonly users: UserRepository; readonly journal: JournalRepository }
export async function authorizeJournal(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, write = false): Promise<JournalScope> {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  if (workspaceId !== undefined) {
    await requireTool(deps, current, workspaceId, 'JOURNAL', write ? 'journal.manage' : 'journal.view');
    return { workspaceId };
  }
  if (write && !await deps.journal.privacy(current)) throw new JournalConsentError();
  return { ownerId: actor.id };
}
export async function listJournal(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, query: string, archived: boolean, offset: number, options: JournalListOptions = {}) {
  const scope = await authorizeJournal(deps, actor, workspaceId);
  const result = await deps.journal.list(scope, query, archived, offset, options);
  await authorizeJournal(deps, actor, workspaceId);
  return result;
}
export async function getJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, id: string) {
  const result = await deps.journal.find(await authorizeJournal(deps, actor, workspaceId), id);
  await authorizeJournal(deps, actor, workspaceId);
  if (result === undefined) throw new JournalNotFoundError();
  return result;
}
export async function saveJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, content: unknown, id: string | undefined, expectedRevision: number, archived: boolean, newId?: string) {
  const scope = await authorizeJournal(deps, actor, workspaceId, true);
  const result = await deps.journal.save(scope, actor, parseJournalContent(content), id, expectedRevision, archived, deps.clock.now(), id === undefined ? newId : undefined);
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'missing') throw new JournalNotFoundError();
  if (result === 'conflict') throw new JournalConflictError();
  return result;
}
/**
 * Creates a new entry under an id the client chose (48.5: a Note written offline), at most once: when
 * an entry with that id already holds exactly this content, it is the same create sent again after a
 * lost answer and is answered with that entry; any other entry with that id is a conflict.
 */
export async function createJournalEntryOnce(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, content: unknown, archived: boolean, id: string): Promise<{ entry: JournalEntry; duplicate: boolean }> {
  // Only someone who may write gets an answer about an existing id.
  await authorizeJournal(deps, actor, workspaceId, true);
  const parsed = parseJournalContent(content);
  const existing = await getJournalEntry(deps, actor, workspaceId, id).catch((error: unknown) => { if (error instanceof JournalNotFoundError) return undefined; throw error; });
  if (existing !== undefined) {
    const same = existing.title === parsed.title && existing.body === parsed.body && existing.date === parsed.date && (existing.collection ?? '') === (parsed.collection ?? '')
      && JSON.stringify(existing.tags ?? []) === JSON.stringify(parsed.tags ?? []) && (existing.pinned ?? false) === (parsed.pinned ?? false) && existing.archived === archived;
    if (!same) throw new JournalConflictError();
    return { entry: existing, duplicate: true };
  }
  return { entry: await saveJournalEntry(deps, actor, workspaceId, parsed, undefined, 0, archived, id), duplicate: false };
}
/** Notebook and tag counts plus the dated entries (for the Journal's month strip and "On this day"). */
export async function journalOverview(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined): Promise<JournalOverview> {
  const rows = await deps.journal.overview(await authorizeJournal(deps, actor, workspaceId));
  await authorizeJournal(deps, actor, workspaceId);
  const count = (values: string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())].map(([name, n]) => ({ name, count: n })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    collections: count(rows.map(row => row.collection)),
    tags: count(rows.flatMap(row => [...row.tags])),
    dated: rows.filter((row): row is JournalOverviewRow & { date: string } => row.date !== null).map(({ id, title, date }) => ({ id, title, date })).sort((a, b) => b.date.localeCompare(a.date)),
    total: rows.length,
  };
}
/** Shared policy used by the transactional adapter as well as application authorization. */
export const journalMayWrite = (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, 'journal.manage');

export async function journalPrivacy(deps: JournalDeps, actor: User, acknowledge = false) {
 const current = await deps.users.findById(actor.id);
 if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
 return { acknowledged: await deps.journal.privacy(current, acknowledge), version: 1 };
}
export async function journalHistory(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, id: string, before: number) {
 await getJournalEntry(deps, actor, workspaceId, id);
 const revisions = await deps.journal.history(await authorizeJournal(deps, actor, workspaceId), id, before);
 await authorizeJournal(deps, actor, workspaceId);
 return { revisions };
}
export async function journalDraft(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, input?: JournalDraft | null) {
 const scope = await authorizeJournal(deps, actor, workspaceId, true);
 const draft = await deps.journal.draft(scope, actor, input === undefined || input === null ? input : {...input, content: parseJournalContent(input.content), updatedAt: deps.clock.now()});
 await authorizeJournal(deps, actor, workspaceId, true);
 return { draft };
}

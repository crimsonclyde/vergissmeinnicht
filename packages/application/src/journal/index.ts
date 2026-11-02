import { parseJournalContent, type JournalDraft, type JournalRevision, type JournalContent, type JournalEntry, type JournalScope, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { authorizeTool, type ToolDeps } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export class JournalNotFoundError extends Error {}
export class JournalConflictError extends Error {}
export class JournalConsentError extends Error {}
export interface JournalRepository {
  privacy(actor: User, acknowledge?: boolean): Promise<boolean>;
  history(scope: JournalScope, id: string, before: number): Promise<JournalRevision[]>;
  draft(scope: JournalScope, actor: User, input?: JournalDraft | null): Promise<JournalDraft | null>;
  list(scope: JournalScope, query: string, archived: boolean, offset: number): Promise<{ entries: JournalEntry[]; more: boolean }>;
  find(scope: JournalScope, id: string): Promise<JournalEntry | undefined>;
  save(scope: JournalScope, actor: User, entry: JournalContent, id: string | undefined, expectedRevision: number, archived: boolean, at: Date): Promise<JournalEntry | 'forbidden' | 'conflict' | 'missing'>;
}
export interface JournalDeps extends ToolDeps { readonly users: UserRepository; readonly journal: JournalRepository }
export async function authorizeJournal(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, write = false): Promise<JournalScope> {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  if (workspaceId !== undefined) {
    await authorizeTool(deps, current, workspaceId, 'JOURNAL', write ? 'journal.manage' : 'journal.view');
    return { workspaceId };
  }
  if (write && !await deps.journal.privacy(current)) throw new JournalConsentError();
  return { ownerId: actor.id };
}
export async function listJournal(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, query: string, archived: boolean, offset: number) {
  const scope = await authorizeJournal(deps, actor, workspaceId);
  const result = await deps.journal.list(scope, query, archived, offset);
  await authorizeJournal(deps, actor, workspaceId);
  return result;
}
export async function getJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, id: string) {
  const result = await deps.journal.find(await authorizeJournal(deps, actor, workspaceId), id);
  await authorizeJournal(deps, actor, workspaceId);
  if (result === undefined) throw new JournalNotFoundError();
  return result;
}
export async function saveJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, content: unknown, id: string | undefined, expectedRevision: number, archived: boolean) {
  const scope = await authorizeJournal(deps, actor, workspaceId, true);
  const result = await deps.journal.save(scope, actor, parseJournalContent(content), id, expectedRevision, archived, deps.clock.now());
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'missing') throw new JournalNotFoundError();
  if (result === 'conflict') throw new JournalConflictError();
  return result;
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

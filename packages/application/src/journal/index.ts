import { parseJournalContent, type JournalContent, type JournalEntry, type JournalScope, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { authorizeTool, type ToolDeps } from '../documents/tools.ts';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { UserRepository } from '../ports/user-repository.ts';

export class JournalNotFoundError extends Error {}
export class JournalConflictError extends Error {}
export interface JournalRepository {
  list(scope: JournalScope, query: string, archived: boolean, offset: number): Promise<{ entries: JournalEntry[]; more: boolean }>;
  find(scope: JournalScope, id: string): Promise<JournalEntry | undefined>;
  save(scope: JournalScope, actor: User, entry: JournalContent, id: string | undefined, expectedRevision: number, archived: boolean, at: Date): Promise<JournalEntry | 'forbidden' | 'conflict' | 'missing'>;
}
export interface JournalDeps extends ToolDeps { readonly users: UserRepository; readonly journal: JournalRepository }
async function enter(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, write = false): Promise<JournalScope> {
  const current = await deps.users.findById(actor.id);
  if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
  if (workspaceId !== undefined) {
    await authorizeTool(deps, current, workspaceId, 'JOURNAL', write ? 'journal.manage' : 'journal.view');
    return { workspaceId };
  }
  return { ownerId: actor.id };
}
export async function listJournal(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, query: string, archived: boolean, offset: number) {
  const scope = await enter(deps, actor, workspaceId);
  const result = await deps.journal.list(scope, query, archived, offset);
  await enter(deps, actor, workspaceId);
  return result;
}
export async function getJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, id: string) {
  const result = await deps.journal.find(await enter(deps, actor, workspaceId), id);
  await enter(deps, actor, workspaceId);
  if (result === undefined) throw new JournalNotFoundError();
  return result;
}
export async function saveJournalEntry(deps: JournalDeps, actor: User, workspaceId: WorkspaceId | undefined, content: unknown, id: string | undefined, expectedRevision: number, archived: boolean) {
  const scope = await enter(deps, actor, workspaceId, true);
  const result = await deps.journal.save(scope, actor, parseJournalContent(content), id, expectedRevision, archived, deps.clock.now());
  if (result === 'forbidden') throw new NotAuthorizedError();
  if (result === 'missing') throw new JournalNotFoundError();
  if (result === 'conflict') throw new JournalConflictError();
  return result;
}
/** Shared policy used by the transactional adapter as well as application authorization. */
export const journalMayWrite = (role: Parameters<typeof roleHasCapability>[0]) => roleHasCapability(role, 'journal.manage');

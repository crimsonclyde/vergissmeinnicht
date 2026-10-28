import { parseBringContent, type BringContent, type BringItem, type BringStatus, type User, type WorkspaceId } from '@vergissmeinnicht/domain';
import { authorizeTool, type ToolDeps } from './documents/tools.ts';
import { NotAuthorizedError } from './invitations/errors.ts';
import type { UserRepository } from './ports/user-repository.ts';
export class BringNotFoundError extends Error {}
export class BringConflictError extends Error {}
export interface BringQuery { status: BringStatus; filter: 'ALL' | 'MINE' | 'SHARED'; offset: number; today?: string | undefined }
export type BringChange = { kind: 'save'; content: BringContent } | { kind: 'status'; status: BringStatus } | { kind: 'delete' | 'restore' };
export interface BringRepository {
 list(workspaceId: WorkspaceId, userId: string, query: BringQuery): Promise<{ items: BringItem[]; total: number; places: string[] }>;
 find(workspaceId: WorkspaceId, id: string): Promise<BringItem | undefined>;
 change(workspaceId: WorkspaceId, actor: User, id: string | undefined, revision: number, change: BringChange, at: Date): Promise<BringItem | 'forbidden' | 'missing' | 'conflict'>;
}
export interface BringDeps extends ToolDeps { users: UserRepository; bring: BringRepository }
async function enter(deps: BringDeps, actor: User, workspaceId: WorkspaceId, write = false) {
 const current = await deps.users.findById(actor.id);
 if (current?.status !== 'ACTIVE') throw new NotAuthorizedError();
 await authorizeTool(deps, current, workspaceId, 'BRING', write ? 'transfer.manage' : 'transfer.view');
}
export async function listBring(deps: BringDeps, actor: User, workspaceId: WorkspaceId, query: BringQuery) {
 await enter(deps, actor, workspaceId);
 const result = await deps.bring.list(workspaceId, actor.id, query);
 await enter(deps, actor, workspaceId);
 return result;
}
export async function getBring(deps: BringDeps, actor: User, workspaceId: WorkspaceId, id: string) {
 await enter(deps, actor, workspaceId);
 const result = await deps.bring.find(workspaceId, id);
 await enter(deps, actor, workspaceId);
 if (result === undefined || result.deleted) throw new BringNotFoundError();
 return result;
}
export async function changeBring(deps: BringDeps, actor: User, workspaceId: WorkspaceId, id: string | undefined, revision: number, change: BringChange) {
 await enter(deps, actor, workspaceId, true);
 const result = await deps.bring.change(workspaceId, actor, id, revision, change.kind === 'save' ? { kind: 'save', content: parseBringContent(change.content) } : change, deps.clock.now());
 if (result === 'forbidden') throw new NotAuthorizedError();
 if (result === 'missing') throw new BringNotFoundError();
 if (result === 'conflict') throw new BringConflictError();
 return result;
}

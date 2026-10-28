import { awardProgress } from './progress-repository.ts';
import { randomUUID } from 'node:crypto';
import type { BringRepository } from '@vergissmeinnicht/application';
import { bringRelevant, DomainValidationError, type BringItem, type UserId } from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { and, desc, eq } from 'drizzle-orm';
import { actorAllowed, IMMEDIATE } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { bringItems, memberships, users } from './schema.ts';
import { recordSecurityEvent } from './security-events.ts';
export function createBringRepository({ db }: AppDatabase): BringRepository {
 const view = (row: typeof bringItems.$inferSelect): BringItem => ({
  id: row.id, title: row.title, from: row.from, to: row.to, dueDate: row.dueDate, assigneeId: row.assigneeId,
  assigneeName: row.assigneeId === null ? null : db.select({ name: users.name }).from(users).where(eq(users.id, row.assigneeId)).get()?.name ?? null,
  notes: row.notes, status: row.status, revision: row.revision, completedAt: row.completedAt, completedBy: row.completedBy,
  cancelledAt: row.cancelledAt, cancelledBy: row.cancelledBy, createdAt: row.createdAt, createdBy: row.createdBy,
  updatedAt: row.updatedAt, updatedBy: row.updatedBy, deleted: row.deleted,
 });
 return {
 async list(workspaceId, userId, query) {
  // Bounded per-Workspace collection (1,000 rows); filter before pagination and totals.
  const rows = db.select().from(bringItems).where(and(eq(bringItems.workspaceId, workspaceId), eq(bringItems.deleted, false), eq(bringItems.status, query.status))).orderBy(desc(bringItems.updatedAt), desc(bringItems.id)).all();
  const filtered = rows.filter(row => (query.filter === 'ALL' || (query.filter === 'MINE' ? row.assigneeId === userId : row.assigneeId === null)) && (query.today === undefined || bringRelevant(row, query.today, userId)));
  if (query.today !== undefined) filtered.sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.id.localeCompare(b.id));
  const places = query.today === undefined ? db.select({ from: bringItems.from, to: bringItems.to }).from(bringItems).where(and(eq(bringItems.workspaceId, workspaceId), eq(bringItems.deleted, false))).limit(1000).all() : [];
  return { items: filtered.slice(query.offset, query.offset + (query.today === undefined ? 30 : 3)).map(view), total: filtered.length, places: [...new Set(places.flatMap(row => [row.from, row.to]).filter(Boolean))].sort().slice(0, 100) };
 },
 async find(workspaceId, id) { const row = db.select().from(bringItems).where(and(eq(bringItems.workspaceId, workspaceId), eq(bringItems.id, id))).get(); return row === undefined ? undefined : view(row); },
 async change(workspaceId, actor, id, revision, change, at) {
  return db.transaction(tx => {
   if (!actorAllowed(tx, workspaceId, { kind: 'user', userId: actor.id, displayName: actor.displayName }, { tool: 'BRING', actorMay: role => roleHasCapability(role, 'transfer.manage') })) return 'forbidden';
   const name = tx.select().from(users).where(eq(users.id, actor.id)).get()?.name ?? actor.displayName;
   const previous = id === undefined ? undefined : tx.select().from(bringItems).where(and(eq(bringItems.workspaceId, workspaceId), eq(bringItems.id, id))).get();
   if (id !== undefined && previous === undefined) return 'missing';
   if (revision !== (previous?.revision ?? 0)) return 'conflict';
   if (previous?.deleted && change.kind !== 'restore') return 'missing';
   if (change.kind === 'restore' && !previous?.deleted) return 'conflict';
   const stamps = { updatedAt: at, updatedByUserId: actor.id, updatedBy: name, revision: revision + 1 };
   const nextId = id ?? randomUUID();
   if (change.kind === 'save') {
    if (previous !== undefined && previous.status !== 'OPEN') return 'conflict';
    if (change.content.assigneeId !== null) {
     const member = tx.select().from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, change.content.assigneeId as UserId), eq(users.status, 'ACTIVE'))).get();
     if (member === undefined) throw new DomainValidationError('assignee', 'invalid_assignee', 'Assignee must be an active member');
    }
    if (previous === undefined) {
     if (tx.select({ id: bringItems.id }).from(bringItems).where(eq(bringItems.workspaceId, workspaceId)).all().length >= 1000) throw new DomainValidationError('bring', 'bring_limit', 'Bring limit reached');
     tx.insert(bringItems).values({ ...change.content, ...stamps, id: nextId, workspaceId, status: 'OPEN', createdAt: at, createdByUserId: actor.id, createdBy: name }).run();
    } else tx.update(bringItems).set({ ...change.content, ...stamps }).where(eq(bringItems.id, nextId)).run();
   } else {
    if (previous === undefined) return 'missing';
    if (change.kind === 'status') {
     if (change.status === previous.status) return 'conflict';
     tx.update(bringItems).set({ ...stamps, status: change.status, completedAt: change.status === 'COMPLETED' ? at : null, completedByUserId: change.status === 'COMPLETED' ? actor.id : null, completedBy: change.status === 'COMPLETED' ? name : null, cancelledAt: change.status === 'CANCELLED' ? at : null, cancelledByUserId: change.status === 'CANCELLED' ? actor.id : null, cancelledBy: change.status === 'CANCELLED' ? name : null }).where(eq(bringItems.id, nextId)).run();
    } else tx.update(bringItems).set({ ...stamps, deleted: change.kind === 'delete' }).where(eq(bringItems.id, nextId)).run();
   }
   const row = tx.select().from(bringItems).where(eq(bringItems.id, nextId)).get();
   if (row === undefined) throw new Error('Bring write lost row');
   if (previous === undefined) awardProgress(tx, actor.id, { workspaceId }, nextId, 'BRING_CREATED', at);
   if (change.kind === 'status' && change.status === 'COMPLETED') awardProgress(tx, actor.id, { workspaceId }, nextId, 'BRING_COMPLETED', at);
   recordSecurityEvent(tx, { type: 'BRING_CHANGED', actor: { kind: 'user', userId: actor.id, displayName: name }, subjectType: 'workspace', subjectId: workspaceId, occurredAt: at, metadata: { itemId: nextId, title: row.title, action: change.kind, status: row.status, revision: row.revision } });
   return view(row);
  }, IMMEDIATE);
 },
 };
}

import { awardProgress } from '../progress-repository.ts';
import { randomUUID } from 'node:crypto';
import { journalMayWrite, type JournalRepository } from '@vergissmeinnicht/application';
import { DomainValidationError, type JournalEntry, type JournalScope, type WorkspaceId } from '@vergissmeinnicht/domain';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed } from '../actor-guard.ts';
import type { AppDatabase } from '../connection.ts';
import { journalEntries, privateJournalEntries, users } from '../schema.ts';
import { recordSecurityEvent } from '../security-events.ts';

const target = (scope: JournalScope) => 'workspaceId' in scope
  ? { table: journalEntries, filter: eq(journalEntries.workspaceId, scope.workspaceId) }
  : { table: privateJournalEntries, filter: eq(privateJournalEntries.ownerId, scope.ownerId) };
const view = (row: Omit<typeof journalEntries.$inferSelect, 'workspaceId'>): JournalEntry => ({ id: row.id, kind: row.kind, version: 1, title: row.title, date: row.date, body: row.body, revision: row.revision, archived: row.archived, createdAt: row.createdAt, updatedAt: row.updatedAt, createdBy: row.createdBy, updatedBy: row.updatedBy });
export function createJournalRepository({ db }: AppDatabase): JournalRepository {
  return {
    async list(scope, query, archived, offset) {
      const { table, filter } = target(scope);
      const rows = db.select().from(table).where(and(filter, eq(table.archived, archived), sql`instr(lower(${table.title} || char(10) || ${table.body}), lower(${query})) > 0`)).orderBy(desc(table.date), desc(table.id)).limit(31).offset(offset).all();
      return { entries: rows.slice(0, 30).map(view), more: rows.length > 30 };
    },
    async find(scope, id) {
      const { table, filter } = target(scope);
      const row = db.select().from(table).where(and(filter, eq(table.id, id))).get();
      return row === undefined ? undefined : view(row);
    },
    async save(scope, actor, entry, id, expectedRevision, archived, at) {
      return db.transaction((tx) => {
        const current = tx.select().from(users).where(eq(users.id, actor.id)).get();
        if (current?.status !== 'ACTIVE') return 'forbidden';
        if ('workspaceId' in scope) {
          if (!actorAllowed(tx, scope.workspaceId as WorkspaceId, { kind: 'user', userId: actor.id, displayName: current.name }, { tool: 'JOURNAL', actorMay: journalMayWrite })) return 'forbidden';
        } else if (scope.ownerId !== actor.id) return 'forbidden';
        const { table, filter } = target(scope);
        const previous = id === undefined ? undefined : tx.select().from(table).where(and(filter, eq(table.id, id))).get();
        if (id !== undefined && previous === undefined) return 'missing';
        if (expectedRevision !== (previous?.revision ?? 0)) return 'conflict';
        const nextId = id ?? randomUUID();
        if (previous === undefined) {
          const n = tx.select({ n: count() }).from(table).where(filter).get()?.n ?? 0;
          if (n >= 1000) throw new DomainValidationError('entry', 'journal_limit', 'This journal has reached its entry limit');
          const values = { ...entry, id: nextId, revision: 1, archived, createdByUserId: actor.id, createdBy: current.name, updatedByUserId: actor.id, updatedBy: current.name, createdAt: at, updatedAt: at };
          if ('workspaceId' in scope) tx.insert(journalEntries).values({ ...values, workspaceId: scope.workspaceId }).run();
          else tx.insert(privateJournalEntries).values({ ...values, ownerId: scope.ownerId }).run();
        } else {
          tx.update(table).set({ title: entry.title, date: entry.date, body: entry.body, revision: previous.revision + 1, archived, updatedByUserId: actor.id, updatedBy: current.name, updatedAt: at }).where(and(filter, eq(table.id, nextId), eq(table.revision, expectedRevision))).run();
        }
        if (previous === undefined) awardProgress(tx, actor.id, nextId, 'JOURNAL_CREATED', at);
        recordSecurityEvent(tx, { type: 'JOURNAL_ENTRY_CHANGED', actor: { kind: 'user', userId: actor.id, displayName: current.name }, subjectType: 'workspaceId' in scope ? 'workspace' : 'user', subjectId: 'workspaceId' in scope ? scope.workspaceId : scope.ownerId, occurredAt: at, metadata: { scope: 'workspaceId' in scope ? 'workspace' : 'private', revision: (previous?.revision ?? 0) + 1, archived } });
        const result = tx.select().from(table).where(and(filter, eq(table.id, nextId))).get();
        if (result === undefined) throw new Error('Journal save lost its row');
        return view(result);
      }, IMMEDIATE);
    },
  };
}

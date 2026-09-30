import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, or, sql, type SQL } from 'drizzle-orm';
import { InvalidCursorError, toPage, type AuditHistory, type HistoryPageRequest } from '@vergissmeinnicht/application';
import type { AuditEvent, AuditEventType, WorkspaceId } from '@vergissmeinnicht/domain';
import type { Transaction, UserActor } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { auditEvents, procedures, runs } from './schema.ts';

export interface AuditEventRecord {
  readonly workspaceId: WorkspaceId;
  readonly type: AuditEventType;
  readonly actor: UserActor;
  readonly subjectType: 'procedure' | 'run' | 'run_step' | 'knot' | 'schedule' | 'occurrence';
  /** Required for Run events. */
  readonly runId?: string;
  readonly subjectId: string;
  readonly occurredAt: Date;
  /** Never put secrets here. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | string[]>>;
  /** Offline Step changes (8.5): the client-chosen id, unique per actor. */
  readonly clientChangeId?: string | undefined;
}

/** Must be called inside the transaction that performs the change it records. */
export function recordAuditEvent(tx: Transaction, event: AuditEventRecord): void {
  tx.insert(auditEvents)
    .values({
      id: randomUUID(),
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      type: event.type,
      actorUserId: event.actor.userId,
      actorDisplayName: event.actor.displayName,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      runId: event.runId ?? null,
      metadata: event.metadata ? { ...event.metadata } : null,
      clientChangeId: event.clientChangeId ?? null,
    })
    .run();
}

function toAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    type: row.type as AuditEventType,
    occurredAt: row.occurredAt,
    actor: { userId: row.actorUserId, displayName: row.actorDisplayName },
    subjectType: row.subjectType as AuditEvent['subjectType'],
    subjectId: row.subjectId,
    runId: row.runId,
    metadata: row.metadata ?? {},
  };
}

/**
 * Oldest-first page of the events matching `scope`. The cursor is resolved within the same scope, so
 * an event id of another Run, Procedure or Workspace is rejected rather than used as a position.
 */
function historyPage(tx: Pick<Transaction, 'select'>, scope: SQL | undefined, page: HistoryPageRequest) {
  let after: SQL | undefined;
  if (page.after !== undefined) {
    const cursor = tx
      .select({ at: auditEvents.occurredAt, rowid: sql<number>`rowid` })
      .from(auditEvents)
      .where(and(scope, eq(auditEvents.id, page.after)))
      .get();
    if (cursor === undefined) throw new InvalidCursorError();
    after = or(gt(auditEvents.occurredAt, cursor.at), and(eq(auditEvents.occurredAt, cursor.at), gt(sql`rowid`, cursor.rowid)));
  }
  const rows = tx
    .select()
    .from(auditEvents)
    .where(and(scope, after))
    .orderBy(asc(auditEvents.occurredAt), asc(sql`rowid`))
    .limit(page.limit + 1)
    .all()
    .map(toAuditEvent);
  return toPage(rows, page.limit, (event) => event.id);
}

/** Read side of `audit_events`; always filtered by Workspace. Insertion order breaks timestamp ties. */
export function createAuditHistory({ db }: Pick<AppDatabase, 'db'>): AuditHistory {
  return {
    async forRun(workspaceId, runId, page) {
      return db.transaction((tx) => {
        const run = tx.select({ id: runs.id }).from(runs).where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId))).get();
        if (run === undefined) return undefined;
        return historyPage(tx, and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.runId, run.id)), page);
      });
    },

    async forProcedure(workspaceId, procedureId, page) {
      return db.transaction((tx) => {
        // Soft-deleted Procedures keep their row, so their history stays readable.
        const procedure = tx
          .select({ id: procedures.id })
          .from(procedures)
          .where(and(eq(procedures.workspaceId, workspaceId), eq(procedures.id, procedureId)))
          .get();
        if (procedure === undefined) return undefined;
        return historyPage(
          tx,
          and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.subjectType, 'procedure'), eq(auditEvents.subjectId, procedure.id)),
          page,
        );
      });
    },
  };
}

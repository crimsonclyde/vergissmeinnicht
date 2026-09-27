import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { AuditHistory } from '@vergissmeinnicht/application';
import type { AuditEvent, AuditEventType, WorkspaceId } from '@vergissmeinnicht/domain';
import type { Transaction, UserActor } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { auditEvents, runs } from './schema.ts';

export interface AuditEventRecord {
  readonly workspaceId: WorkspaceId;
  readonly type: AuditEventType;
  readonly actor: UserActor;
  readonly subjectType: 'procedure' | 'run' | 'run_step';
  /** Required for Run events. */
  readonly runId?: string;
  readonly subjectId: string;
  readonly occurredAt: Date;
  /** Never put secrets here. */
  readonly metadata?: Readonly<Record<string, string | number | boolean | string[]>>;
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

/** Read side of `audit_events`; always filtered by Workspace. Insertion order breaks timestamp ties. */
export function createAuditHistory({ db }: Pick<AppDatabase, 'db'>): AuditHistory {
  return {
    async forRun(workspaceId, runId, limit) {
      return db.transaction((tx) => {
        const run = tx.select({ id: runs.id }).from(runs).where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId))).get();
        if (run === undefined) return undefined;
        return tx
          .select()
          .from(auditEvents)
          .where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.runId, run.id)))
          .orderBy(asc(auditEvents.occurredAt), asc(sql`rowid`))
          .limit(limit)
          .all()
          .map(toAuditEvent);
      });
    },

    async forProcedure(workspaceId, procedureId, limit) {
      return db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.workspaceId, workspaceId),
            eq(auditEvents.subjectType, 'procedure'),
            eq(auditEvents.subjectId, procedureId),
          ),
        )
        .orderBy(asc(auditEvents.occurredAt), asc(sql`rowid`))
        .limit(limit)
        .all()
        .map(toAuditEvent);
    },
  };
}

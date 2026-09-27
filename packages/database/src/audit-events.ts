import { randomUUID } from 'node:crypto';
import type { AuditEventType, WorkspaceId } from '@vergissmeinnicht/domain';
import type { Transaction, UserActor } from './actor-guard.ts';
import { auditEvents } from './schema.ts';

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

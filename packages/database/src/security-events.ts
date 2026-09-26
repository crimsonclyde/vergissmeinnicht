import { randomUUID } from 'node:crypto';
import type { Actor, SecurityEventType } from '@vergissmeinnicht/domain';
import type { AppDatabase } from './connection.ts';
import { securityEvents } from './schema.ts';

type Transaction = Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0];

export interface SecurityEventRecord {
  readonly type: SecurityEventType;
  readonly actor: Actor;
  readonly subjectType: 'invitation' | 'user';
  readonly subjectId: string;
  readonly occurredAt: Date;
  /** Never put tokens, passwords, OTPs or other secrets here. */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Must be called inside the transaction that performs the state change it records. */
export function recordSecurityEvent(tx: Transaction, event: SecurityEventRecord): void {
  tx.insert(securityEvents)
    .values({
      id: randomUUID(),
      occurredAt: event.occurredAt,
      type: event.type,
      actorUserId: event.actor.kind === 'user' ? event.actor.userId : null,
      actorLabel: event.actor.kind === 'user' ? event.actor.displayName : event.actor.label,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      metadata: event.metadata ? { ...event.metadata } : null,
    })
    .run();
}

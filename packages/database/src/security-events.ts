import { randomUUID } from 'node:crypto';
import { InvalidCursorError, toPage, type SecurityEventEntry, type SecurityEventReader } from '@vergissmeinnicht/application';
import type { Actor, SecurityEventType } from '@vergissmeinnicht/domain';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';
import type { AppDatabase } from './connection.ts';
import { securityEvents, users } from './schema.ts';

type Transaction = Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0];

export interface SecurityEventRecord {
  readonly type: SecurityEventType;
  readonly actor: Actor;
  readonly subjectType: 'invitation' | 'user' | 'mfa_challenge' | 'workspace' | 'instance' | 'notification_provider';
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

/**
 * For events that are not part of an application-owned state change (logins happen inside
 * Better Auth). Each call is its own transaction.
 */
export function createSecurityEventLog({ db }: Pick<AppDatabase, 'db'>) {
  return {
    record(event: SecurityEventRecord): void {
      db.transaction((tx) => recordSecurityEvent(tx, event));
    },
  };
}

export type SecurityEventLog = ReturnType<typeof createSecurityEventLog>;

/** Read side for server admins (Step 5.7): newest first, insertion order breaking timestamp ties. */
export function createSecurityEventReader({ db }: Pick<AppDatabase, 'db'>): SecurityEventReader {
  return {
    async list(filter) {
      return db.transaction((tx) => {
        const scope = filter.subjectUserId === undefined ? undefined : and(eq(securityEvents.subjectType, 'user'), eq(securityEvents.subjectId, filter.subjectUserId));
        let before: SQL | undefined;
        if (filter.before !== undefined) {
          const cursor = tx
            .select({ at: securityEvents.occurredAt, rowid: sql<number>`${securityEvents}.rowid` })
            .from(securityEvents)
            .where(and(scope, eq(securityEvents.id, filter.before)))
            .get();
          if (cursor === undefined) throw new InvalidCursorError();
          before = or(
            lt(securityEvents.occurredAt, cursor.at),
            and(eq(securityEvents.occurredAt, cursor.at), lt(sql`${securityEvents}.rowid`, cursor.rowid)),
          );
        }
        const rows = tx
          .select({ event: securityEvents, email: users.email })
          .from(securityEvents)
          .leftJoin(users, and(eq(securityEvents.subjectType, 'user'), eq(users.id, securityEvents.subjectId)))
          .where(and(scope, before))
          .orderBy(desc(securityEvents.occurredAt), desc(sql`${securityEvents}.rowid`))
          .limit(filter.limit + 1)
          .all()
          .map(
            ({ event, email }): SecurityEventEntry => ({
              id: event.id,
              type: event.type as SecurityEventType,
              occurredAt: event.occurredAt,
              actorLabel: event.actorLabel,
              subjectType: event.subjectType,
              subjectId: event.subjectId,
              subjectEmail: email,
              metadata: event.metadata ?? {},
            }),
          );
        return toPage(rows, filter.limit, (entry) => entry.id);
      });
    },
  };
}

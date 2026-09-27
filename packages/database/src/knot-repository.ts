import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, isNull, or } from 'drizzle-orm';
import type { CreateKnotResult, KnotRepository, RevokeKnotResult } from '@vergissmeinnicht/application';
import type { Knot, KnotId, ProcedureId, UserId, WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { activeIn } from './procedure-repository.ts';
import { knots, procedures, runs } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;

function toKnot(row: typeof knots.$inferSelect): Knot {
  const targetId = row.targetType === 'PROCEDURE' ? row.procedureId : row.runId;
  if (targetId === null) throw new Error('knot row without target');
  return {
    id: row.id as KnotId,
    workspaceId: row.workspaceId as WorkspaceId,
    label: row.label,
    target: { type: row.targetType, id: targetId },
    createdAt: row.createdAt,
    createdBy: { userId: row.createdByUserId as UserId, displayName: row.createdByDisplayName },
    expiresAt: row.expiresAt,
    revoked:
      row.revokedAt === null || row.revokedByUserId === null || row.revokedByDisplayName === null
        ? null
        : { at: row.revokedAt, by: { userId: row.revokedByUserId as UserId, displayName: row.revokedByDisplayName } },
  };
}

/** The target's title if it exists in this Workspace; `available` is false for deleted Procedures. */
function findTarget(db: Reader, knot: Pick<Knot, 'workspaceId' | 'target'>): { title: string; available: boolean } | undefined {
  if (knot.target.type === 'RUN') {
    const run = db
      .select({ title: runs.title })
      .from(runs)
      .where(and(eq(runs.workspaceId, knot.workspaceId), eq(runs.id, knot.target.id)))
      .get();
    return run && { title: run.title, available: true };
  }
  const procedure = db
    .select({ title: procedures.title, deletedAt: procedures.deletedAt })
    .from(procedures)
    .where(and(eq(procedures.workspaceId, knot.workspaceId), eq(procedures.id, knot.target.id)))
    .get();
  return procedure && { title: procedure.title, available: procedure.deletedAt === null };
}

export function createKnotRepository({ db }: Pick<AppDatabase, 'db'>): KnotRepository {
  return {
    async create(input, actor, guard) {
      return db.transaction((tx): CreateKnotResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const exists =
          input.target.type === 'PROCEDURE'
            ? tx.select({ id: procedures.id }).from(procedures).where(activeIn(input.workspaceId, input.target.id as ProcedureId)).get()
            : tx
                .select({ id: runs.id })
                .from(runs)
                .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.id, input.target.id)))
                .get();
        if (exists === undefined) return { status: 'target_not_found' };
        const active =
          tx
            .select({ n: count() })
            .from(knots)
            .where(
              and(
                eq(knots.workspaceId, input.workspaceId),
                isNull(knots.revokedAt),
                or(isNull(knots.expiresAt), gt(knots.expiresAt, input.at)),
              ),
            )
            .get()?.n ?? 0;
        if (active >= input.maxActive) return { status: 'limit_reached' };

        const row = tx
          .insert(knots)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            tokenHash: input.tokenHash,
            label: input.label,
            targetType: input.target.type,
            procedureId: input.target.type === 'PROCEDURE' ? input.target.id : null,
            runId: input.target.type === 'RUN' ? input.target.id : null,
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
            expiresAt: input.expiresAt,
          })
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'KNOT_CREATED',
          actor,
          subjectType: 'knot',
          subjectId: row.id,
          occurredAt: input.at,
          // Never the token or its hash.
          metadata: {
            label: row.label,
            targetType: row.targetType,
            targetId: input.target.id,
            ...(row.expiresAt === null ? {} : { expiresAt: row.expiresAt.toISOString() }),
          },
        });
        return { status: 'ok', knot: toKnot(row) };
      }, IMMEDIATE);
    },

    async list(workspaceId, limit) {
      return db.transaction((tx) =>
        tx
          .select()
          .from(knots)
          .where(eq(knots.workspaceId, workspaceId))
          .orderBy(desc(knots.createdAt), asc(knots.id))
          .limit(limit)
          .all()
          .map((row) => {
            const knot = toKnot(row);
            const target = findTarget(tx, knot);
            return { knot, targetTitle: target?.title ?? '', targetAvailable: target?.available ?? false };
          }),
      );
    },

    async revoke(input, actor, guard) {
      return db.transaction((tx): RevokeKnotResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const row = tx
          .select()
          .from(knots)
          .where(and(eq(knots.workspaceId, input.workspaceId), eq(knots.id, input.knotId)))
          .get();
        if (row === undefined) return 'knot_not_found';
        if (row.revokedAt !== null) return 'already_revoked';
        tx.update(knots)
          .set({ revokedAt: input.at, revokedByUserId: actor.userId, revokedByDisplayName: actor.displayName })
          .where(and(eq(knots.id, row.id), isNull(knots.revokedAt)))
          .run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'KNOT_REVOKED',
          actor,
          subjectType: 'knot',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { label: row.label, targetType: row.targetType },
        });
        return 'ok';
      }, IMMEDIATE);
    },

    async findByTokenHash(tokenHash) {
      const row = db.select().from(knots).where(eq(knots.tokenHash, tokenHash)).get();
      return row && toKnot(row);
    },

    async targetAvailable(knot) {
      return findTarget(db, knot)?.available ?? false;
    },
  };
}

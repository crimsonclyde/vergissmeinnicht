import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { ProcedureRepository, ProcedureWriteResult } from '@vergissmeinnicht/application';
import type { Procedure, ProcedureContent, ProcedureId, WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { procedures } from './schema.ts';

function toProcedure(row: typeof procedures.$inferSelect): Procedure {
  return {
    id: row.id as ProcedureId,
    workspaceId: row.workspaceId as WorkspaceId,
    title: row.title,
    description: row.description,
    icon: row.icon,
    tags: row.tags,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Scoped to the Workspace *and* not deleted: the only way Procedure rows are addressed. */
const activeIn = (workspaceId: WorkspaceId, procedureId?: ProcedureId) =>
  and(
    eq(procedures.workspaceId, workspaceId),
    isNull(procedures.deletedAt),
    procedureId === undefined ? undefined : eq(procedures.id, procedureId),
  );

const CONTENT_FIELDS = ['title', 'description', 'icon', 'tags'] as const;

function changedFields(before: ProcedureContent, after: ProcedureContent): string[] {
  return CONTENT_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export function createProcedureRepository({ db }: Pick<AppDatabase, 'db'>): ProcedureRepository {
  return {
    async listActive(workspaceId) {
      return db
        .select()
        .from(procedures)
        .where(activeIn(workspaceId))
        .orderBy(asc(procedures.title), asc(procedures.id))
        .all()
        .map(toProcedure);
    },

    async findActive(workspaceId, procedureId) {
      const row = db.select().from(procedures).where(activeIn(workspaceId, procedureId)).get();
      return row && toProcedure(row);
    },

    async create(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const active = tx.select({ n: count() }).from(procedures).where(activeIn(input.workspaceId)).get()?.n ?? 0;
        if (active >= input.maxActive) return { status: 'limit_reached' };
        const row = tx
          .insert(procedures)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            ...input.content,
            tags: [...input.content.tags],
            revision: 1,
            createdByUserId: actor.userId,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_CREATED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title, revision: 1 },
        });
        return { status: 'ok', procedure: toProcedure(row) };
      }, IMMEDIATE);
    },

    async update(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const current = tx.select().from(procedures).where(activeIn(input.workspaceId, input.procedureId)).get();
        if (current === undefined) return { status: 'not_found' };
        if (current.revision !== input.expectedRevision) return { status: 'conflict' };
        const fields = changedFields(toProcedure(current), input.content);
        if (fields.length === 0) return { status: 'ok', procedure: toProcedure(current) };
        const revision = current.revision + 1;
        const row = tx
          .update(procedures)
          .set({ ...input.content, tags: [...input.content.tags], revision, updatedAt: input.at })
          .where(and(activeIn(input.workspaceId, input.procedureId), eq(procedures.revision, current.revision)))
          .returning()
          .get();
        if (row === undefined) return { status: 'conflict' };
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_UPDATED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { fields, revision },
        });
        return { status: 'ok', procedure: toProcedure(row) };
      }, IMMEDIATE);
    },

    async softDelete(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const row = tx
          .update(procedures)
          .set({ deletedAt: input.at, deletedByUserId: actor.userId, updatedAt: input.at })
          .where(activeIn(input.workspaceId, input.procedureId))
          .returning()
          .get();
        if (row === undefined) return { status: 'not_found' };
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_DELETED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title, revision: row.revision },
        });
        return { status: 'ok', procedure: toProcedure(row) };
      }, IMMEDIATE);
    },
  };
}

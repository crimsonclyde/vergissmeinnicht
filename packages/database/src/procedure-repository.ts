import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { ProcedureDetail, ProcedureRepository, ProcedureWriteResult } from '@vergissmeinnicht/application';
import {
  isEmptyChange,
  summarizeStructureChange,
  type Procedure,
  type ProcedureContent,
  type ProcedureId,
  type ProcedureSection,
  type SectionId,
  type StepId,
  type StructureDraft,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { procedureSections, procedureSteps, procedures, users } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;

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
export const activeIn = (workspaceId: WorkspaceId, procedureId?: ProcedureId) =>
  and(
    eq(procedures.workspaceId, workspaceId),
    isNull(procedures.deletedAt),
    procedureId === undefined ? undefined : eq(procedures.id, procedureId),
  );

/** Only call with a Procedure id that was already resolved through `activeIn`. */
export function loadSections(db: Reader, procedureId: string): ProcedureSection[] {
  const steps = db
    .select()
    .from(procedureSteps)
    .where(eq(procedureSteps.procedureId, procedureId))
    .orderBy(asc(procedureSteps.position))
    .all();
  return db
    .select()
    .from(procedureSections)
    .where(eq(procedureSections.procedureId, procedureId))
    .orderBy(asc(procedureSections.position))
    .all()
    .map((section) => ({
      id: section.id as SectionId,
      title: section.title,
      description: section.description,
      steps: steps
        .filter((step) => step.sectionId === section.id)
        .map((step) => ({
          id: step.id as StepId,
          kind: step.kind,
          title: step.title,
          description: step.description,
          icon: step.icon,
          required: step.required,
          critical: step.critical,
          skipReasonPolicy: step.skipReasonPolicy,
          notApplicableReasonPolicy: step.notApplicableReasonPolicy,
        })),
    }));
}

/**
 * Resolves draft ids against the Procedure's current items: a named id must already be a Section
 * (or Step) of *this* Procedure; unnamed items get fresh server-generated ids. Returns undefined
 * for any foreign or wrong-kind id.
 */
function resolveStructure(draft: StructureDraft, current: readonly ProcedureSection[]): ProcedureSection[] | undefined {
  const sectionIds = new Set<string>(current.map((section) => section.id));
  const stepIds = new Set<string>(current.flatMap((section) => section.steps.map((step) => step.id)));
  const resolved: ProcedureSection[] = [];
  for (const section of draft.sections) {
    if (section.id !== undefined && !sectionIds.has(section.id)) return undefined;
    const steps = [];
    for (const step of section.steps) {
      if (step.id !== undefined && !stepIds.has(step.id)) return undefined;
      steps.push({ ...step, id: step.id ?? (randomUUID() as StepId) });
    }
    resolved.push({ ...section, id: section.id ?? (randomUUID() as SectionId), steps });
  }
  return resolved;
}

function writeSections(tx: Transaction, procedureId: string, sections: readonly ProcedureSection[]): void {
  // Rewritten as a whole; ids are preserved, positions follow the array order.
  tx.delete(procedureSteps).where(eq(procedureSteps.procedureId, procedureId)).run();
  tx.delete(procedureSections).where(eq(procedureSections.procedureId, procedureId)).run();
  sections.forEach((section, position) => {
    tx.insert(procedureSections)
      .values({ id: section.id, procedureId, position, title: section.title, description: section.description })
      .run();
    section.steps.forEach((step, stepPosition) => {
      tx.insert(procedureSteps)
        .values({ ...step, procedureId, sectionId: section.id, position: stepPosition })
        .run();
    });
  });
}

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
      return db.transaction((tx): ProcedureDetail | undefined => {
        const row = tx.select().from(procedures).where(activeIn(workspaceId, procedureId)).get();
        return row && { procedure: toProcedure(row), sections: loadSections(tx, row.id) };
      });
    },

    async findDeleted(workspaceId, procedureId) {
      return db.transaction((tx): ProcedureDetail | undefined => {
        const row = tx
          .select()
          .from(procedures)
          .where(and(eq(procedures.workspaceId, workspaceId), eq(procedures.id, procedureId), isNotNull(procedures.deletedAt)))
          .get();
        return row && { procedure: toProcedure(row), sections: loadSections(tx, row.id) };
      });
    },

    async create(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const active = tx.select({ n: count() }).from(procedures).where(activeIn(input.workspaceId)).get()?.n ?? 0;
        if (active >= input.maxActive) return { status: 'limit_reached' };
        // A new Procedure has no items yet, so any client-supplied id is foreign.
        const sections = resolveStructure(input.structure, []);
        if (sections === undefined) return { status: 'invalid_reference' };
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
        writeSections(tx, row.id, sections);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_CREATED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: {
            title: row.title,
            revision: 1,
            origin: input.origin.kind,
            ...(input.origin.kind === 'duplicated' ? { sourceProcedureId: input.origin.sourceProcedureId } : {}),
            sections: sections.length,
            steps: sections.reduce((total, section) => total + section.steps.length, 0),
          },
        });
        return { status: 'ok', detail: { procedure: toProcedure(row), sections } };
      }, IMMEDIATE);
    },

    async update(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const current = tx.select().from(procedures).where(activeIn(input.workspaceId, input.procedureId)).get();
        if (current === undefined) return { status: 'not_found' };
        if (current.revision !== input.expectedRevision) return { status: 'conflict' };
        const currentSections = loadSections(tx, current.id);
        const sections = resolveStructure(input.structure, currentSections);
        if (sections === undefined) return { status: 'invalid_reference' };

        const fields = changedFields(toProcedure(current), input.content);
        const summary = summarizeStructureChange(currentSections, sections);
        if (fields.length === 0 && isEmptyChange(summary)) {
          return { status: 'ok', detail: { procedure: toProcedure(current), sections: currentSections } };
        }
        const revision = current.revision + 1;
        const row = tx
          .update(procedures)
          .set({ ...input.content, tags: [...input.content.tags], revision, updatedAt: input.at })
          .where(and(activeIn(input.workspaceId, input.procedureId), eq(procedures.revision, current.revision)))
          .returning()
          .get();
        if (row === undefined) return { status: 'conflict' };
        if (!isEmptyChange(summary)) writeSections(tx, row.id, sections);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_UPDATED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: {
            fields: isEmptyChange(summary) ? fields : [...fields, 'structure'],
            revision,
            ...(isEmptyChange(summary) ? {} : summary),
          },
        });
        return { status: 'ok', detail: { procedure: toProcedure(row), sections } };
      }, IMMEDIATE);
    },

    async listDeleted(workspaceId) {
      return db
        .select({ procedure: procedures, displayName: users.name })
        .from(procedures)
        .innerJoin(users, eq(users.id, procedures.deletedByUserId))
        .where(and(eq(procedures.workspaceId, workspaceId), isNotNull(procedures.deletedAt)))
        .orderBy(desc(procedures.deletedAt), asc(procedures.id))
        .all()
        .map(({ procedure, displayName }) => ({
          procedure: toProcedure(procedure),
          deletedAt: procedure.deletedAt ?? procedure.updatedAt,
          deletedBy: { userId: procedure.deletedByUserId ?? '', displayName },
        }));
    },

    async restore(input, actor, guard) {
      return db.transaction((tx): ProcedureWriteResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const deleted = and(
          eq(procedures.workspaceId, input.workspaceId),
          eq(procedures.id, input.procedureId),
          isNotNull(procedures.deletedAt),
        );
        const current = tx.select().from(procedures).where(deleted).get();
        if (current === undefined) return { status: 'not_found' };
        const active = tx.select({ n: count() }).from(procedures).where(activeIn(input.workspaceId)).get()?.n ?? 0;
        if (active >= input.maxActive) return { status: 'limit_reached' };
        const revision = current.revision + 1;
        const row = tx
          .update(procedures)
          .set({ deletedAt: null, deletedByUserId: null, revision, updatedAt: input.at })
          .where(and(deleted, eq(procedures.revision, current.revision)))
          .returning()
          .get();
        if (row === undefined) return { status: 'conflict' };
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'PROCEDURE_RESTORED',
          actor,
          subjectType: 'procedure',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title, revision },
        });
        return { status: 'ok', detail: { procedure: toProcedure(row), sections: loadSections(tx, row.id) } };
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
        // Sections and Steps stay untouched with the soft-deleted Procedure (restore in Step 4.5).
        return { status: 'ok', detail: { procedure: toProcedure(row), sections: loadSections(tx, row.id) } };
      }, IMMEDIATE);
    },
  };
}

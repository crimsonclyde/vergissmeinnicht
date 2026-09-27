import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { RunRepository, StartRunResult } from '@vergissmeinnicht/application';
import {
  STEP_STATES,
  type ProcedureId,
  type Run,
  type RunDetail,
  type RunId,
  type RunSection,
  type RunSectionId,
  type RunStepId,
  type StepState,
  type UserId,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { activeIn, loadSections } from './procedure-repository.ts';
import { procedures, runSections, runSteps, runs } from './schema.ts';

type Reader = Pick<Parameters<Parameters<AppDatabase['db']['transaction']>[0]>[0], 'select'>;

function toRun(row: typeof runs.$inferSelect): Run {
  return {
    id: row.id as RunId,
    workspaceId: row.workspaceId as WorkspaceId,
    procedureId: row.procedureId as ProcedureId,
    procedureRevision: row.procedureRevision,
    title: row.title,
    description: row.description,
    icon: row.icon,
    tags: row.tags,
    state: row.state,
    startedAt: row.startedAt,
    startedBy: { userId: row.startedByUserId as UserId, displayName: row.startedByDisplayName },
  };
}

/** Only call with a Run id that was already resolved within its Workspace. */
function loadRunSections(db: Reader, runId: string): RunSection[] {
  const steps = db.select().from(runSteps).where(eq(runSteps.runId, runId)).orderBy(asc(runSteps.position)).all();
  return db
    .select()
    .from(runSections)
    .where(eq(runSections.runId, runId))
    .orderBy(asc(runSections.position))
    .all()
    .map((section) => ({
      id: section.id as RunSectionId,
      title: section.title,
      description: section.description,
      steps: steps
        .filter((step) => step.runSectionId === section.id)
        .map((step) => ({
          id: step.id as RunStepId,
          kind: step.kind,
          title: step.title,
          description: step.description,
          icon: step.icon,
          required: step.required,
          critical: step.critical,
          skipReasonPolicy: step.skipReasonPolicy,
          notApplicableReasonPolicy: step.notApplicableReasonPolicy,
          state: step.state,
        })),
    }));
}

export function createRunRepository({ db }: Pick<AppDatabase, 'db'>): RunRepository {
  return {
    async start(input, actor, guard) {
      return db.transaction((tx): StartRunResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const procedure = tx.select().from(procedures).where(activeIn(input.workspaceId, input.procedureId)).get();
        if (procedure === undefined) return { status: 'procedure_not_found' };
        const sections = loadSections(tx, procedure.id);
        const stepCount = sections.reduce((total, section) => total + section.steps.length, 0);
        if (stepCount === 0) return { status: 'no_steps' };
        const active =
          tx
            .select({ n: count() })
            .from(runs)
            .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.state, 'ACTIVE')))
            .get()?.n ?? 0;
        if (active >= input.maxActive) return { status: 'limit_reached' };

        const run = tx
          .insert(runs)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            procedureId: procedure.id,
            procedureRevision: procedure.revision,
            title: procedure.title,
            description: procedure.description,
            icon: procedure.icon,
            tags: procedure.tags,
            state: 'ACTIVE',
            startedByUserId: actor.userId,
            startedByDisplayName: actor.displayName,
            startedAt: input.at,
          })
          .returning()
          .get();
        // Copy, never reference: Procedure Sections/Steps are rewritten on every save.
        sections.forEach((section, position) => {
          const runSectionId = randomUUID();
          tx.insert(runSections)
            .values({
              id: runSectionId,
              runId: run.id,
              position,
              sourceSectionId: section.id,
              title: section.title,
              description: section.description,
            })
            .run();
          section.steps.forEach((step, stepPosition) => {
            tx.insert(runSteps)
              .values({
                id: randomUUID(),
                runId: run.id,
                runSectionId,
                position: stepPosition,
                sourceStepId: step.id,
                kind: step.kind,
                title: step.title,
                description: step.description,
                icon: step.icon,
                required: step.required,
                critical: step.critical,
                skipReasonPolicy: step.skipReasonPolicy,
                notApplicableReasonPolicy: step.notApplicableReasonPolicy,
                state: 'PENDING',
              })
              .run();
          });
        });
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'RUN_STARTED',
          actor,
          subjectType: 'run',
          subjectId: run.id,
          runId: run.id,
          occurredAt: input.at,
          metadata: { procedureId: procedure.id, procedureRevision: procedure.revision, title: procedure.title, steps: stepCount },
        });
        return { status: 'ok', detail: { run: toRun(run), sections: loadRunSections(tx, run.id) } };
      }, IMMEDIATE);
    },

    async list(workspaceId, filter) {
      return db.transaction((tx) => {
        const rows = tx
          .select()
          .from(runs)
          .where(and(eq(runs.workspaceId, workspaceId), filter.state === undefined ? undefined : eq(runs.state, filter.state)))
          .orderBy(desc(runs.startedAt), asc(runs.id))
          .limit(filter.limit)
          .all();
        const counts =
          rows.length === 0
            ? []
            : tx
                .select({ runId: runSteps.runId, state: runSteps.state, n: count() })
                .from(runSteps)
                .where(inArray(runSteps.runId, rows.map((row) => row.id)))
                .groupBy(runSteps.runId, runSteps.state)
                .all();
        return rows.map((row) => {
          const stepCounts = Object.fromEntries(STEP_STATES.map((state) => [state, 0])) as Record<StepState, number>;
          for (const entry of counts) if (entry.runId === row.id) stepCounts[entry.state] = entry.n;
          return { run: toRun(row), stepCounts };
        });
      });
    },

    async find(workspaceId, runId) {
      return db.transaction((tx): RunDetail | undefined => {
        const row = tx.select().from(runs).where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId))).get();
        return row && { run: toRun(row), sections: loadRunSections(tx, row.id) };
      });
    },
  };
}

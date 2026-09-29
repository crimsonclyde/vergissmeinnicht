import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, lt, or, type SQL } from 'drizzle-orm';
import { InvalidCursorError, toPage, type FinishRunResult, type RunRepository, type StartRunResult, type StepStateChangeResult } from '@vergissmeinnicht/application';
import {
  STEP_STATES,
  plausibleDeviceTime,
  type ProcedureId,
  type Run,
  type RunDetail,
  type RunId,
  type RunSection,
  type RunStep,
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
import { closeScheduleAsStarted, scheduleIsOpen } from './schedule-repository.ts';
import { auditEvents, procedures, runSections, runSteps, runs } from './schema.ts';

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
    revision: row.revision,
    startedAt: row.startedAt,
    startedBy: { userId: row.startedByUserId as UserId, displayName: row.startedByDisplayName },
    ended:
      row.endedAt === null || row.endedByUserId === null || row.endedByDisplayName === null
        ? null
        : { at: row.endedAt, by: { userId: row.endedByUserId as UserId, displayName: row.endedByDisplayName }, reason: row.endReason },
  };
}

function toRunStep(step: typeof runSteps.$inferSelect): RunStep {
  return {
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
    stateChange:
      step.stateChangedByUserId === null || step.stateChangedByDisplayName === null || step.stateChangedAt === null
        ? null
        : {
            by: { userId: step.stateChangedByUserId as UserId, displayName: step.stateChangedByDisplayName },
            at: step.stateChangedAt,
            reason: step.stateReason,
            deviceAt: step.stateChangedDeviceAt,
          },
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
        .map(toRunStep),
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
        // Started from a scheduled item (13.4): it must still be open, for this Procedure, in this Workspace.
        if (input.fromSchedule !== undefined && !scheduleIsOpen(tx, input.workspaceId, input.fromSchedule, procedure.id)) {
          return { status: 'schedule_not_open' };
        }

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
          metadata: {
            procedureId: procedure.id,
            procedureRevision: procedure.revision,
            title: procedure.title,
            steps: stepCount,
            ...(input.fromSchedule === undefined ? {} : { scheduleId: input.fromSchedule }),
          },
        });
        if (input.fromSchedule !== undefined) {
          closeScheduleAsStarted(tx, { workspaceId: input.workspaceId, scheduleId: input.fromSchedule, procedureId: procedure.id, runId: run.id, at: input.at, actor });
        }
        return { status: 'ok', detail: { run: toRun(run), sections: loadRunSections(tx, run.id) } };
      }, IMMEDIATE);
    },

    async list(workspaceId, filter) {
      return db.transaction((tx) => {
        const scope = and(
          eq(runs.workspaceId, workspaceId),
          filter.state === undefined ? undefined : eq(runs.state, filter.state),
          filter.procedureId === undefined ? undefined : eq(runs.procedureId, filter.procedureId),
        );
        let before: SQL | undefined;
        if (filter.before !== undefined) {
          const cursor = tx.select({ startedAt: runs.startedAt, id: runs.id }).from(runs).where(and(scope, eq(runs.id, filter.before))).get();
          if (cursor === undefined) throw new InvalidCursorError();
          before = or(lt(runs.startedAt, cursor.startedAt), and(eq(runs.startedAt, cursor.startedAt), gt(runs.id, cursor.id)));
        }
        const rows = tx
          .select()
          .from(runs)
          .where(and(scope, before))
          .orderBy(desc(runs.startedAt), asc(runs.id))
          .limit(filter.limit + 1)
          .all();
        const page = toPage(rows, filter.limit, (row) => row.id);
        const counts =
          page.items.length === 0
            ? []
            : tx
                .select({ runId: runSteps.runId, state: runSteps.state, n: count() })
                .from(runSteps)
                .where(inArray(runSteps.runId, page.items.map((row) => row.id)))
                .groupBy(runSteps.runId, runSteps.state)
                .all();
        return {
          nextCursor: page.nextCursor,
          items: page.items.map((row) => {
            const stepCounts = Object.fromEntries(STEP_STATES.map((state) => [state, 0])) as Record<StepState, number>;
            for (const entry of counts) if (entry.runId === row.id) stepCounts[entry.state] = entry.n;
            return { run: toRun(row), stepCounts };
          }),
        };
      });
    },

    async finish(input, actor, guard, validate) {
      return db.transaction((tx): FinishRunResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const run = tx.select().from(runs).where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.id, input.runId))).get();
        if (run === undefined) return { status: 'run_not_found' };
        if (run.state !== 'ACTIVE') return { status: 'run_not_active' };
        const steps = loadRunSections(tx, run.id).flatMap((section) => section.steps);
        // Throws (rolling back) when the Run may not end this way, e.g. required Steps still open.
        const { reason } = validate(steps);
        const revision = run.revision + 1;
        const updated = tx
          .update(runs)
          .set({
            state: input.to,
            revision,
            endedAt: input.at,
            endedByUserId: actor.userId,
            endedByDisplayName: actor.displayName,
            endReason: reason,
          })
          .where(and(eq(runs.id, run.id), eq(runs.state, 'ACTIVE')))
          .returning()
          .get();
        if (updated === undefined) return { status: 'run_not_active' };
        const stepCounts = Object.fromEntries(STEP_STATES.map((state) => [state, 0])) as Record<StepState, number>;
        for (const step of steps) stepCounts[step.state] += 1;
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: input.to === 'COMPLETED' ? 'RUN_COMPLETED' : 'RUN_ABORTED',
          actor,
          subjectType: 'run',
          subjectId: run.id,
          runId: run.id,
          occurredAt: input.at,
          metadata: {
            runRevision: revision,
            done: stepCounts.DONE,
            skipped: stepCounts.SKIPPED,
            notApplicable: stepCounts.NOT_APPLICABLE,
            pending: stepCounts.PENDING,
            ...(reason === null ? {} : { reason }),
          },
        });
        return { status: 'ok', detail: { run: toRun(updated), sections: loadRunSections(tx, run.id) } };
      }, IMMEDIATE);
    },

    async changeStepState(input, actor, guard, validate) {
      return db.transaction((tx): StepStateChangeResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const run = tx
          .select({ id: runs.id, state: runs.state, revision: runs.revision, startedAt: runs.startedAt })
          .from(runs)
          .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.id, input.runId)))
          .get();
        if (run === undefined) return { status: 'run_not_found' };
        // The Step must belong to this Run (which belongs to this Workspace).
        const current = tx
          .select()
          .from(runSteps)
          .where(and(eq(runSteps.runId, run.id), eq(runSteps.id, input.stepId)))
          .get();
        if (current === undefined) return { status: 'step_not_found' };

        if (input.offline !== undefined) {
          // The same offline change sent again (e.g. the first answer was lost): already applied.
          const earlier = tx
            .select({ runId: auditEvents.runId, subjectId: auditEvents.subjectId })
            .from(auditEvents)
            .where(and(eq(auditEvents.actorUserId, actor.userId), eq(auditEvents.clientChangeId, input.offline.clientChangeId)))
            .get();
          if (earlier !== undefined) {
            if (earlier.runId !== run.id || earlier.subjectId !== current.id) return { status: 'conflict' };
            return { status: 'ok', step: toRunStep(current), runRevision: run.revision, duplicate: true };
          }
        }

        if (run.state !== 'ACTIVE') return { status: 'run_not_active' };
        if (current.state !== input.expectedState) return { status: 'conflict' };
        // Throws (rolling back) for disallowed transitions and reason-policy violations.
        const { reason } = validate(toRunStep(current));
        const deviceAt =
          input.offline?.deviceAt === undefined ? null : plausibleDeviceTime(input.offline.deviceAt, run, input.at);

        const updated = tx
          .update(runSteps)
          .set({
            state: input.to,
            stateReason: reason,
            stateChangedByUserId: actor.userId,
            stateChangedByDisplayName: actor.displayName,
            stateChangedAt: input.at,
            stateChangedDeviceAt: deviceAt,
          })
          .where(and(eq(runSteps.id, current.id), eq(runSteps.state, current.state)))
          .returning()
          .get();
        if (updated === undefined) return { status: 'conflict' };
        const runRevision = run.revision + 1;
        tx.update(runs).set({ revision: runRevision }).where(eq(runs.id, run.id)).run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'STEP_STATE_CHANGED',
          actor,
          subjectType: 'run_step',
          subjectId: current.id,
          runId: run.id,
          occurredAt: input.at,
          clientChangeId: input.offline?.clientChangeId,
          metadata: {
            from: current.state,
            to: input.to,
            undo: input.to === 'PENDING',
            stepTitle: current.title,
            runRevision,
            ...(reason === null ? {} : { reason }),
            ...(input.offline === undefined ? {} : { offline: true }),
            ...(deviceAt === null ? {} : { deviceTime: deviceAt.toISOString() }),
          },
        });
        return { status: 'ok', step: toRunStep(updated), runRevision };
      }, IMMEDIATE);
    },

    async find(workspaceId, runId) {
      return db.transaction((tx): RunDetail | undefined => {
        const row = tx.select().from(runs).where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId))).get();
        return row && { run: toRun(row), sections: loadRunSections(tx, row.id) };
      });
    },
  };
}

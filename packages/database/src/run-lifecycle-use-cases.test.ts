import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  RunIncompleteError,
  RunNotActiveError,
  RunNotFoundError,
  WorkspaceNotFoundError,
  abortRun,
  addMember,
  changeMemberRole,
  changeStepState,
  completeRun,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getRun,
  listRuns,
  startRun,
  updateProcedure,
  type ProcedureDeps,
  type ProcedureInput,
  type RunDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  DomainValidationError,
  normalizeEmail,
  type RunChange,
  type RunDetail,
  type RunStep,
  type StepState,
  type User,
  type Workspace,
} from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const step = (title: string, required: boolean) => ({
  title,
  description: '',
  icon: null,
  required,
  critical: false,
  skipReasonPolicy: 'OPTIONAL' as const,
  notApplicableReasonPolicy: 'OPTIONAL' as const,
});
const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: '',
  icon: 'home',
  tags: [],
  sections: [{ title: 'All', description: '', steps: [step('Stove off', true), step('Windows', true), step('Plants', false)] }],
};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

describe('Run lifecycle and historical immutability', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: RunDeps;
  let admin: User;
  let member: User;
  let guest: User;
  let home: Workspace;
  let office: Workspace;
  let run: RunDetail;
  let steps: RunStep[];

  const set = (target: RunStep, from: StepState, to: StepState) =>
    changeStepState(deps, { actor: member, workspaceId: home.id, runId: run.run.id, stepId: target.id, expectedState: from, to });
  const complete = (actor = member, workspace = home) => completeRun(deps, { actor, workspaceId: workspace.id, runId: run.run.id });
  const abort = (reason?: string, actor = member) => abortRun(deps, { actor, workspaceId: home.id, runId: run.run.id, reason });
  const auditTypes = () =>
    (database.sqlite.prepare('SELECT type FROM audit_events WHERE run_id = ? ORDER BY rowid').all(run.run.id) as { type: string }[]).map(
      (r) => r.type,
    );

  beforeEach(async () => {
    database = createTestDatabase();
    const clock = { now: () => new Date() };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    const procedureDeps: ProcedureDeps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, runs: createRunRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: guest.email, role: 'GUEST' });
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    run = await startRun(deps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id });
    steps = [...must(run.sections[0]).steps];
  });

  afterEach(() => database.dispose());

  describe('change notifications (realtime fan-out)', () => {
    it('announces only committed changes, with the new revision and the actor display name', async () => {
      const changes: RunChange[] = [];
      deps = { ...deps, changes: { runChanged: (change) => changes.push(change) } };

      await set(must(steps[0]), 'PENDING', 'DONE');
      // Rejected or conflicting changes are not announced.
      await expect(set(must(steps[0]), 'PENDING', 'DONE')).rejects.toThrow();
      await expect(complete()).rejects.toThrow(RunIncompleteError);
      await expect(
        changeStepState(deps, { actor: guest, workspaceId: home.id, runId: run.run.id, stepId: must(steps[1]).id, expectedState: 'PENDING', to: 'DONE' }),
      ).rejects.toThrow(NotAuthorizedError);
      await abort('Rain');

      expect(changes).toEqual([
        { workspaceId: home.id, runId: run.run.id, revision: 2, kind: 'STEP_STATE_CHANGED', stepId: must(steps[0]).id, by: 'Uma', at: expect.any(Date) },
        { workspaceId: home.id, runId: run.run.id, revision: 3, kind: 'RUN_ABORTED', stepId: null, by: 'Uma', at: expect.any(Date) },
      ]);
      expect((await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).run.revision).toBe(3);
    });
  });

  describe('completion', () => {
    it('requires every required Step to be DONE or NOT_APPLICABLE; optional Steps may stay pending', async () => {
      await expect(complete()).rejects.toThrow(RunIncompleteError);
      await set(must(steps[0]), 'PENDING', 'DONE');
      await set(must(steps[1]), 'PENDING', 'SKIPPED');
      const error = await complete().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RunIncompleteError);
      expect((error as RunIncompleteError).openRequiredSteps).toBe(1);
      await set(must(steps[1]), 'SKIPPED', 'PENDING');
      await set(must(steps[1]), 'PENDING', 'NOT_APPLICABLE');

      const completed = await complete();
      expect(completed.run).toMatchObject({ state: 'COMPLETED', ended: { by: { userId: member.id, displayName: 'Uma' }, reason: null } });
      expect(auditTypes()).toEqual([
        'RUN_STARTED',
        'STEP_STATE_CHANGED',
        'STEP_STATE_CHANGED',
        'STEP_STATE_CHANGED',
        'STEP_STATE_CHANGED',
        'RUN_COMPLETED',
      ]);
      const metadata = database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type = 'RUN_COMPLETED'").get() as { metadata: string };
      expect(JSON.parse(metadata.metadata)).toEqual({ runRevision: 6, done: 1, skipped: 0, notApplicable: 1, pending: 1 });
      expect((await listRuns(deps, { actor: guest, workspaceId: home.id, state: 'COMPLETED' })).items.map((r) => r.run.id)).toEqual([run.run.id]);
    });

    it('is refused for GUESTs, non-members and through another Workspace', async () => {
      await set(must(steps[0]), 'PENDING', 'DONE');
      await set(must(steps[1]), 'PENDING', 'DONE');
      await expect(complete(guest)).rejects.toThrow(NotAuthorizedError);
      await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: member.email, role: 'ADMIN' });
      await expect(complete(member, office)).rejects.toThrow(RunNotFoundError);
      const outsider = await workspaceDeps.users.create({
        email: normalizeEmail('out@example.org'),
        displayName: 'Otto',
        emailVerified: true,
        status: 'ACTIVE',
        serverAdmin: false,
      });
      await expect(complete(outsider)).rejects.toThrow(WorkspaceNotFoundError);
      expect((await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).run.state).toBe('ACTIVE');
    });

    it('re-checks the Steps inside the transaction (a concurrent undo blocks completion)', async () => {
      await set(must(steps[0]), 'PENDING', 'DONE');
      await set(must(steps[1]), 'PENDING', 'DONE');
      const runs = createRunRepository(database);
      const racing: RunDeps = {
        ...deps,
        runs: {
          ...runs,
          async finish(...args) {
            await set(must(steps[1]), 'DONE', 'PENDING');
            return runs.finish(...args);
          },
        },
      };
      await expect(completeRun(racing, { actor: member, workspaceId: home.id, runId: run.run.id })).rejects.toThrow(RunIncompleteError);
    });

    it('re-checks the actor inside the transaction', async () => {
      const runs = createRunRepository(database);
      const racing: RunDeps = {
        ...deps,
        runs: {
          ...runs,
          async finish(...args) {
            await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
            return runs.finish(...args);
          },
        },
      };
      await expect(abortRun(racing, { actor: member, workspaceId: home.id, runId: run.run.id })).rejects.toThrow(NotAuthorizedError);
    });
  });

  describe('abort', () => {
    it('ends an active Run regardless of Step states, with an optional audited reason', async () => {
      const aborted = await abort('  Power cut  ');
      expect(aborted.run).toMatchObject({ state: 'ABORTED', ended: { by: { displayName: 'Uma' }, reason: 'Power cut' } });
      const metadata = database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type = 'RUN_ABORTED'").get() as { metadata: string };
      expect(JSON.parse(metadata.metadata)).toMatchObject({ reason: 'Power cut', pending: 3 });
    });

    it('validates the reason and refuses GUESTs', async () => {
      await expect(abort('x'.repeat(501))).rejects.toThrow(DomainValidationError);
      await expect(abort(undefined, guest)).rejects.toThrow(NotAuthorizedError);
      const outsider = await workspaceDeps.users.create({
        email: normalizeEmail('out@example.org'),
        displayName: 'Otto',
        emailVerified: true,
        status: 'ACTIVE',
        serverAdmin: false,
      });
      // Indistinguishable from an unknown Workspace, never a 403 that would confirm the Run exists.
      await expect(abort(undefined, outsider)).rejects.toThrow(WorkspaceNotFoundError);
      expect((await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).run.state).toBe('ACTIVE');
    });
  });

  describe('finished Runs are history (5.6)', () => {
    it('cannot be completed, aborted or executed again', async () => {
      await abort();
      await expect(abort()).rejects.toThrow(RunNotActiveError);
      await expect(complete()).rejects.toThrow(RunNotActiveError);
      await expect(set(must(steps[0]), 'PENDING', 'DONE')).rejects.toThrow(RunNotActiveError);
      expect(auditTypes()).toEqual(['RUN_STARTED', 'RUN_ABORTED']);
    });

    it('is frozen at the database level, including state, end data and Steps', async () => {
      await set(must(steps[0]), 'PENDING', 'DONE');
      await set(must(steps[1]), 'PENDING', 'DONE');
      await complete();
      const exec = (sql: string, ...params: unknown[]) => () => database.sqlite.prepare(sql).run(...params);
      expect(exec("UPDATE runs SET state = 'ACTIVE', ended_at = NULL, ended_by_user_id = NULL, ended_by_display_name = NULL WHERE id = ?", run.run.id)).toThrow(
        /finished/,
      );
      expect(exec('UPDATE runs SET revision = revision + 1 WHERE id = ?', run.run.id)).toThrow(/finished/);
      expect(exec("UPDATE runs SET ended_by_display_name = 'Someone else' WHERE id = ?", run.run.id)).toThrow(/finished/);
      expect(exec("UPDATE run_steps SET state = 'PENDING' WHERE id = ?", must(steps[0]).id)).toThrow(/not active/);
      expect(exec('DELETE FROM runs WHERE id = ?', run.run.id)).toThrow(/never deleted/);
    });

    it('stays exactly as it was when completed, whatever happens to the Procedure afterwards', async () => {
      await set(must(steps[0]), 'PENDING', 'DONE');
      await set(must(steps[1]), 'PENDING', 'DONE');
      const completed = await complete();
      const historyBefore = database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(run.run.id);
      const procedureDeps: ProcedureDeps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock: { now: () => new Date() } };
      await updateProcedure(procedureDeps, {
        actor: admin,
        workspaceId: home.id,
        procedureId: run.run.procedureId,
        expectedRevision: 1,
        content: { ...PROCEDURE, title: 'Rewritten', sections: [] },
      });
      await deleteProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: run.run.procedureId });
      expect(await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).toEqual(completed);
      expect(database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(run.run.id)).toEqual(historyBefore);
    });

    it('rejects inconsistent end data at the database level', () => {
      const exec = (sql: string, ...params: unknown[]) => () => database.sqlite.prepare(sql).run(...params);
      expect(exec("UPDATE runs SET state = 'ABORTED' WHERE id = ?", run.run.id)).toThrow(/CHECK/);
      expect(exec("UPDATE runs SET end_reason = 'x' WHERE id = ?", run.run.id)).toThrow(/CHECK/);
      expect(
        exec(
          "UPDATE runs SET state = 'COMPLETED', ended_at = 1, ended_by_user_id = ?, ended_by_display_name = 'Uma', end_reason = 'x' WHERE id = ?",
          member.id,
          run.run.id,
        ),
      ).toThrow(/CHECK/);
    });
  });

  it('rolls back the end when the audit event cannot be written', async () => {
    database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(abort('x')).rejects.toThrow();
    expect((database.sqlite.prepare('SELECT state, ended_at FROM runs WHERE id = ?').get(run.run.id) as { state: string }).state).toBe(
      'ACTIVE',
    );
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  RunNotActiveError,
  RunNotFoundError,
  RunStepNotFoundError,
  StepStateConflictError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  changeStepState,
  createProcedure,
  createWorkspace,
  getRun,
  startRun,
  type ProcedureDeps,
  type ProcedureInput,
  type RunDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  DomainValidationError,
  normalizeEmail,
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

const step = (title: string, skip: string, na: string) => ({
  title,
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: skip,
  notApplicableReasonPolicy: na,
});
const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: '',
  icon: 'home',
  tags: [],
  sections: [
    {
      title: 'All',
      description: '',
      steps: [
        step('Stove off', 'DISABLED', 'DISABLED'),
        step('Windows closed', 'REQUIRED', 'OPTIONAL'),
        step('Plants watered', 'OPTIONAL', 'REQUIRED'),
      ],
    },
  ],
};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

describe('Step state machine', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: RunDeps;
  let admin: User;
  let member: User;
  let colleague: User;
  let guest: User;
  let home: Workspace;
  let office: Workspace;
  let run: RunDetail;
  let stove: RunStep;
  let windows: RunStep;
  let plants: RunStep;

  const change = (
    actor: User,
    target: RunStep,
    expectedState: StepState,
    to: StepState,
    reason?: string,
    where: { workspace?: Workspace; runId?: string } = {},
  ) =>
    changeStepState(deps, {
      actor,
      workspaceId: (where.workspace ?? home).id,
      runId: (where.runId ?? run.run.id) as RunDetail['run']['id'],
      stepId: target.id,
      expectedState,
      to,
      reason,
    });
  const current = async (target: RunStep) =>
    must((await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).sections[0]?.steps.find((s) => s.id === target.id));
  const audit = () =>
    database.sqlite
      .prepare("SELECT run_id AS runId, subject_id AS stepId, actor_display_name AS name, metadata FROM audit_events WHERE type = 'STEP_STATE_CHANGED' ORDER BY rowid")
      .all() as { runId: string; stepId: string; name: string; metadata: string }[];

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
    colleague = await user('colleague@example.org', 'Cole');
    guest = await user('guest@example.org', 'Gus');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    for (const [u, role] of [
      [member, 'USER'],
      [colleague, 'USER'],
      [guest, 'GUEST'],
    ] as const) {
      await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: u.email, role });
    }
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    run = await startRun(deps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id });
    const steps = must(run.sections[0]).steps;
    [stove, windows, plants] = [must(steps[0]), must(steps[1]), must(steps[2])];
  });

  afterEach(() => database.dispose());

  it('resolves Steps and records who, when, why — one audited event per change with the Run id', async () => {
    const done = await change(member, stove, 'PENDING', 'DONE');
    expect(done.step).toMatchObject({ state: 'DONE', stateChange: { by: { userId: member.id, displayName: 'Uma' }, reason: null } });
    expect(done.runRevision).toBe(2);
    await change(colleague, windows, 'PENDING', 'SKIPPED', '  Raining, closed yesterday ');
    await change(member, plants, 'PENDING', 'NOT_APPLICABLE', 'No plants any more');

    expect((await current(windows)).stateChange).toMatchObject({ by: { displayName: 'Cole' }, reason: 'Raining, closed yesterday' });
    const events = audit();
    expect(events.map((e) => [e.stepId, e.name])).toEqual([
      [stove.id, 'Uma'],
      [windows.id, 'Cole'],
      [plants.id, 'Uma'],
    ]);
    expect(events.every((e) => e.runId === run.run.id)).toBe(true);
    expect(JSON.parse(must(events[1]).metadata)).toEqual({
      from: 'PENDING',
      to: 'SKIPPED',
      undo: false,
      stepTitle: 'Windows closed',
      runRevision: 3,
      reason: 'Raining, closed yesterday',
    });
  });

  it('supports audited undo, and re-resolving after undo', async () => {
    await change(member, windows, 'PENDING', 'SKIPPED', 'Later');
    const undone = await change(colleague, windows, 'SKIPPED', 'PENDING');
    expect(undone.step).toMatchObject({ state: 'PENDING', stateChange: { by: { displayName: 'Cole' }, reason: null } });
    await change(member, windows, 'PENDING', 'DONE');
    expect(audit().map((e) => JSON.parse(e.metadata) as { from: string; to: string; undo: boolean })).toMatchObject([
      { from: 'PENDING', to: 'SKIPPED', undo: false },
      { from: 'SKIPPED', to: 'PENDING', undo: true },
      { from: 'PENDING', to: 'DONE', undo: false },
    ]);
  });

  it('enforces the snapshotted reason policies on the server', async () => {
    const rejects = async (target: RunStep, to: StepState, reason: string | undefined, code: string) => {
      const error = await change(member, target, 'PENDING', to, reason).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).code).toBe(code);
    };
    await rejects(stove, 'SKIPPED', 'why not', 'reason_not_allowed');
    await rejects(stove, 'DONE', 'finished', 'reason_not_allowed');
    await rejects(windows, 'SKIPPED', undefined, 'reason_required');
    await rejects(windows, 'SKIPPED', '   ', 'reason_required');
    await rejects(plants, 'NOT_APPLICABLE', undefined, 'reason_required');
    await rejects(plants, 'SKIPPED', 'x'.repeat(501), 'reason_too_long');
    await rejects(plants, 'SKIPPED', 'evil‮text', 'reason_invalid_characters');
    await expect(change(member, stove, 'PENDING', 'SKIPPED')).resolves.toBeDefined();
    await expect(change(member, windows, 'PENDING', 'NOT_APPLICABLE')).resolves.toBeDefined();
    // Nothing from the rejected attempts was written.
    expect(audit()).toHaveLength(2);
  });

  it('rejects disallowed transitions', async () => {
    await change(member, stove, 'PENDING', 'DONE');
    const code = async (expectedState: StepState, to: StepState) =>
      ((await change(member, stove, expectedState, to).catch((caught: unknown) => caught)) as DomainValidationError).code;
    expect(await code('DONE', 'SKIPPED')).toBe('invalid_transition');
    expect(await code('DONE', 'DONE')).toBe('invalid_transition');
    expect((await current(stove)).state).toBe('DONE');
  });

  it('detects concurrent changes instead of overwriting them', async () => {
    await change(member, stove, 'PENDING', 'DONE');
    // Cole's screen still showed PENDING.
    await expect(change(colleague, stove, 'PENDING', 'NOT_APPLICABLE')).rejects.toThrow(StepStateConflictError);
    await expect(change(colleague, stove, 'PENDING', 'DONE')).rejects.toThrow(StepStateConflictError);
    expect((await current(stove)).stateChange?.by.displayName).toBe('Uma');
  });

  describe('authorization and scoping', () => {
    it('lets GUESTs watch but not execute', async () => {
      await expect(change(guest, stove, 'PENDING', 'DONE')).rejects.toThrow(NotAuthorizedError);
      expect((await current(stove)).state).toBe('PENDING');
    });

    it('lets any executing member continue a Run someone else started', async () => {
      await expect(change(colleague, stove, 'PENDING', 'DONE')).resolves.toBeDefined();
      await expect(change(admin, windows, 'PENDING', 'SKIPPED', 'Admin skipped')).resolves.toBeDefined();
    });

    it('never reaches Steps of another Run or Workspace', async () => {
      await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: member.email, role: 'ADMIN' });
      const otherRun = await startRun(deps, { actor: member, workspaceId: home.id, procedureId: run.run.procedureId });
      // A Step of this Run addressed through another Run of the same Workspace.
      await expect(change(member, stove, 'PENDING', 'DONE', undefined, { runId: otherRun.run.id })).rejects.toThrow(RunStepNotFoundError);
      // This Run addressed through Office (Uma administers Office).
      await expect(change(member, stove, 'PENDING', 'DONE', undefined, { workspace: office })).rejects.toThrow(RunNotFoundError);
      // Non-members of Home.
      const outsider = await workspaceDeps.users.create({
        email: normalizeEmail('out@example.org'),
        displayName: 'Otto',
        emailVerified: true,
        status: 'ACTIVE',
        serverAdmin: false,
      });
      await expect(change(outsider, stove, 'PENDING', 'DONE')).rejects.toThrow(WorkspaceNotFoundError);
      expect((await current(stove)).state).toBe('PENDING');
    });

    it('re-checks the actor inside the write transaction', async () => {
      const runs = createRunRepository(database);
      const racing: RunDeps = {
        ...deps,
        runs: {
          ...runs,
          async changeStepState(...args) {
            await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
            return runs.changeStepState(...args);
          },
        },
      };
      await expect(
        changeStepState(racing, { actor: member, workspaceId: home.id, runId: run.run.id, stepId: stove.id, expectedState: 'PENDING', to: 'DONE' }),
      ).rejects.toThrow(NotAuthorizedError);
      expect((await current(stove)).state).toBe('PENDING');
    });
  });

  it('refuses changes once the Run is no longer active', async () => {
    database.sqlite
      .prepare("UPDATE runs SET state = 'ABORTED', ended_at = 1, ended_by_user_id = ?, ended_by_display_name = 'Uma' WHERE id = ?")
      .run(member.id, run.run.id);
    await expect(change(member, stove, 'PENDING', 'DONE')).rejects.toThrow(RunNotActiveError);
  });

  it('rolls back the state change when the audit event cannot be written', async () => {
    database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
    await expect(change(member, stove, 'PENDING', 'DONE')).rejects.toThrow();
    const stored = database.sqlite.prepare('SELECT state, state_changed_by_user_id AS by FROM run_steps WHERE id = ?').get(stove.id);
    expect(stored).toEqual({ state: 'PENDING', by: null });
    expect((database.sqlite.prepare('SELECT revision FROM runs WHERE id = ?').get(run.run.id) as { revision: number }).revision).toBe(1);
  });

  it('keeps the snapshot triggers after the state-column migration', () => {
    expect(() => database.sqlite.prepare("UPDATE run_steps SET title = 'Forged' WHERE id = ?").run(stove.id)).toThrow(/immutable/);
    expect(() => database.sqlite.prepare('DELETE FROM run_steps WHERE id = ?').run(stove.id)).toThrow(/never deleted/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RunNotFoundError,
  WorkspaceNotFoundError,
  addMember,
  changeStepState,
  completeRun,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getProcedureHistory,
  getRunHistory,
  restoreProcedure,
  startRun,
  updateProcedure,
  type HistoryDeps,
  type ProcedureDeps,
  type ProcedureInput,
  type RunDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createAuditHistory } from './audit-events.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

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
        {
          title: 'Stove off',
          description: '',
          icon: null,
          required: true,
          critical: false,
          skipReasonPolicy: 'OPTIONAL',
          notApplicableReasonPolicy: 'OPTIONAL',
        },
      ],
    },
  ],
};

describe('Audit history', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let procedureDeps: ProcedureDeps;
  let runDeps: RunDeps;
  let deps: HistoryDeps;
  let admin: User;
  let member: User;
  let guest: User;
  let home: Workspace;
  let office: Workspace;

  beforeEach(async () => {
    database = createTestDatabase();
    const clock = { now: () => new Date() };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    procedureDeps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    runDeps = { workspaces: workspaceDeps.workspaces, runs: createRunRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, history: createAuditHistory(database) };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: guest.email, role: 'GUEST' });
  });

  afterEach(() => database.dispose());

  it('tells who did what, when and why in a Run, oldest first', async () => {
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const run = await startRun(runDeps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id });
    const other = await startRun(runDeps, { actor: admin, workspaceId: home.id, procedureId: procedure.procedure.id });
    const stepId = run.sections[0]?.steps[0]?.id ?? '';
    const change = (expectedState: 'PENDING' | 'SKIPPED', to: 'PENDING' | 'SKIPPED' | 'DONE', reason?: string) =>
      changeStepState(runDeps, { actor: member, workspaceId: home.id, runId: run.run.id, stepId: stepId as never, expectedState, to, reason });
    await change('PENDING', 'SKIPPED', 'Later');
    await change('SKIPPED', 'PENDING');
    await change('PENDING', 'DONE');
    await completeRun(runDeps, { actor: admin, workspaceId: home.id, runId: run.run.id });

    const history = await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: run.run.id });
    expect(history.map((e) => [e.type, e.actor.displayName])).toEqual([
      ['RUN_STARTED', 'Uma'],
      ['STEP_STATE_CHANGED', 'Uma'],
      ['STEP_STATE_CHANGED', 'Uma'],
      ['STEP_STATE_CHANGED', 'Uma'],
      ['RUN_COMPLETED', 'Ada'],
    ]);
    expect(history[1]).toMatchObject({ subjectType: 'run_step', subjectId: stepId, runId: run.run.id, metadata: { from: 'PENDING', to: 'SKIPPED', reason: 'Later' } });
    expect(history[2]?.metadata).toMatchObject({ undo: true });
    expect(history.every((e) => e.occurredAt instanceof Date && e.actor.userId.length === 36)).toBe(true);
    // Only this Run's events.
    expect((await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: other.run.id })).map((e) => e.type)).toEqual([
      'RUN_STARTED',
    ]);
  });

  it('shows a Procedure’s changes, also after deletion', async () => {
    const created = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const id = created.procedure.id;
    await updateProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id, expectedRevision: 1, content: { ...PROCEDURE, title: 'Renamed' } });
    await deleteProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id });
    expect((await getProcedureHistory(deps, { actor: guest, workspaceId: home.id, procedureId: id })).map((e) => e.type)).toEqual([
      'PROCEDURE_CREATED',
      'PROCEDURE_UPDATED',
      'PROCEDURE_DELETED',
    ]);
    await restoreProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id });
    const history = await getProcedureHistory(deps, { actor: member, workspaceId: home.id, procedureId: id });
    expect(history.at(-1)).toMatchObject({ type: 'PROCEDURE_RESTORED', actor: { displayName: 'Ada' } });
    // Sections were re-sent without ids, so they were replaced: the summary says so.
    expect(history[1]?.metadata).toMatchObject({ fields: ['title', 'structure'], revision: 2, sectionsAdded: 1, sectionsRemoved: 1 });
  });

  it('never crosses Workspaces', async () => {
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: member.email, role: 'ADMIN' });
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const run = await startRun(runDeps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id });
    // Uma administers Office: Home ids through Office reveal nothing.
    await expect(getRunHistory(deps, { actor: member, workspaceId: office.id, runId: run.run.id })).rejects.toThrow(RunNotFoundError);
    expect(await getProcedureHistory(deps, { actor: member, workspaceId: office.id, procedureId: procedure.procedure.id })).toEqual([]);
    const outsider = await workspaceDeps.users.create({
      email: normalizeEmail('out@example.org'),
      displayName: 'Otto',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: false,
    });
    await expect(getRunHistory(deps, { actor: outsider, workspaceId: home.id, runId: run.run.id })).rejects.toThrow(WorkspaceNotFoundError);
    await expect(getProcedureHistory(deps, { actor: outsider, workspaceId: home.id, procedureId: procedure.procedure.id })).rejects.toThrow(
      WorkspaceNotFoundError,
    );
  });

  it('keeps the actor’s display name as it was at the time', async () => {
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const run = await startRun(runDeps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id });
    database.sqlite.prepare("UPDATE users SET display_name = 'Uma Renamed' WHERE id = ?").run(member.id);
    const history = await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: run.run.id });
    expect(history[0]?.actor.displayName).toBe('Uma');
  });
});

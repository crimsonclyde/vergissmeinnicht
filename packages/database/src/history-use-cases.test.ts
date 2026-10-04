import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidCursorError,
  ProcedureNotFoundError,
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
import { normalizeEmail, type RunId, type RunStepId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createAuditHistory } from './audit-events.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

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

    const history = (await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).items;
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
    expect((await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: other.run.id })).items.map((e) => e.type)).toEqual([
      'RUN_STARTED',
    ]);
  });

  it('shows a Procedure’s changes, also after deletion', async () => {
    const created = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const id = created.procedure.id;
    await updateProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id, expectedRevision: 1, content: { ...PROCEDURE, title: 'Renamed' } });
    await deleteProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id });
    expect((await getProcedureHistory(deps, { actor: guest, workspaceId: home.id, procedureId: id })).items.map((e) => e.type)).toEqual([
      'PROCEDURE_CREATED',
      'PROCEDURE_UPDATED',
      'PROCEDURE_DELETED',
    ]);
    await restoreProcedure(procedureDeps, { actor: admin, workspaceId: home.id, procedureId: id });
    const history = (await getProcedureHistory(deps, { actor: member, workspaceId: home.id, procedureId: id })).items;
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
    await expect(getProcedureHistory(deps, { actor: member, workspaceId: office.id, procedureId: procedure.procedure.id })).rejects.toThrow(
      ProcedureNotFoundError,
    );
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
    const history = (await getRunHistory(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).items;
    expect(history[0]?.actor.displayName).toBe('Uma');
  });

  it('pages Run lists and histories with cursors scoped to the same list', async () => {
    const procedure = await createProcedure(procedureDeps, { actor: admin, workspaceId: home.id, content: PROCEDURE });
    const started: RunId[] = [];
    for (let i = 0; i < 5; i += 1) {
      started.push((await startRun(runDeps, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id })).run.id);
    }
    const runs = runDeps.runs;
    const all = await runs.list(home.id, { limit: 100 });
    expect(all.nextCursor).toBeNull();
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 5; pageNo += 1) {
      const page = await runs.list(home.id, { limit: 2, before: cursor });
      seen.push(...page.items.map((item) => item.run.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    // Same order as one big page, nothing twice, nothing missing.
    expect(seen).toEqual(all.items.map((item) => item.run.id));
    expect(new Set(seen)).toEqual(new Set(started));

    // A Run of another Workspace, or one not matching the state filter, is no cursor.
    const foreign = await createProcedure(procedureDeps, { actor: admin, workspaceId: office.id, content: PROCEDURE });
    const officeRun = await startRun(runDeps, { actor: admin, workspaceId: office.id, procedureId: foreign.procedure.id });
    await expect(runs.list(home.id, { limit: 2, before: officeRun.run.id })).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(runs.list(home.id, { limit: 2, before: started[0], state: 'COMPLETED' })).rejects.toBeInstanceOf(InvalidCursorError);

    // History: 1 start + 4 changes of one Run, pages of 2.
    const runId = started[0] as RunId;
    const stepId = (await runs.find(home.id, runId))?.sections[0]?.steps[0]?.id as RunStepId;
    const change = (expectedState: 'PENDING' | 'DONE', to: 'PENDING' | 'DONE') =>
      changeStepState(runDeps, { actor: member, workspaceId: home.id, runId, stepId, expectedState, to });
    await change('PENDING', 'DONE');
    await change('DONE', 'PENDING');
    await change('PENDING', 'DONE');
    await change('DONE', 'PENDING');
    const history = createAuditHistory(database);
    const full = await history.forRun(home.id, runId, { limit: 100 });
    const first = await history.forRun(home.id, runId, { limit: 2 });
    const second = await history.forRun(home.id, runId, { limit: 2, after: first?.nextCursor ?? undefined });
    const third = await history.forRun(home.id, runId, { limit: 2, after: second?.nextCursor ?? undefined });
    expect([...(first?.items ?? []), ...(second?.items ?? []), ...(third?.items ?? [])].map((event) => event.id)).toEqual(
      full?.items.map((event) => event.id),
    );
    expect(third?.nextCursor).toBeNull();
    // An event of another Run (same Workspace) or another list is rejected as a cursor.
    const otherRunEvent = (await history.forRun(home.id, started[1] as RunId, { limit: 1 }))?.items[0]?.id;
    await expect(history.forRun(home.id, runId, { limit: 2, after: otherRunEvent })).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(history.forProcedure(home.id, procedure.procedure.id, { limit: 2, after: first?.items[0]?.id })).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });
});

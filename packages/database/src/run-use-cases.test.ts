import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  ProcedureHasNoStepsError,
  ProcedureNotFoundError,
  RunLimitReachedError,
  RunNotFoundError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getRun,
  listRuns,
  startRun,
  updateProcedure,
  type ProcedureDeps,
  type ProcedureDetail,
  type ProcedureInput,
  type RunDeps,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type RunDetail, type RunId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const step = (title: string, extra: object = {}) => ({
  title,
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL' as const,
  notApplicableReasonPolicy: 'OPTIONAL' as const,
  ...extra,
});
const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: 'Daily',
  icon: 'home',
  tags: ['daily'],
  sections: [
    { title: 'Kitchen', description: 'First', steps: [step('Stove off', { critical: true, icon: 'kitchen', skipReasonPolicy: 'DISABLED' })] },
    { title: 'Door', description: '', steps: [step('Lock door', { notApplicableReasonPolicy: 'REQUIRED' }), step('Lights', { required: false })] },
  ],
};

/** The definition part of a Run (without ids and state), for comparing snapshots. */
const definition = (detail: RunDetail) => ({
  title: detail.run.title,
  description: detail.run.description,
  icon: detail.run.icon,
  tags: detail.run.tags,
  sections: detail.sections.map((section) => ({
    title: section.title,
    description: section.description,
    steps: section.steps.map((s) => ({
      kind: s.kind,
      title: s.title,
      description: s.description,
      icon: s.icon,
      required: s.required,
      critical: s.critical,
      skipReasonPolicy: s.skipReasonPolicy,
      notApplicableReasonPolicy: s.notApplicableReasonPolicy,
    })),
  })),
});

describe('Run start (immutable snapshot)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let procedureDeps: ProcedureDeps;
  let deps: RunDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let guest: User;
  let home: Workspace;
  let office: Workspace;
  let procedure: ProcedureDetail;

  const start = (actor: User, procedureId = procedure.procedure.id, workspace = home) =>
    startRun(deps, { actor, workspaceId: workspace.id, procedureId });
  const count = (table: string) => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeEach(async () => {
    database = createTestDatabase();
    const clock = { now: () => new Date() };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    procedureDeps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, runs: createRunRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    editor = await user('editor@example.org', 'Eddie');
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    for (const [u, role] of [
      [editor, 'EDITOR'],
      [member, 'USER'],
      [guest, 'GUEST'],
    ] as const) {
      await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: u.email, role });
    }
    procedure = await createProcedure(procedureDeps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
  });

  afterEach(() => database.dispose());

  it('copies the full definition into a new ACTIVE Run with PENDING Steps and new ids', async () => {
    const run = await start(member);
    expect(run.run).toMatchObject({
      state: 'ACTIVE',
      procedureId: procedure.procedure.id,
      procedureRevision: 1,
      startedBy: { userId: member.id, displayName: 'Uma' },
    });
    expect(definition(run)).toEqual({
      title: 'Leave the house',
      description: 'Daily',
      icon: 'home',
      tags: ['daily'],
      sections: [
        { title: 'Kitchen', description: 'First', steps: [{ ...step('Stove off', { critical: true, icon: 'kitchen', skipReasonPolicy: 'DISABLED' }), kind: 'CHECK' }] },
        {
          title: 'Door',
          description: '',
          steps: [
            { ...step('Lock door', { notApplicableReasonPolicy: 'REQUIRED' }), kind: 'CHECK' },
            { ...step('Lights', { required: false }), kind: 'CHECK' },
          ],
        },
      ],
    });
    expect(run.sections.flatMap((s) => s.steps.map((st) => st.state))).toEqual(['PENDING', 'PENDING', 'PENDING']);
    const procedureIds = new Set<string>([...procedure.sections.map((s) => s.id), ...procedure.sections.flatMap((s) => s.steps.map((st) => st.id))]);
    expect([...run.sections.map((s) => s.id), ...run.sections.flatMap((s) => s.steps.map((st) => st.id))].some((id) => procedureIds.has(id))).toBe(
      false,
    );
    const audit = database.sqlite.prepare("SELECT type, run_id, actor_display_name AS name, metadata FROM audit_events WHERE type = 'RUN_STARTED'").get() as {
      run_id: string;
      name: string;
      metadata: string;
    };
    expect(audit).toMatchObject({ run_id: run.run.id, name: 'Uma' });
    expect(JSON.parse(audit.metadata)).toEqual({ procedureId: procedure.procedure.id, procedureRevision: 1, title: 'Leave the house', steps: 3 });
  });

  it('stays unchanged when the Procedure is edited, restructured or deleted', async () => {
    const run = await start(member);
    const before = definition(run);
    await updateProcedure(procedureDeps, {
      actor: editor,
      workspaceId: home.id,
      procedureId: procedure.procedure.id,
      expectedRevision: 1,
      content: { ...PROCEDURE, title: 'Renamed', sections: [{ title: 'Only', description: '', steps: [step('Different', { critical: true })] }] },
    });
    expect(definition(await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id }))).toEqual(before);

    await deleteProcedure(procedureDeps, { actor: editor, workspaceId: home.id, procedureId: procedure.procedure.id });
    const afterDelete = await getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id });
    expect(definition(afterDelete)).toEqual(before);
    expect(afterDelete.run.procedureRevision).toBe(1);
    // A deleted Procedure cannot start new Runs.
    await expect(start(member)).rejects.toThrow(ProcedureNotFoundError);
  });

  it('allows several active Runs of the same Procedure, each with its own snapshot', async () => {
    const first = await start(member);
    await updateProcedure(procedureDeps, {
      actor: editor,
      workspaceId: home.id,
      procedureId: procedure.procedure.id,
      expectedRevision: 1,
      content: { ...PROCEDURE, title: 'Leave the flat' },
    });
    const second = await start(editor);
    const third = await start(admin);
    expect(new Set([first.run.id, second.run.id, third.run.id]).size).toBe(3);
    expect([first.run.title, second.run.title, second.run.procedureRevision]).toEqual(['Leave the house', 'Leave the flat', 2]);
    const listed = (await listRuns(deps, { actor: guest, workspaceId: home.id, state: 'ACTIVE' })).items;
    expect(listed.map((summary) => summary.run.id).sort()).toEqual([first.run.id, second.run.id, third.run.id].sort());
    expect(listed[0]?.stepCounts).toEqual({ PENDING: 3, DONE: 0, SKIPPED: 0, NOT_APPLICABLE: 0 });
    expect(await listRuns(deps, { actor: guest, workspaceId: home.id, state: 'COMPLETED' })).toEqual({ items: [], nextCursor: null });
  });

  describe('authorization and Workspace scoping', () => {
    it('lets USER and above start Runs; GUEST may only view', async () => {
      await expect(start(guest)).rejects.toThrow(NotAuthorizedError);
      const run = await start(member);
      await expect(getRun(deps, { actor: guest, workspaceId: home.id, runId: run.run.id })).resolves.toBeDefined();
      expect(count('runs')).toBe(1);
    });

    it('treats Run and Procedure ids from other Workspaces as unknown', async () => {
      await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: editor.email, role: 'ADMIN' });
      const officeProcedure = await createProcedure(procedureDeps, { actor: editor, workspaceId: office.id, content: PROCEDURE });
      const officeRun = await start(editor, officeProcedure.procedure.id, office);
      // Editor is in both Workspaces, but ids never cross the Workspace given in the call.
      await expect(start(editor, officeProcedure.procedure.id, home)).rejects.toThrow(ProcedureNotFoundError);
      await expect(getRun(deps, { actor: editor, workspaceId: home.id, runId: officeRun.run.id })).rejects.toThrow(RunNotFoundError);
      expect(await listRuns(deps, { actor: editor, workspaceId: home.id })).toEqual({ items: [], nextCursor: null });
      await expect(listRuns(deps, { actor: member, workspaceId: office.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(getRun(deps, { actor: member, workspaceId: office.id, runId: officeRun.run.id })).rejects.toThrow(WorkspaceNotFoundError);
    });

    it('re-checks the starter’s role inside the transaction', async () => {
      const runs = createRunRepository(database);
      const racing: RunDeps = {
        ...deps,
        runs: {
          ...runs,
          async start(...args) {
            await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: member.id, role: 'GUEST' });
            return runs.start(...args);
          },
        },
      };
      await expect(startRun(racing, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id })).rejects.toThrow(
        NotAuthorizedError,
      );
      expect(count('runs')).toBe(0);
    });

    it('rejects unknown Run ids', async () => {
      await expect(
        getRun(deps, { actor: member, workspaceId: home.id, runId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' as RunId }),
      ).rejects.toThrow(RunNotFoundError);
    });
  });

  describe('preconditions and limits', () => {
    it('refuses Procedures without Steps', async () => {
      const empty = await createProcedure(procedureDeps, {
        actor: editor,
        workspaceId: home.id,
        content: { ...PROCEDURE, title: 'Empty', sections: [{ title: 'Nothing yet', description: '', steps: [] }] },
      });
      await expect(start(member, empty.procedure.id)).rejects.toThrow(ProcedureHasNoStepsError);
    });

    it('bounds active Runs per Workspace', async () => {
      await start(member);
      const repository = createRunRepository(database);
      const actor = { kind: 'user', userId: member.id, displayName: 'Uma' } as const;
      expect(
        await repository.start({ workspaceId: home.id, procedureId: procedure.procedure.id, at: new Date(), maxActive: 1 }, actor, {
          actorMay: () => true,
        }),
      ).toEqual({ status: 'limit_reached' });
      const full: RunDeps = { ...deps, runs: { ...repository, start: async () => ({ status: 'limit_reached' }) } };
      await expect(startRun(full, { actor: member, workspaceId: home.id, procedureId: procedure.procedure.id })).rejects.toThrow(
        RunLimitReachedError,
      );
    });
  });

  describe('database guarantees', () => {
    it('keeps the snapshot immutable but lets execution state change', async () => {
      const run = await start(member);
      const firstStep = run.sections[0]?.steps[0]?.id;
      const exec = (sql: string, ...params: unknown[]) => () => database.sqlite.prepare(sql).run(...params);
      expect(exec("UPDATE runs SET title = 'Forged' WHERE id = ?", run.run.id)).toThrow(/immutable/);
      expect(exec('UPDATE runs SET started_by_user_id = ? WHERE id = ?', admin.id, run.run.id)).toThrow(/immutable/);
      expect(exec("UPDATE run_sections SET title = 'Forged'")).toThrow(/immutable/);
      expect(exec("UPDATE run_steps SET title = 'Forged' WHERE id = ?", firstStep)).toThrow(/immutable/);
      expect(exec('UPDATE run_steps SET required = 0 WHERE id = ?', firstStep)).toThrow(/immutable/);
      expect(exec('DELETE FROM run_steps')).toThrow(/never deleted/);
      expect(exec('DELETE FROM run_sections')).toThrow(/never deleted/);
      expect(exec('DELETE FROM runs')).toThrow(/never deleted/);
      // Execution state stays writable for Steps 5.2 / 5.4.
      expect(exec("UPDATE run_steps SET state = 'DONE' WHERE id = ?", firstStep)).not.toThrow();
      expect(exec("UPDATE run_steps SET state = 'MAYBE' WHERE id = ?", firstStep)).toThrow(/CHECK/);
      expect(exec("UPDATE run_steps SET state_reason = 'why' WHERE id = ?", firstStep)).toThrow(/CHECK/);
      expect(exec('UPDATE run_steps SET state_changed_at = 1 WHERE id = ?', firstStep)).toThrow(/CHECK/);
      expect(exec("UPDATE runs SET state = 'COMPLETED' WHERE id = ?", run.run.id)).toThrow(/CHECK/);
      expect(
        exec(
          "UPDATE runs SET state = 'COMPLETED', revision = 2, ended_at = 1, ended_by_user_id = ?, ended_by_display_name = 'Uma' WHERE id = ?",
          member.id,
          run.run.id,
        ),
      ).not.toThrow();
      expect(exec("UPDATE runs SET state = 'ACTIVE', ended_at = NULL WHERE id = ?", run.run.id)).toThrow(/finished/);
      // Once the Run is no longer ACTIVE its execution state is frozen too.
      expect(exec("UPDATE run_steps SET state = 'PENDING' WHERE id = ?", firstStep)).toThrow(/not active/);
    });

    it('never lets a Procedure hard delete remove Runs', async () => {
      await start(member);
      expect(() => database.sqlite.prepare('DELETE FROM procedures WHERE id = ?').run(procedure.procedure.id)).toThrow(/FOREIGN KEY/);
    });

    it('writes nothing when the audit event cannot be written', async () => {
      database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
      await expect(start(member)).rejects.toThrow();
      expect([count('runs'), count('run_sections'), count('run_steps')]).toEqual([0, 0, 0]);
    });
  });
});

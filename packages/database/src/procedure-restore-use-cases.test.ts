import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  ProcedureLimitReachedError,
  ProcedureNotFoundError,
  WorkspaceNotFoundError,
  addMember,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getProcedure,
  listDeletedProcedures,
  listProcedures,
  restoreProcedure,
  type ProcedureDeps,
  type ProcedureInput,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
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
      title: 'Kitchen',
      description: '',
      steps: [
        {
          title: 'Stove off',
          description: '',
          icon: null,
          required: true,
          critical: true,
          skipReasonPolicy: 'DISABLED',
          notApplicableReasonPolicy: 'OPTIONAL',
        },
      ],
    },
  ],
};

describe('Procedure soft deletion and restore', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: ProcedureDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let guest: User;
  let home: Workspace;
  let office: Workspace;

  const auditTypes = () => (database.sqlite.prepare('SELECT type FROM audit_events ORDER BY rowid').all() as { type: string }[]).map((r) => r.type);
  async function createAndDelete(workspace = home) {
    const created = await createProcedure(deps, { actor: editor, workspaceId: workspace.id, content: PROCEDURE });
    await deleteProcedure(deps, { actor: editor, workspaceId: workspace.id, procedureId: created.procedure.id });
    return created;
  }

  beforeEach(async () => {
    database = createTestDatabase();
    const clock = { now: () => new Date() };
    const users = createUserRepository(database);
    workspaceDeps = { users, workspaces: createWorkspaceRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) =>
      users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    editor = await user('editor@example.org', 'Eddie');
    member = await user('user@example.org', 'Uma');
    guest = await user('guest@example.org', 'Gus');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    for (const [user, role] of [
      [editor, 'EDITOR'],
      [member, 'USER'],
      [guest, 'GUEST'],
    ] as const) {
      await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: user.email, role });
    }
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: editor.email, role: 'EDITOR' });
  });

  afterEach(() => database.dispose());

  it('lists deleted Procedures with who deleted them, and restores them with their structure', async () => {
    const created = await createAndDelete();
    const deleted = await listDeletedProcedures(deps, { actor: admin, workspaceId: home.id });
    expect(deleted.map((d) => [d.procedure.title, d.deletedBy.displayName])).toEqual([['Leave the house', 'Eddie']]);

    const restored = await restoreProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id });
    expect(restored.procedure.revision).toBe(2);
    expect(restored.sections).toEqual(created.sections);
    expect((await listProcedures(deps, { actor: guest, workspaceId: home.id })).map((p) => p.id)).toEqual([created.procedure.id]);
    expect(await listDeletedProcedures(deps, { actor: editor, workspaceId: home.id })).toEqual([]);
    expect(auditTypes()).toEqual(['PROCEDURE_CREATED', 'PROCEDURE_DELETED', 'PROCEDURE_RESTORED']);
  });

  it('is only available to roles with procedure.restore', async () => {
    const created = await createAndDelete();
    for (const actor of [member, guest]) {
      await expect(listDeletedProcedures(deps, { actor, workspaceId: home.id })).rejects.toThrow(NotAuthorizedError);
      await expect(restoreProcedure(deps, { actor, workspaceId: home.id, procedureId: created.procedure.id })).rejects.toThrow(
        NotAuthorizedError,
      );
    }
    const outsider = await workspaceDeps.users.create({
      email: normalizeEmail('out@example.org'),
      displayName: 'Otto',
      emailVerified: true,
      status: 'ACTIVE',
      serverAdmin: false,
    });
    await expect(listDeletedProcedures(deps, { actor: outsider, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
  });

  it('only restores deleted Procedures of the same Workspace', async () => {
    const homeDeleted = await createAndDelete(home);
    const active = await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
    await expect(restoreProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: active.procedure.id })).rejects.toThrow(
      ProcedureNotFoundError,
    );
    // Editor of both Workspaces cannot restore a Home Procedure through Office.
    await expect(restoreProcedure(deps, { actor: editor, workspaceId: office.id, procedureId: homeDeleted.procedure.id })).rejects.toThrow(
      ProcedureNotFoundError,
    );
    expect(await listDeletedProcedures(deps, { actor: editor, workspaceId: office.id })).toEqual([]);
    await expect(getProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: homeDeleted.procedure.id })).rejects.toThrow(
      ProcedureNotFoundError,
    );
  });

  it('counts against the per-Workspace limit', async () => {
    const created = await createAndDelete();
    const repository = createProcedureRepository(database);
    const actor = { kind: 'user', userId: editor.id, displayName: editor.displayName } as const;
    const guard = { actorMay: () => true };
    await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
    expect(
      await repository.restore({ workspaceId: home.id, procedureId: created.procedure.id, at: new Date(), maxActive: 1 }, actor, guard),
    ).toEqual({ status: 'limit_reached' });
    const full: ProcedureDeps = { ...deps, procedures: { ...repository, restore: async () => ({ status: 'limit_reached' }) } };
    await expect(restoreProcedure(full, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id })).rejects.toThrow(
      ProcedureLimitReachedError,
    );
  });

  it('restores only once', async () => {
    const created = await createAndDelete();
    await restoreProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id });
    await expect(restoreProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id })).rejects.toThrow(
      ProcedureNotFoundError,
    );
  });
});

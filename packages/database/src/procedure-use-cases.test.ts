import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  ProcedureConflictError,
  ProcedureLimitReachedError,
  ProcedureNotFoundError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getProcedure,
  listProcedures,
  removeMember,
  updateProcedure,
  type ProcedureDeps,
  type ProcedureInput,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  DomainValidationError,
  normalizeEmail,
  type ProcedureId,
  type User,
  type Workspace,
  type WorkspaceRole,
} from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const LEAVE_HOUSE: ProcedureInput = {
  title: 'Leave the house',
  description: 'Before a trip.',
  icon: 'home',
  tags: ['travel'],
  sections: [],
};

describe('Procedure use-cases', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: ProcedureDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let guest: User;
  let outsider: User;
  let home: Workspace;
  let office: Workspace;

  const auditEvents = () =>
    database.sqlite
      .prepare('SELECT type, actor_user_id AS actor, actor_display_name AS name, subject_id AS subject, metadata FROM audit_events ORDER BY rowid')
      .all() as { type: string; actor: string; name: string; subject: string; metadata: string }[];

  async function createUser(email: string, name: string, serverAdmin = false) {
    return workspaceDeps.users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
  }
  const join = (workspace: Workspace, user: User, role: WorkspaceRole) =>
    addMember(workspaceDeps, { actor: admin, workspaceId: workspace.id, email: user.email, role });
  const create = async (actor: User, workspace = home, content = LEAVE_HOUSE) =>
    (await createProcedure(deps, { actor, workspaceId: workspace.id, content })).procedure;

  beforeEach(async () => {
    database = createTestDatabase();
    const clock = { now: () => new Date() };
    workspaceDeps = { users: createUserRepository(database), workspaces: createWorkspaceRepository(database), clock };
    deps = { workspaces: workspaceDeps.workspaces, procedures: createProcedureRepository(database), clock };
    admin = await createUser('admin@example.org', 'Ada', true);
    editor = await createUser('editor@example.org', 'Eddie');
    member = await createUser('user@example.org', 'Uma');
    guest = await createUser('guest@example.org', 'Gus');
    outsider = await createUser('outsider@example.org', 'Otto');
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await join(home, editor, 'EDITOR');
    await join(home, member, 'USER');
    await join(home, guest, 'GUEST');
    await join(office, outsider, 'EDITOR');
  });

  afterEach(() => database.dispose());

  describe('authoring', () => {
    it('lets EDITOR and ADMIN create, edit and soft-delete, each change audited atomically', async () => {
      const created = await create(editor);
      expect(created).toMatchObject({ title: 'Leave the house', icon: 'home', tags: ['travel'], revision: 1, workspaceId: home.id });
      const updated = await updateProcedure(deps, {
        actor: admin,
        workspaceId: home.id,
        procedureId: created.id,
        expectedRevision: 1,
        content: { ...LEAVE_HOUSE, title: 'Leave the flat', tags: ['travel', 'daily'] },
      });
      expect(updated.procedure).toMatchObject({ title: 'Leave the flat', revision: 2 });
      await deleteProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.id });

      const events = auditEvents();
      expect(events.map((e) => [e.type, e.name])).toEqual([
        ['PROCEDURE_CREATED', 'Eddie'],
        ['PROCEDURE_UPDATED', 'Ada'],
        ['PROCEDURE_DELETED', 'Eddie'],
      ]);
      expect(events.every((e) => e.subject === created.id)).toBe(true);
      expect(JSON.parse(events[1]?.metadata ?? 'null')).toEqual({ fields: ['title', 'tags'], revision: 2 });
    });

    it.each([
      ['USER', () => member],
      ['GUEST', () => guest],
    ] as const)('refuses all authoring by %s', async (_role, actor) => {
      const existing = await create(editor);
      await expect(create(actor())).rejects.toThrow(NotAuthorizedError);
      await expect(
        updateProcedure(deps, { actor: actor(), workspaceId: home.id, procedureId: existing.id, expectedRevision: 1, content: LEAVE_HOUSE }),
      ).rejects.toThrow(NotAuthorizedError);
      await expect(deleteProcedure(deps, { actor: actor(), workspaceId: home.id, procedureId: existing.id })).rejects.toThrow(
        NotAuthorizedError,
      );
      expect((await getProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: existing.id })).procedure.revision).toBe(1);
    });

    it('validates content before writing anything', async () => {
      await expect(create(editor, home, { ...LEAVE_HOUSE, icon: '<svg/onload=alert(1)>' })).rejects.toThrow(
        DomainValidationError,
      );
      await expect(create(editor, home, { ...LEAVE_HOUSE, title: ' ' })).rejects.toThrow(DomainValidationError);
      expect(await listProcedures(deps, { actor: editor, workspaceId: home.id })).toEqual([]);
      expect(auditEvents()).toEqual([]);
    });

    it('re-checks the actor inside the write transaction', async () => {
      const procedures = createProcedureRepository(database);
      const racing: ProcedureDeps = {
        ...deps,
        procedures: {
          ...procedures,
          async create(...args) {
            await changeMemberRole(workspaceDeps, { actor: admin, workspaceId: home.id, userId: editor.id, role: 'USER' });
            return procedures.create(...args);
          },
        },
      };
      await expect(createProcedure(racing, { actor: editor, workspaceId: home.id, content: LEAVE_HOUSE })).rejects.toThrow(
        NotAuthorizedError,
      );
      expect(await listProcedures(deps, { actor: admin, workspaceId: home.id })).toEqual([]);
    });

    it('bounds the number of Procedures per Workspace', async () => {
      await create(editor);
      const repository = createProcedureRepository(database);
      const actor = { kind: 'user', userId: editor.id, displayName: editor.displayName } as const;
      const guard = { actorMay: () => true };
      const content = { ...LEAVE_HOUSE, icon: 'home', tags: [] } as const;
      const structure = { sections: [] };
      expect(await repository.create({ workspaceId: home.id, content, structure, origin: { kind: 'created' }, at: new Date(), maxActive: 1 }, actor, guard)).toEqual({
        status: 'limit_reached',
      });
      expect(
        (await repository.create({ workspaceId: home.id, content, structure, origin: { kind: 'created' }, at: new Date(), maxActive: 2 }, actor, guard)).status,
      ).toBe('ok');
      const full: ProcedureDeps = {
        ...deps,
        procedures: { ...repository, create: async () => ({ status: 'limit_reached' }) },
      };
      await expect(createProcedure(full, { actor: editor, workspaceId: home.id, content: LEAVE_HOUSE })).rejects.toThrow(
        ProcedureLimitReachedError,
      );
    });
  });

  describe('lost updates', () => {
    it('rejects an edit based on an outdated revision and keeps the newer content', async () => {
      const created = await create(editor);
      const edit = (actor: User, title: string) =>
        updateProcedure(deps, { actor, workspaceId: home.id, procedureId: created.id, expectedRevision: 1, content: { ...LEAVE_HOUSE, title } });
      await edit(editor, 'First');
      await expect(edit(admin, 'Second')).rejects.toThrow(ProcedureConflictError);
      expect((await getProcedure(deps, { actor: guest, workspaceId: home.id, procedureId: created.id })).procedure.title).toBe('First');
    });

    it('does not bump the revision or audit when nothing changed', async () => {
      const created = await create(editor);
      const same = await updateProcedure(deps, {
        actor: editor,
        workspaceId: home.id,
        procedureId: created.id,
        expectedRevision: 1,
        content: { ...LEAVE_HOUSE, title: '  Leave the house ' },
      });
      expect(same.procedure.revision).toBe(1);
      expect(auditEvents()).toHaveLength(1);
    });
  });

  describe('Workspace-wide visibility (3.3)', () => {
    it('shows every non-deleted Procedure to all roles of the Workspace', async () => {
      await create(editor, home, { ...LEAVE_HOUSE, title: 'Zeta' });
      await create(admin, home, { ...LEAVE_HOUSE, title: 'Alpha' });
      for (const actor of [admin, editor, member, guest]) {
        expect((await listProcedures(deps, { actor, workspaceId: home.id })).map((p) => p.title)).toEqual(['Alpha', 'Zeta']);
      }
    });

    it('hides soft-deleted Procedures but keeps the row', async () => {
      const created = await create(editor);
      await deleteProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.id });
      expect(await listProcedures(deps, { actor: admin, workspaceId: home.id })).toEqual([]);
      for (const call of [
        () => getProcedure(deps, { actor: admin, workspaceId: home.id, procedureId: created.id }),
        () => deleteProcedure(deps, { actor: admin, workspaceId: home.id, procedureId: created.id }),
        () =>
          updateProcedure(deps, { actor: admin, workspaceId: home.id, procedureId: created.id, expectedRevision: 1, content: LEAVE_HOUSE }),
      ]) {
        await expect(call()).rejects.toThrow(ProcedureNotFoundError);
      }
      const row = database.sqlite.prepare('SELECT deleted_at, deleted_by_user_id FROM procedures WHERE id = ?').get(created.id) as {
        deleted_at: number;
        deleted_by_user_id: string;
      };
      expect(row.deleted_by_user_id).toBe(editor.id);
    });
  });

  describe('Workspace isolation (child cannot bypass parent)', () => {
    it('treats a Procedure id from another Workspace as unknown, even for that Workspace’s editor', async () => {
      const officeProcedure = await create(outsider, office);
      // Otto edits Office; reaching the Office Procedure through Home is impossible for anyone.
      for (const actor of [admin, editor]) {
        await expect(getProcedure(deps, { actor, workspaceId: home.id, procedureId: officeProcedure.id })).rejects.toThrow(
          ProcedureNotFoundError,
        );
        await expect(
          updateProcedure(deps, { actor, workspaceId: home.id, procedureId: officeProcedure.id, expectedRevision: 1, content: LEAVE_HOUSE }),
        ).rejects.toThrow(ProcedureNotFoundError);
        await expect(deleteProcedure(deps, { actor, workspaceId: home.id, procedureId: officeProcedure.id })).rejects.toThrow(
          ProcedureNotFoundError,
        );
      }
      expect((await getProcedure(deps, { actor: outsider, workspaceId: office.id, procedureId: officeProcedure.id })).procedure.revision).toBe(1);
    });

    it('denies non-members exactly like an unknown Workspace', async () => {
      const created = await create(editor);
      await expect(listProcedures(deps, { actor: outsider, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(getProcedure(deps, { actor: outsider, workspaceId: home.id, procedureId: created.id })).rejects.toThrow(
        WorkspaceNotFoundError,
      );
      await expect(create(outsider)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(
        updateProcedure(deps, { actor: outsider, workspaceId: home.id, procedureId: created.id, expectedRevision: 1, content: LEAVE_HOUSE }),
      ).rejects.toThrow(WorkspaceNotFoundError);
      await expect(deleteProcedure(deps, { actor: outsider, workspaceId: home.id, procedureId: created.id })).rejects.toThrow(
        WorkspaceNotFoundError,
      );
    });

    it('revokes access after removal on the next call', async () => {
      await create(editor);
      await removeMember(workspaceDeps, { actor: admin, workspaceId: home.id, userId: editor.id });
      await expect(listProcedures(deps, { actor: editor, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(create(editor)).rejects.toThrow(WorkspaceNotFoundError);
    });

    it('rejects unknown ids', async () => {
      await expect(
        getProcedure(deps, { actor: admin, workspaceId: home.id, procedureId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' as ProcedureId }),
      ).rejects.toThrow(ProcedureNotFoundError);
    });
  });

  describe('storage', () => {
    it('rolls back the Procedure change when the audit event cannot be written', async () => {
      const created = await create(editor);
      database.sqlite.exec(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'no'); END`);
      await expect(create(editor)).rejects.toThrow();
      await expect(deleteProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.id })).rejects.toThrow();
      expect((await listProcedures(deps, { actor: editor, workspaceId: home.id })).map((p) => p.id)).toEqual([created.id]);
    });

    it('keeps audit events append-only', async () => {
      await create(editor);
      expect(() => database.sqlite.prepare("UPDATE audit_events SET type = 'X'").run()).toThrow(/append-only/);
      expect(() => database.sqlite.prepare('DELETE FROM audit_events').run()).toThrow(/append-only/);
    });

    it('enforces icon, tags, deletion and Workspace constraints in the database', async () => {
      const created = await create(editor);
      const update = (sql: string) => () => database.sqlite.prepare(sql).run(created.id);
      // Icons are rows of procedure_icons (migration 0019); anything else is refused by the reference.
      expect(update("UPDATE procedures SET icon = 'javascript:alert(1)' WHERE id = ?")).toThrow(/FOREIGN KEY/);
      expect(update("UPDATE procedures SET icon = 'offboarding' WHERE id = ?")).not.toThrow();
      expect(update(`UPDATE procedures SET tags = '{"a":1}' WHERE id = ?`)).toThrow(/CHECK/);
      expect(update(`UPDATE procedures SET tags = '[${Array(11).fill('"x"').join(',')}]' WHERE id = ?`)).toThrow(/CHECK/);
      expect(update('UPDATE procedures SET deleted_at = 1 WHERE id = ?')).toThrow(/CHECK/);
      expect(update("UPDATE procedures SET workspace_id = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' WHERE id = ?")).toThrow(/FOREIGN KEY/);
    });
  });
});

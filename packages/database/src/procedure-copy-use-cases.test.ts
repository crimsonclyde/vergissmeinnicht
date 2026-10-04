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
  duplicateProcedure,
  importProcedure,
  type ProcedureDeps,
  type ProcedureInput,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, copyTitle, normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const PROCEDURE: ProcedureInput = {
  title: 'Leave the house',
  description: 'Daily',
  icon: 'home',
  tags: ['daily'],
  sections: [
    {
      title: 'Kitchen',
      description: '',
      steps: [
        {
          title: 'Stove off',
          description: '',
          icon: 'kitchen',
          required: true,
          critical: true,
          skipReasonPolicy: 'DISABLED',
          notApplicableReasonPolicy: 'REQUIRED',
        },
      ],
    },
  ],
};

describe('Procedure duplicate and import', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: ProcedureDeps;
  let admin: User;
  let editor: User;
  let member: User;
  let home: Workspace;
  let office: Workspace;

  const ids = (detail: { procedure: { id: string }; sections: readonly { id: string; steps: readonly { id: string }[] }[] }) => [
    detail.procedure.id,
    ...detail.sections.flatMap((s) => [s.id, ...s.steps.map((st) => st.id)]),
  ];
  const lastAudit = () =>
    JSON.parse(
      (database.sqlite.prepare('SELECT metadata FROM audit_events ORDER BY rowid DESC LIMIT 1').get() as { metadata: string }).metadata,
    ) as Record<string, unknown>;

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
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: editor.email, role: 'EDITOR' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
  });

  afterEach(() => database.dispose());

  describe('duplicate', () => {
    it('copies content and structure with new ids and an audited origin', async () => {
      const source = await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
      const copy = await duplicateProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: source.procedure.id });
      expect(copy.procedure.title).toBe('Leave the house (copy)');
      expect(copy.sections[0]?.steps[0]).toMatchObject({ title: 'Stove off', critical: true, notApplicableReasonPolicy: 'REQUIRED' });
      const sourceIds = new Set(ids(source));
      expect(ids(copy).some((id) => sourceIds.has(id))).toBe(false);
      expect(lastAudit()).toMatchObject({ origin: 'duplicated', sourceProcedureId: source.procedure.id });
    });

    it('requires procedure.edit and stays inside the Workspace', async () => {
      const source = await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
      await expect(duplicateProcedure(deps, { actor: member, workspaceId: home.id, procedureId: source.procedure.id })).rejects.toThrow(
        NotAuthorizedError,
      );
      // Admin of Office cannot pull a Home Procedure into Office by id.
      await expect(duplicateProcedure(deps, { actor: admin, workspaceId: office.id, procedureId: source.procedure.id })).rejects.toThrow(
        ProcedureNotFoundError,
      );
      await deleteProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: source.procedure.id });
      await expect(duplicateProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: source.procedure.id })).rejects.toThrow(
        ProcedureNotFoundError,
      );
    });

    it('keeps copy titles within the limit', () => {
      expect([...copyTitle('x'.repeat(120))]).toHaveLength(120);
      expect(copyTitle('🌼'.repeat(120)).endsWith(' (copy)')).toBe(true);
      expect([...copyTitle('🌼'.repeat(120))]).toHaveLength(120);
    });

    it('counts against the per-Workspace limit', async () => {
      const source = await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
      const full: ProcedureDeps = { ...deps, procedures: { ...deps.procedures, create: async () => ({ status: 'limit_reached' }) } };
      await expect(duplicateProcedure(full, { actor: editor, workspaceId: home.id, procedureId: source.procedure.id })).rejects.toThrow(
        ProcedureLimitReachedError,
      );
    });
  });

  describe('import', () => {
    it('creates the content in the target Workspace with new ids and an audited origin', async () => {
      await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: editor.email, role: 'EDITOR' });
      const source = await createProcedure(deps, { actor: editor, workspaceId: home.id, content: PROCEDURE });
      const imported = await importProcedure(deps, { actor: editor, workspaceId: office.id, content: PROCEDURE });
      expect(imported.procedure.workspaceId).toBe(office.id);
      expect(imported.sections[0]?.steps[0]).toMatchObject({ title: 'Stove off', critical: true });
      const sourceIds = new Set(ids(source));
      expect(ids(imported).some((id) => sourceIds.has(id))).toBe(false);
      expect(lastAudit()).toMatchObject({ origin: 'imported' });
    });

    it('requires procedure.edit in the target Workspace', async () => {
      await expect(importProcedure(deps, { actor: member, workspaceId: home.id, content: PROCEDURE })).rejects.toThrow(NotAuthorizedError);
      await expect(importProcedure(deps, { actor: editor, workspaceId: office.id, content: PROCEDURE })).rejects.toThrow(
        WorkspaceNotFoundError,
      );
    });

    it('applies all domain rules to imported content before writing', async () => {
      const hostile = (patch: Partial<ProcedureInput>) => importProcedure(deps, { actor: editor, workspaceId: home.id, content: { ...PROCEDURE, ...patch } });
      await expect(hostile({ icon: 'javascript:alert(1)' })).rejects.toThrow(DomainValidationError);
      await expect(hostile({ title: 'bad‮title' })).rejects.toThrow(DomainValidationError);
      await expect(hostile({ description: 'x'.repeat(4001) })).rejects.toThrow(DomainValidationError);
      await expect(
        hostile({ sections: Array.from({ length: 51 }, () => ({ title: 'S', description: '', steps: [] })) }),
      ).rejects.toThrow(DomainValidationError);
      expect((database.sqlite.prepare('SELECT count(*) AS n FROM procedures').get() as { n: number }).n).toBe(0);
    });

    it('keeps new and old icon keys, and refuses unknown or malicious icon values without writing', async () => {
      const withIcons = (icon: string, stepIcon: string | null) =>
        importProcedure(deps, {
          actor: editor,
          workspaceId: home.id,
          content: {
            ...PROCEDURE,
            icon: icon as ProcedureInput['icon'],
            sections: PROCEDURE.sections.map((section) => ({ ...section, steps: section.steps.map((step) => ({ ...step, icon: stepIcon as ProcedureInput['icon'] })) })),
          },
        });
      const imported = await withIcons('freezer', 'gas');
      expect(imported.procedure.icon).toBe('freezer');
      expect(imported.sections[0]?.steps[0]?.icon).toBe('gas');
      expect(database.sqlite.prepare('SELECT icon FROM procedures WHERE id = ?').get(imported.procedure.id)).toEqual({ icon: 'freezer' });
      const before = (database.sqlite.prepare('SELECT count(*) AS n FROM procedures').get() as { n: number }).n;
      for (const bad of ['IconSnowflake', '__proto__', 'constructor', '<svg onload=alert(1)>', 'https://evil.example/x.svg', 'FREEZER', '']) {
        await expect(withIcons(bad, null), bad).rejects.toThrow(DomainValidationError);
        await expect(withIcons('home', bad), bad).rejects.toThrow(DomainValidationError);
      }
      expect((database.sqlite.prepare('SELECT count(*) AS n FROM procedures').get() as { n: number }).n).toBe(before);
    });
  });
});

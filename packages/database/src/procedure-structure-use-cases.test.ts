import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidProcedureReferenceError,
  NotAuthorizedError,
  ProcedureConflictError,
  addMember,
  createProcedure,
  createWorkspace,
  deleteProcedure,
  getProcedure,
  updateProcedure,
  type ProcedureDeps,
  type ProcedureDetail,
  type ProcedureInput,
  type WorkspaceDeps,
} from '@vergissmeinnicht/application';
import {
  DomainValidationError,
  normalizeEmail,
  type ProcedureSection,
  type ProcedureStep,
  type SectionInput,
  type StepInput,
  type User,
  type Workspace,
} from '@vergissmeinnicht/domain';
import { createProcedureRepository } from './procedure-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const STEP: StepInput = {
  title: 'Step',
  description: '',
  icon: null,
  required: true,
  critical: false,
  skipReasonPolicy: 'OPTIONAL',
  notApplicableReasonPolicy: 'REQUIRED',
};
const step = (title: string, extra: Partial<StepInput> = {}): StepInput => ({ ...STEP, title, ...extra });
const BASE: Omit<ProcedureInput, 'sections'> = { title: 'Leave the house', description: '', icon: 'home', tags: [] };

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing test fixture');
  return value;
}

/** A saved Step as client input again (id included). */
function stepInput(saved: ProcedureStep): StepInput {
  return {
    id: saved.id,
    title: saved.title,
    description: saved.description,
    icon: saved.icon,
    required: saved.required,
    critical: saved.critical,
    skipReasonPolicy: saved.skipReasonPolicy,
    notApplicableReasonPolicy: saved.notApplicableReasonPolicy,
  };
}

/** The saved structure as client input again (ids included), for round-trip edits. */
function asInput(sections: readonly ProcedureSection[]): SectionInput[] {
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    description: section.description,
    steps: section.steps.map(stepInput),
  }));
}

describe('Procedure Sections and Steps', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let workspaceDeps: WorkspaceDeps;
  let deps: ProcedureDeps;
  let editor: User;
  let member: User;
  let home: Workspace;
  let office: Workspace;
  let admin: User;

  const auditEvents = () =>
    database.sqlite.prepare('SELECT type, metadata FROM audit_events ORDER BY rowid').all() as { type: string; metadata: string }[];
  const titles = (detail: ProcedureDetail) => detail.sections.map((s) => [s.title, s.steps.map((st) => st.title)]);

  async function create(sections: SectionInput[], workspace = home, actor = editor) {
    return createProcedure(deps, { actor, workspaceId: workspace.id, content: { ...BASE, sections } });
  }
  async function save(detail: ProcedureDetail, sections: SectionInput[], actor = editor) {
    return updateProcedure(deps, {
      actor,
      workspaceId: detail.procedure.workspaceId,
      procedureId: detail.procedure.id,
      expectedRevision: detail.procedure.revision,
      content: { ...BASE, sections },
    });
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
    home = await createWorkspace(workspaceDeps, { actor: admin, name: 'Home' });
    office = await createWorkspace(workspaceDeps, { actor: admin, name: 'Office' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: editor.email, role: 'EDITOR' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: office.id, email: editor.email, role: 'EDITOR' });
    await addMember(workspaceDeps, { actor: admin, workspaceId: home.id, email: member.email, role: 'USER' });
  });

  afterEach(() => database.dispose());

  it('creates ordered Sections and Steps with server-generated ids', async () => {
    const created = await create([
      { title: 'Upstairs', description: '', steps: [step('Windows', { critical: true, icon: 'security' }), step('Lights')] },
      { title: 'Downstairs', description: 'Last', steps: [step('Stove', { required: false, skipReasonPolicy: 'DISABLED' })] },
    ]);
    expect(titles(created)).toEqual([
      ['Upstairs', ['Windows', 'Lights']],
      ['Downstairs', ['Stove']],
    ]);
    const loaded = await getProcedure(deps, { actor: member, workspaceId: home.id, procedureId: created.procedure.id });
    expect(loaded.sections).toEqual(created.sections);
    expect(loaded.sections[0]?.steps[0]).toMatchObject({ kind: 'CHECK', critical: true, icon: 'security', required: true });
    expect(loaded.sections[1]?.steps[0]).toMatchObject({ required: false, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'REQUIRED' });
    expect(JSON.parse(auditEvents()[0]?.metadata ?? 'null')).toMatchObject({ sections: 2, steps: 3 });
  });

  it('keeps ids stable across edits, reorders and moves, recording one audit event per save', async () => {
    const created = await create([
      { title: 'A', description: '', steps: [step('a1'), step('a2')] },
      { title: 'B', description: '', steps: [step('b1')] },
    ]);
    const a = must(created.sections[0]);
    const b = must(created.sections[1]);
    const a1 = must(a.steps[0]);
    const a2 = must(a.steps[1]);
    // B first; a2 moves into B; a1 renamed; b1 removed; one new Step and one new Section.
    const saved = await save(created, [
      { id: b.id, title: 'B', description: '', steps: [stepInput(a2), step('b2')] },
      { id: a.id, title: 'A', description: '', steps: [{ ...stepInput(a1), title: 'a1 renamed' }] },
      { title: 'C', description: '', steps: [] },
    ]);

    expect(titles(saved)).toEqual([
      ['B', ['a2', 'b2']],
      ['A', ['a1 renamed']],
      ['C', []],
    ]);
    expect(saved.sections[0]?.id).toBe(b.id);
    expect(saved.sections[0]?.steps[0]?.id).toBe(a2.id);
    expect(saved.sections[1]?.steps[0]?.id).toBe(a1.id);
    expect(saved.procedure.revision).toBe(2);

    const events = auditEvents();
    expect(events.map((e) => e.type)).toEqual(['PROCEDURE_CREATED', 'PROCEDURE_UPDATED']);
    expect(JSON.parse(events[1]?.metadata ?? 'null')).toEqual({
      fields: ['structure'],
      revision: 2,
      sectionsAdded: 1,
      sectionsRemoved: 0,
      sectionsChanged: 2,
      stepsAdded: 1,
      stepsRemoved: 1,
      stepsChanged: 2,
    });
  });

  it('treats an unchanged structure as a no-op', async () => {
    const created = await create([{ title: 'A', description: '', steps: [step('a1')] }]);
    const saved = await save(created, asInput(created.sections));
    expect(saved.procedure.revision).toBe(1);
    expect(auditEvents()).toHaveLength(1);
  });

  describe('foreign ids (child cannot bypass parent)', () => {
    it('rejects Step and Section ids of another Procedure in the same Workspace', async () => {
      const other = await create([{ title: 'Other', description: '', steps: [step('secret')] }]);
      const mine = await create([{ title: 'Mine', description: '', steps: [] }]);
      const otherSection = must(other.sections[0]);
      const otherStep = must(otherSection.steps[0]);
      const mineSection = must(asInput(mine.sections)[0]);

      await expect(save(mine, [{ ...mineSection, steps: [stepInput(otherStep)] }])).rejects.toThrow(
        InvalidProcedureReferenceError,
      );
      await expect(save(mine, [{ id: otherSection.id, title: 'Stolen', description: '', steps: [] }])).rejects.toThrow(
        InvalidProcedureReferenceError,
      );
      // Nothing changed on either Procedure.
      const reloadedOther = await getProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: other.procedure.id });
      expect(titles(reloadedOther)).toEqual([['Other', ['secret']]]);
      expect((await getProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: mine.procedure.id })).procedure.revision).toBe(1);
    });

    it('rejects ids from another Workspace even for an editor of both', async () => {
      const officeProcedure = await create([{ title: 'Office', description: '', steps: [step('o1')] }], office);
      const mine = await create([{ title: 'Mine', description: '', steps: [] }]);
      await expect(save(mine, asInput(officeProcedure.sections))).rejects.toThrow(InvalidProcedureReferenceError);
    });

    it('rejects a Section id used as a Step id, and client-chosen ids on create', async () => {
      const mine = await create([{ title: 'Mine', description: '', steps: [step('s')] }]);
      const section = must(mine.sections[0]);
      await expect(save(mine, [{ title: 'New', description: '', steps: [step('x', { id: section.id })] }])).rejects.toThrow(
        InvalidProcedureReferenceError,
      );
      await expect(save(mine, [{ id: must(section.steps[0]).id, title: 'New', description: '', steps: [] }])).rejects.toThrow(
        InvalidProcedureReferenceError,
      );
      await expect(create([{ id: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', title: 'X', description: '', steps: [] }])).rejects.toThrow(
        InvalidProcedureReferenceError,
      );
    });
  });

  it('rejects stale saves without touching the structure', async () => {
    const created = await create([{ title: 'A', description: '', steps: [step('a1')] }]);
    await save(created, [...asInput(created.sections), { title: 'B', description: '', steps: [] }]);
    await expect(save(created, [])).rejects.toThrow(ProcedureConflictError);
    const reloaded = await getProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id });
    expect(titles(reloaded)).toEqual([
      ['A', ['a1']],
      ['B', []],
    ]);
  });

  it('refuses structure edits by USERs and invalid content before writing', async () => {
    const created = await create([{ title: 'A', description: '', steps: [step('a1')] }]);
    await expect(save(created, [], member)).rejects.toThrow(NotAuthorizedError);
    await expect(save(created, [{ title: 'A', description: '', steps: [step('a1', { notApplicableReasonPolicy: 'SOMETIMES' })] }])).rejects.toThrow(
      DomainValidationError,
    );
    expect(auditEvents()).toHaveLength(1);
  });

  it('keeps Sections and Steps of a soft-deleted Procedure', async () => {
    const created = await create([{ title: 'A', description: '', steps: [step('a1')] }]);
    await deleteProcedure(deps, { actor: editor, workspaceId: home.id, procedureId: created.procedure.id });
    const count = (table: string) =>
      (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE procedure_id = ?`).get(created.procedure.id) as { n: number }).n;
    expect([count('procedure_sections'), count('procedure_steps')]).toEqual([1, 1]);
  });

  it('enforces structure integrity in the database', async () => {
    const one = await create([{ title: 'A', description: '', steps: [step('a1')] }]);
    const two = await create([{ title: 'B', description: '', steps: [] }]);
    const insertStep = database.sqlite.prepare(
      `INSERT INTO procedure_steps (id, procedure_id, section_id, position, title, required, critical, skip_reason_policy, not_applicable_reason_policy)
       VALUES (?, ?, ?, ?, 'x', 1, 0, ?, 'OPTIONAL')`,
    );
    const id = () => crypto.randomUUID();
    const sectionOfOne = must(one.sections[0]).id;
    // A Step pointing at another Procedure's Section.
    expect(() => insertStep.run(id(), two.procedure.id, sectionOfOne, 5, 'OPTIONAL')).toThrow(/FOREIGN KEY/);
    expect(() => insertStep.run(id(), one.procedure.id, sectionOfOne, 0, 'OPTIONAL')).toThrow(/UNIQUE/);
    expect(() => insertStep.run(id(), one.procedure.id, sectionOfOne, 1, 'SOMETIMES')).toThrow(/CHECK/);
    expect(() => database.sqlite.prepare("UPDATE procedure_steps SET kind = 'TEXT'").run()).toThrow(/CHECK/);
  });
});

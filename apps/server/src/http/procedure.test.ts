import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const UNKNOWN_ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const PROCEDURE = { title: 'Leave the house', description: 'Before a trip', icon: 'home', tags: ['travel'], sections: [] };

describe('Procedure HTTP API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let editor: string;
  let user: string;
  let guest: string;
  let outsider: string;

  const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/procedures`;
  const create = (workspaceId: string, cookie: string, body: object = PROCEDURE) => t.post(base(workspaceId), body, cookie);
  const createdId = async (workspaceId: string, cookie: string) =>
    ((await create(workspaceId, cookie)).json() as { procedure: { id: string } }).procedure.id;

  beforeEach(async () => {
    t = await startTestApp();
    editor = await t.invite('editor@example.org', 'Eddie');
    user = await t.invite('user@example.org', 'Uma');
    guest = await t.invite('guest@example.org', 'Gus');
    outsider = await t.invite('outsider@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
  });

  afterEach(async () => t.close());

  it('supports the full lifecycle for an editor', async () => {
    const created = await create(home, editor, { ...PROCEDURE, title: '  Leave the house ', tags: ['travel', 'Travel'] });
    expect(created.statusCode).toBe(201);
    const procedure = created.json().procedure as { id: string; revision: number };
    expect(procedure).toMatchObject({ title: 'Leave the house', icon: 'home', tags: ['travel'], revision: 1 });

    const updated = await t.post(`${base(home)}/${procedure.id}/update`, { ...PROCEDURE, title: 'Leave the flat', expectedRevision: 1 }, editor);
    expect(updated.json().procedure).toMatchObject({ title: 'Leave the flat', revision: 2 });
    expect((await t.get(`${base(home)}/${procedure.id}`, guest)).json().procedure.title).toBe('Leave the flat');

    expect((await t.post(`${base(home)}/${procedure.id}/delete`, undefined, editor)).statusCode).toBe(204);
    expect((await t.get(base(home), editor)).json()).toEqual({ procedures: [] });
    expect((await t.get(`${base(home)}/${procedure.id}`, editor)).json()).toEqual({ error: 'procedure_not_found' });
  });

  it('requires a session and the exact Origin', async () => {
    const id = await createdId(home, editor);
    const unauthenticated = [
      await t.get(base(home)),
      await t.post(base(home), PROCEDURE),
      await t.get(`${base(home)}/${id}`),
      await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, expectedRevision: 1 }),
      await t.post(`${base(home)}/${id}/delete`),
    ];
    expect(unauthenticated.map((r) => r.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect((await t.post(base(home), PROCEDURE, editor, null)).statusCode).toBe(403);
    expect((await t.post(`${base(home)}/${id}/delete`, undefined, editor, 'https://evil.example')).statusCode).toBe(403);
    expect((await t.get(base(home), editor)).json().procedures).toHaveLength(1);
  });

  it('lets USER and GUEST read but not author', async () => {
    const id = await createdId(home, editor);
    for (const cookie of [user, guest]) {
      expect((await t.get(base(home), cookie)).json().procedures).toHaveLength(1);
      expect((await create(home, cookie)).statusCode).toBe(403);
      expect((await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, expectedRevision: 1 }, cookie)).statusCode).toBe(403);
      expect((await t.post(`${base(home)}/${id}/delete`, undefined, cookie)).statusCode).toBe(403);
    }
    expect((await t.get(`${base(home)}/${id}`, user)).json().procedure.revision).toBe(1);
  });

  it('isolates Workspaces, including Procedure ids used through the wrong Workspace', async () => {
    const officeProcedure = await createdId(office, outsider);
    const homeProcedure = await createdId(home, editor);
    // Otto administers Office but is not a member of Home.
    expect((await t.get(base(home), outsider)).statusCode).toBe(404);
    expect((await t.get(`${base(home)}/${homeProcedure}`, outsider)).json()).toEqual({ error: 'workspace_not_found' });
    // Otto's own Procedure id through his own Workspace works; Home's id through Office does not.
    expect((await t.get(`${base(office)}/${homeProcedure}`, outsider)).json()).toEqual({ error: 'procedure_not_found' });
    expect((await t.post(`${base(office)}/${homeProcedure}/delete`, undefined, outsider)).statusCode).toBe(404);
    // Home's admin cannot reach the Office Procedure through Home either.
    expect((await t.get(`${base(home)}/${officeProcedure}`, t.admin)).statusCode).toBe(404);
    expect((await t.get(`${base(home)}/${homeProcedure}`, editor)).statusCode).toBe(200);
  });

  it('reports concurrent edits as conflicts', async () => {
    const id = await createdId(home, editor);
    expect((await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, title: 'A', expectedRevision: 1 }, editor)).statusCode).toBe(200);
    const stale = await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, title: 'B', expectedRevision: 1 }, t.admin);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'procedure_conflict' });
  });

  it('validates input strictly and never accepts markup as an icon', async () => {
    const id = await createdId(home, editor);
    const invalid = [
      await create(home, editor, { ...PROCEDURE, icon: '<svg onload=alert(1)>' }),
      await create(home, editor, { ...PROCEDURE, icon: 'https://example.org/x.png' }),
      await create(home, editor, { ...PROCEDURE, title: '' }),
      await create(home, editor, { ...PROCEDURE, description: 'bell\u0007' }),
      await create(home, editor, { ...PROCEDURE, tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
      await create(home, editor, { ...PROCEDURE, id: UNKNOWN_ID }),
      await create(home, editor, { ...PROCEDURE, workspaceId: office }),
      await create(home, editor, { ...PROCEDURE, tags: 'travel' }),
      await t.post(`${base(home)}/${id}/update`, PROCEDURE, editor),
      await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, expectedRevision: 0 }, editor),
      await t.post(`${base(home)}/${id}/update`, { ...PROCEDURE, expectedRevision: '1' }, editor),
      await t.get(`${base(home)}/${id.toUpperCase()}`, editor),
      await t.get(`${base(home)}/not-an-id`, editor),
    ];
    expect(invalid.map((r) => r.statusCode)).toEqual(Array(invalid.length).fill(400));
    expect((await t.get(base(home), editor)).json().procedures).toHaveLength(1);
  });

  it('saves Sections and Steps with the Procedure and requires the full structure on update', async () => {
    const step = { title: 'Windows', required: true, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'DISABLED' };
    const created = await create(home, editor, { ...PROCEDURE, sections: [{ title: 'Upstairs', steps: [step] }] });
    expect(created.statusCode).toBe(201);
    const procedure = created.json().procedure as { id: string; sections: { id: string; steps: { id: string }[] }[] };
    expect(procedure.sections[0]).toMatchObject({
      title: 'Upstairs',
      description: '',
      steps: [{ title: 'Windows', kind: 'CHECK', icon: null, critical: false, required: true }],
    });

    const withoutSections = { title: PROCEDURE.title, description: PROCEDURE.description, icon: PROCEDURE.icon, tags: PROCEDURE.tags };
    const missing = await t.post(`${base(home)}/${procedure.id}/update`, { ...withoutSections, expectedRevision: 1 }, editor);
    expect(missing.statusCode).toBe(400);

    const listed = (await t.get(base(home), guest)).json().procedures[0];
    expect(listed).not.toHaveProperty('sections');
    const fetched = (await t.get(`${base(home)}/${procedure.id}`, guest)).json().procedure;
    expect(fetched.sections[0].steps[0].id).toBe(procedure.sections[0]?.steps[0]?.id);
  });

  it('rejects Step ids that belong to another Procedure', async () => {
    const step = { title: 'Secret', required: true, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
    const other = (await create(home, editor, { ...PROCEDURE, sections: [{ title: 'S', steps: [step] }] })).json().procedure;
    const mine = (await create(home, editor)).json().procedure;
    const stolenStepId = other.sections[0].steps[0].id as string;
    const response = await t.post(
      `${base(home)}/${mine.id}/update`,
      { ...PROCEDURE, expectedRevision: 1, sections: [{ title: 'Mine', steps: [{ ...step, id: stolenStepId }] }] },
      editor,
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_item_reference' });
    expect((await t.get(`${base(home)}/${other.id}`, editor)).json().procedure.sections[0].steps[0].title).toBe('Secret');
  });

  it('validates Step fields strictly', async () => {
    const step = { title: 'S', required: true, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
    const invalid = [
      { ...step, kind: 'TEXT' },
      { ...step, skipReasonPolicy: 'optional' },
      { ...step, required: 'yes' },
      { ...step, icon: '<svg/>' },
      { ...step, id: 'not-a-uuid' },
      { title: 'S' },
    ];
    for (const bad of invalid) {
      expect((await create(home, editor, { ...PROCEDURE, sections: [{ title: 'X', steps: [bad] }] })).statusCode).toBe(400);
    }
    expect((await t.get(base(home), editor)).json().procedures).toEqual([]);
  });

  it('lists and restores deleted Procedures for editors only', async () => {
    const id = await createdId(home, editor);
    expect((await t.post(`${base(home)}/${id}/delete`, undefined, editor)).statusCode).toBe(204);
    const deleted = await t.get(`${base(home)}/deleted`, t.admin);
    expect(deleted.json().procedures).toMatchObject([{ id, title: 'Leave the house', deletedBy: 'Eddie' }]);
    for (const cookie of [user, guest]) {
      expect((await t.get(`${base(home)}/deleted`, cookie)).statusCode).toBe(403);
      expect((await t.post(`${base(home)}/${id}/restore`, undefined, cookie)).statusCode).toBe(403);
    }
    expect((await t.get(`${base(home)}/deleted`, outsider)).statusCode).toBe(404);
    expect((await t.post(`${base(home)}/${id}/restore`, undefined, editor, null)).statusCode).toBe(403);
    // Through another Workspace the id is unknown.
    expect((await t.post(`${base(office)}/${id}/restore`, undefined, outsider)).statusCode).toBe(404);

    const restored = await t.post(`${base(home)}/${id}/restore`, undefined, editor);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().procedure).toMatchObject({ id, revision: 2 });
    expect((await t.get(base(home), guest)).json().procedures).toHaveLength(1);
    expect((await t.post(`${base(home)}/${id}/restore`, undefined, editor)).statusCode).toBe(404);
  });

  it('answers unknown Procedure ids with 404', async () => {
    expect((await t.get(`${base(home)}/${UNKNOWN_ID}`, editor)).statusCode).toBe(404);
    expect((await t.post(`${base(home)}/${UNKNOWN_ID}/delete`, undefined, editor)).statusCode).toBe(404);
  });

  it('returns descriptions verbatim as JSON text', async () => {
    const response = await create(home, editor, { ...PROCEDURE, description: '<script>alert(1)</script>\nline two' });
    expect(response.json().procedure.description).toBe('<script>alert(1)</script>\nline two');
    expect(response.headers['content-type']).toMatch(/^application\/json/);
  });
});

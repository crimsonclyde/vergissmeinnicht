import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const STEP = { title: 'Stove off', required: true, critical: true, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'REQUIRED' };
const PROCEDURE = {
  title: 'Leave the house',
  description: 'Daily',
  icon: 'home',
  tags: ['daily'],
  sections: [{ title: 'Kitchen', steps: [STEP] }],
};

describe('Procedure export, import and duplicate over HTTP', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let editor: string;
  let guest: string;
  let sourceId: string;

  const base = (workspaceId: string) => `/api/workspaces/${workspaceId}/procedures`;
  const exportOf = async (workspaceId: string, id: string, cookie: string) => t.get(`${base(workspaceId)}/${id}/export`, cookie);
  const importInto = (workspaceId: string, body: unknown, cookie: string) =>
    t.app.inject({
      method: 'POST',
      url: `${base(workspaceId)}/import`,
      headers: { origin: 'https://vmn.example.org', cookie, 'content-type': 'application/json' },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
    });

  beforeEach(async () => {
    t = await startTestApp();
    editor = await t.invite('editor@example.org', 'Eddie');
    guest = await t.invite('guest@example.org', 'Gus');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(office, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    sourceId = (await t.post(base(home), PROCEDURE, editor)).json().procedure.id;
  });

  afterEach(async () => t.close());

  it('exports the definition without ids or other internal data, readable by every role', async () => {
    const response = await exportOf(home, sourceId, guest);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    const document = response.json();
    expect(document).toMatchObject({ format: 'vergissmeinnicht.procedure', schemaVersion: 1, procedure: { title: 'Leave the house' } });
    expect(response.body).not.toMatch(/"id"|workspace|createdAt|revision|@example\.org/i);
  });

  it('round-trips export → import into another Workspace', async () => {
    const document = (await exportOf(home, sourceId, editor)).json();
    const imported = await importInto(office, document, editor);
    expect(imported.statusCode).toBe(201);
    const copy = imported.json().procedure;
    expect(copy.id).not.toBe(sourceId);
    expect((await exportOf(office, copy.id, editor)).json()).toEqual(document);
    expect((await t.get(base(office), editor)).json().procedures).toHaveLength(1);
  });

  it('denies export and import across Workspace boundaries and to read-only roles', async () => {
    const document = (await exportOf(home, sourceId, editor)).json();
    expect((await importInto(home, document, guest)).statusCode).toBe(403);
    // The guest is not a member of Office at all.
    expect((await importInto(office, document, guest)).statusCode).toBe(404);
    // A Home Procedure id through Office is unknown, even for an editor of both.
    expect((await exportOf(office, sourceId, editor)).json()).toEqual({ error: 'procedure_not_found' });
    expect((await t.post(`${base(office)}/${sourceId}/duplicate`, undefined, editor)).statusCode).toBe(404);
    expect((await exportOf(home, sourceId, t.admin)).statusCode).toBe(200);
  });

  it('duplicates within the Workspace for editors only', async () => {
    const copy = await t.post(`${base(home)}/${sourceId}/duplicate`, undefined, editor);
    expect(copy.statusCode).toBe(201);
    expect(copy.json().procedure).toMatchObject({ title: 'Leave the house (copy)', revision: 1 });
    expect((await t.post(`${base(home)}/${sourceId}/duplicate`, undefined, guest)).statusCode).toBe(403);
    expect((await t.post(`${base(home)}/${sourceId}/duplicate`, undefined, editor, null)).statusCode).toBe(403);
  });

  it('rejects hostile or foreign documents without creating anything', async () => {
    const document = (await exportOf(home, sourceId, editor)).json();
    const cases: [unknown, string][] = [
      [{ ...document, schemaVersion: 2 }, 'unsupported_schema_version'],
      [{ ...document, format: 'other' }, 'unsupported_format'],
      [[document], 'invalid_document'],
      [{ ...document, procedure: { ...document.procedure, id: sourceId } }, 'invalid_document'],
      [{ ...document, procedure: { ...document.procedure, icon: '<svg onload=alert(1)>' } }, 'invalid_icon'],
      [{ ...document, procedure: { ...document.procedure, title: 'a‮b' } }, 'procedure_title_invalid_characters'],
    ];
    for (const [body, error] of cases) {
      const response = await importInto(office, body, editor);
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe(error);
    }
    const poisoned = JSON.stringify(document).replace('"procedure":{', '"procedure":{"__proto__":{"admin":true},');
    expect((await importInto(office, poisoned, editor)).statusCode).toBe(400);
    const deep = `${'['.repeat(50_000)}${']'.repeat(50_000)}`;
    expect((await importInto(office, deep, editor)).statusCode).toBe(400);
    expect((await importInto(office, '{"format":', editor)).statusCode).toBe(400);
    const huge = { ...document, procedure: { ...document.procedure, description: 'x'.repeat(1_100_000) } };
    expect((await importInto(office, huge, editor)).statusCode).toBe(413);
    expect((await t.get(base(office), editor)).json().procedures).toEqual([]);
  });
});

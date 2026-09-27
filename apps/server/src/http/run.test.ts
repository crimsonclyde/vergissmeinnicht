import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const STEP = { title: 'Stove off', required: true, critical: true, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Leave the house', icon: 'home', sections: [{ title: 'Kitchen', steps: [STEP] }] };
const UNKNOWN_ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

describe('Run HTTP API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let editor: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let procedureId: string;

  const runs = (workspaceId: string) => `/api/workspaces/${workspaceId}/runs`;
  const start = (cookie: string, workspaceId = home, id = procedureId) => t.post(runs(workspaceId), { procedureId: id }, cookie);

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
    procedureId = (await t.post(`/api/workspaces/${home}/procedures`, PROCEDURE, editor)).json().procedure.id;
  });

  afterEach(async () => t.close());

  it('starts a Run with a snapshot that survives Procedure edits', async () => {
    const started = await start(user);
    expect(started.statusCode).toBe(201);
    const run = started.json().run;
    expect(run).toMatchObject({ procedureId, procedureRevision: 1, state: 'ACTIVE', startedBy: 'Uma', title: 'Leave the house' });
    expect(run.sections[0].steps[0]).toMatchObject({ title: 'Stove off', critical: true, state: 'PENDING' });
    expect(run).not.toHaveProperty('workspaceId');

    await t.post(
      `/api/workspaces/${home}/procedures/${procedureId}/update`,
      { ...PROCEDURE, title: 'Renamed', sections: [], expectedRevision: 1 },
      editor,
    );
    const fetched = (await t.get(`${runs(home)}/${run.id}`, guest)).json().run;
    expect(fetched.title).toBe('Leave the house');
    expect(fetched.sections[0].steps[0].title).toBe('Stove off');

    const list = (await t.get(`${runs(home)}?state=ACTIVE`, guest)).json().runs;
    expect(list).toMatchObject([{ id: run.id, stepCounts: { PENDING: 1, DONE: 0, SKIPPED: 0, NOT_APPLICABLE: 0 } }]);
    expect((await t.get(`${runs(home)}?state=COMPLETED`, guest)).json().runs).toEqual([]);
  });

  it('enforces session, Origin, roles and Workspace scope', async () => {
    const runId = (await start(user)).json().run.id;
    expect((await t.get(runs(home))).statusCode).toBe(401);
    expect((await t.post(runs(home), { procedureId })).statusCode).toBe(401);
    expect((await t.post(runs(home), { procedureId }, user, null)).statusCode).toBe(403);
    expect((await start(guest)).statusCode).toBe(403);
    expect((await t.get(runs(home), outsider)).statusCode).toBe(404);
    expect((await t.get(`${runs(home)}/${runId}`, outsider)).json()).toEqual({ error: 'workspace_not_found' });
    // Otto administers Office: neither the Home Run nor the Home Procedure is reachable through it.
    expect((await t.get(`${runs(office)}/${runId}`, outsider)).json()).toEqual({ error: 'run_not_found' });
    expect((await start(outsider, office)).json()).toEqual({ error: 'procedure_not_found' });
  });

  it('validates input and preconditions', async () => {
    const empty = (await t.post(`/api/workspaces/${home}/procedures`, { title: 'Empty', icon: 'home' }, editor)).json().procedure.id;
    expect((await start(user, home, empty)).json()).toEqual({ error: 'procedure_has_no_steps' });
    expect((await start(user, home, UNKNOWN_ID)).statusCode).toBe(404);
    const invalid = [
      await t.post(runs(home), { procedureId: 'nope' }, user),
      await t.post(runs(home), { procedureId, state: 'COMPLETED' }, user),
      await t.post(runs(home), { procedureId, title: 'Forged' }, user),
      await t.get(`${runs(home)}?state=DONE`, user),
      await t.get(`${runs(home)}?limit=100000`, user),
      await t.get(`${runs(home)}/NOT-A-UUID`, user),
    ];
    expect(invalid.map((r) => r.statusCode)).toEqual(Array(invalid.length).fill(400));
    expect((await t.get(`${runs(home)}/${UNKNOWN_ID}`, user)).json()).toEqual({ error: 'run_not_found' });
  });
});

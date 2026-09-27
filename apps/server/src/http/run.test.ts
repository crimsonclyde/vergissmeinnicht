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

  it('changes Step states with reasons, conflicts and undo', async () => {
    const run = (await start(user)).json().run;
    const stepId = run.sections[0].steps[0].id as string;
    const url = `${runs(home)}/${run.id}/steps/${stepId}/state`;
    const done = await t.post(url, { expectedState: 'PENDING', state: 'DONE' }, user);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ runRevision: 2, step: { id: stepId, state: 'DONE', stateChange: { by: 'Uma', reason: null } } });
    expect(done.body).not.toContain('userId');

    expect((await t.post(url, { expectedState: 'PENDING', state: 'DONE' }, editor)).json()).toEqual({ error: 'step_conflict' });
    expect((await t.post(url, { expectedState: 'DONE', state: 'SKIPPED' }, editor)).json()).toMatchObject({ error: 'invalid_transition' });
    expect((await t.post(url, { expectedState: 'DONE', state: 'PENDING', reason: 'oops' }, editor)).json()).toMatchObject({
      error: 'reason_not_allowed',
    });
    expect((await t.post(url, { expectedState: 'DONE', state: 'PENDING' }, editor)).json().step.state).toBe('PENDING');
    // Skip reason is DISABLED for this Step.
    expect((await t.post(url, { expectedState: 'PENDING', state: 'SKIPPED', reason: 'no' }, user)).json()).toMatchObject({
      error: 'reason_not_allowed',
    });

    expect((await t.post(url, { expectedState: 'PENDING', state: 'DONE' }, guest)).statusCode).toBe(403);
    expect((await t.post(url, { expectedState: 'PENDING', state: 'DONE' }, user, null)).statusCode).toBe(403);
    expect((await t.post(url, { expectedState: 'PENDING', state: 'DONE' })).statusCode).toBe(401);
    expect((await t.post(url, { expectedState: 'PENDING', state: 'DONE' }, outsider)).statusCode).toBe(404);
    expect((await t.post(`${runs(office)}/${run.id}/steps/${stepId}/state`, { expectedState: 'PENDING', state: 'DONE' }, outsider)).json()).toEqual({
      error: 'run_not_found',
    });
    const otherRun = (await start(user)).json().run.id as string;
    expect((await t.post(`${runs(home)}/${otherRun}/steps/${stepId}/state`, { expectedState: 'PENDING', state: 'DONE' }, user)).json()).toEqual({
      error: 'step_not_found',
    });
    for (const bad of [
      { expectedState: 'PENDING', state: 'FINISHED' },
      { state: 'DONE' },
      { expectedState: 'PENDING', state: 'DONE', by: 'someone else' },
      { expectedState: 'PENDING', state: 'DONE', reason: 'x'.repeat(5000) },
    ]) {
      expect((await t.post(url, bad, user)).statusCode).toBe(400);
    }
    const fetched = (await t.get(`${runs(home)}/${run.id}`, guest)).json().run;
    expect(fetched.sections[0].steps[0]).toMatchObject({ state: 'PENDING', stateChange: { by: 'Eddie' } });
  });

  it('completes and aborts Runs with the required-Step rule and freezes them afterwards', async () => {
    const run = (await start(user)).json().run;
    const stepId = run.sections[0].steps[0].id as string;
    expect((await t.post(`${runs(home)}/${run.id}/complete`, undefined, user)).json()).toEqual({
      error: 'required_steps_open',
      openRequiredSteps: 1,
    });
    await t.post(`${runs(home)}/${run.id}/steps/${stepId}/state`, { expectedState: 'PENDING', state: 'DONE' }, user);
    expect((await t.post(`${runs(home)}/${run.id}/complete`, undefined, guest)).statusCode).toBe(403);
    expect((await t.post(`${runs(home)}/${run.id}/complete`, undefined, user, null)).statusCode).toBe(403);
    const completed = await t.post(`${runs(home)}/${run.id}/complete`, undefined, user);
    expect(completed.json().run).toMatchObject({ state: 'COMPLETED', ended: { by: 'Uma', reason: null } });
    expect((await t.post(`${runs(home)}/${run.id}/abort`, {}, user)).json()).toEqual({ error: 'run_not_active' });
    expect((await t.post(`${runs(home)}/${run.id}/steps/${stepId}/state`, { expectedState: 'DONE', state: 'PENDING' }, user)).json()).toEqual({
      error: 'run_not_active',
    });

    const second = (await start(user)).json().run;
    expect((await t.post(`${runs(home)}/${second.id}/abort`, { reason: 'x', by: 'someone' }, user)).statusCode).toBe(400);
    expect((await t.post(`${runs(office)}/${second.id}/abort`, {}, outsider)).json()).toEqual({ error: 'run_not_found' });
    const aborted = await t.post(`${runs(home)}/${second.id}/abort`, { reason: 'Power cut' }, editor);
    expect(aborted.json().run).toMatchObject({ state: 'ABORTED', ended: { by: 'Eddie', reason: 'Power cut' } });
    expect((await t.post(`${runs(home)}/${(await start(user)).json().run.id}/abort`, undefined, user)).json().run.state).toBe('ABORTED');
  });

  it('serves Run and Procedure history to members only, with display names instead of user ids', async () => {
    const run = (await start(user)).json().run;
    const stepId = run.sections[0].steps[0].id as string;
    await t.post(`${runs(home)}/${run.id}/steps/${stepId}/state`, { expectedState: 'PENDING', state: 'DONE' }, user);
    const history = await t.get(`${runs(home)}/${run.id}/history`, guest);
    expect(history.json().events.map((e: { type: string; actor: string }) => [e.type, e.actor])).toEqual([
      ['RUN_STARTED', 'Uma'],
      ['STEP_STATE_CHANGED', 'Uma'],
    ]);
    expect(history.body).not.toMatch(/userId|actorUserId|@example\.org/);
    expect((await t.get(`${runs(home)}/${run.id}/history`, outsider)).statusCode).toBe(404);
    expect((await t.get(`${runs(office)}/${run.id}/history`, outsider)).json()).toEqual({ error: 'run_not_found' });
    expect((await t.get(`${runs(home)}/${run.id}/history`)).statusCode).toBe(401);

    const procedureHistory = await t.get(`/api/workspaces/${home}/procedures/${procedureId}/history`, guest);
    expect(procedureHistory.json().events.map((e: { type: string }) => e.type)).toEqual(['PROCEDURE_CREATED']);
    expect((await t.get(`/api/workspaces/${office}/procedures/${procedureId}/history`, outsider)).json()).toEqual({ events: [] });
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

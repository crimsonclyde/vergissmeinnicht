import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ORIGIN, startTestApp } from './test-harness.ts';

const STEP = { title: 'Stove off', required: true, critical: false, skipReasonPolicy: 'DISABLED', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Leave the house', icon: 'home', sections: [{ title: 'Kitchen', steps: [STEP] }] };
const LINK = new RegExp(`^${ORIGIN.replaceAll('.', '\\.')}/knot/([A-Za-z0-9_-]{43})$`);

describe('Knot HTTP API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let editor: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let procedureId: string;
  let runId: string;

  const knots = (workspaceId: string) => `/api/workspaces/${workspaceId}/knots`;
  const create = (body: object, cookie = editor, workspaceId = home) => t.post(knots(workspaceId), body, cookie);
  const resolve = (token: unknown, cookie?: string, origin?: string | null) => t.post('/api/knots/resolve', { token }, cookie, origin);
  async function knotToken(target: object, extra: object = {}) {
    const response = await create({ target, label: 'Front door', expiresInDays: null, ...extra });
    expect(response.statusCode).toBe(201);
    const token = LINK.exec(response.json().url)?.[1];
    if (token === undefined) throw new Error('no Knot link');
    return { token, id: response.json().knot.id as string };
  }

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
    runId = (await t.post(`/api/workspaces/${home}/runs`, { procedureId }, user)).json().run.id;
  });

  afterEach(async () => t.close());

  it('creates a Knot link once and lists it without the token', async () => {
    const response = await create({ target: { type: 'RUN', id: runId }, label: 'Evening round', expiresInDays: 7 });
    expect(response.statusCode).toBe(201);
    const { knot, url } = response.json();
    expect(url).toMatch(LINK);
    expect(knot).toMatchObject({ label: 'Evening round', target: { type: 'RUN', id: runId }, status: 'ACTIVE', createdBy: 'Eddie', revoked: null });
    const token = LINK.exec(url)?.[1] ?? '';

    const listed = await t.get(knots(home), t.admin);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().knots).toMatchObject([{ id: knot.id, target: { title: 'Leave the house', available: true }, status: 'ACTIVE' }]);
    expect(listed.body).not.toContain(token);
    expect(listed.body).not.toMatch(/userId|tokenHash|token_hash|@example/);
  });

  it('opens a Knot only for signed-in members allowed to view the target, with one answer for every failure', async () => {
    const runKnot = await knotToken({ type: 'RUN', id: runId });
    const procedureKnot = await knotToken({ type: 'PROCEDURE', id: procedureId });

    expect((await resolve(runKnot.token, guest)).json()).toEqual({ workspaceId: home, target: { type: 'RUN', id: runId } });
    expect((await resolve(procedureKnot.token, user)).json()).toEqual({ workspaceId: home, target: { type: 'PROCEDURE', id: procedureId } });

    // Possession does not replace authentication (also not with only an MFA challenge cookie).
    expect((await resolve(runKnot.token)).statusCode).toBe(401);
    expect((await resolve(runKnot.token, '__Secure-vmn.mfa_challenge=x')).statusCode).toBe(401);
    // Cookie-authenticated POST: the Origin check applies.
    expect((await resolve(runKnot.token, guest, null)).statusCode).toBe(403);

    const notFound = { error: 'knot_not_found' };
    const outsiderAnswer = await resolve(runKnot.token, outsider);
    expect(outsiderAnswer.statusCode).toBe(404);
    expect(outsiderAnswer.json()).toEqual(notFound);
    expect(outsiderAnswer.body).not.toContain(home);
    expect((await resolve('A'.repeat(43), guest)).json()).toEqual(notFound);
    expect((await resolve('short', guest)).json()).toEqual(notFound);
    expect((await resolve(runKnot.id, guest)).json()).toEqual(notFound);
    expect((await resolve(42, guest)).json()).toEqual({ error: 'invalid_request' });
    expect((await t.post('/api/knots/resolve', { token: runKnot.token, workspaceId: home }, guest)).statusCode).toBe(400);
    // The token is never accepted in an API URL.
    expect((await t.get(`/api/knots/${runKnot.token}`, guest)).statusCode).toBe(404);

    expect((await t.post(`${knots(home)}/${runKnot.id}/revoke`, undefined, editor)).statusCode).toBe(204);
    expect((await resolve(runKnot.token, guest)).json()).toEqual(notFound);
    expect((await t.post(`${knots(home)}/${runKnot.id}/revoke`, undefined, editor)).json()).toEqual({ error: 'knot_already_revoked' });
    expect((await t.get(knots(home), editor)).json().knots.find((k: { id: string }) => k.id === runKnot.id)).toMatchObject({
      status: 'REVOKED',
      revoked: { by: 'Eddie' },
    });
  });

  it('enforces session, Origin, knot.manage and Workspace scope for management', async () => {
    const body = { target: { type: 'RUN', id: runId }, label: 'x', expiresInDays: null };
    expect((await create(body, user)).statusCode).toBe(403);
    expect((await create(body, guest)).statusCode).toBe(403);
    expect((await t.get(knots(home), user)).statusCode).toBe(403);
    expect((await create(body, outsider)).json()).toEqual({ error: 'workspace_not_found' });
    expect((await t.post(knots(home), body)).statusCode).toBe(401);
    expect((await t.post(knots(home), body, editor, null)).statusCode).toBe(403);
    // Otto administers Office: Home's Run cannot be linked or revoked through it.
    expect((await create(body, outsider, office)).json()).toEqual({ error: 'knot_target_not_found' });
    const { id } = await knotToken({ type: 'RUN', id: runId });
    expect((await t.post(`${knots(office)}/${id}/revoke`, undefined, outsider)).json()).toEqual({ error: 'knot_not_found' });
    expect((await t.post(`${knots(home)}/${id}/revoke`, undefined, user)).statusCode).toBe(403);
  });

  it('validates bodies strictly', async () => {
    const target = { type: 'RUN', id: runId };
    const cases: [object, number, string][] = [
      [{ target, label: 'x', expiresInDays: 0 }, 400, 'invalid_knot_expiry'],
      [{ target, label: 'x', expiresInDays: 400 }, 400, 'invalid_knot_expiry'],
      [{ target, label: 'x', expiresInDays: 1.5 }, 400, 'invalid_request'],
      [{ target, label: '  ', expiresInDays: null }, 400, 'knot_label_empty'],
      [{ target, label: 'x' }, 400, 'invalid_request'],
      [{ target: { type: 'WORKSPACE', id: home }, label: 'x', expiresInDays: null }, 400, 'invalid_request'],
      [{ target: { ...target, workspaceId: office }, label: 'x', expiresInDays: null }, 400, 'invalid_request'],
      [{ target, label: 'x', expiresInDays: null, tokenHash: 'a'.repeat(64) }, 400, 'invalid_request'],
      [{ target: { type: 'RUN', id: 'not-a-uuid' }, label: 'x', expiresInDays: null }, 400, 'invalid_target_id'],
    ];
    for (const [body, status, error] of cases) {
      const response = await create(body);
      expect([response.statusCode, response.json().error]).toEqual([status, error]);
    }
    expect((await t.get(knots(home), editor)).json().knots).toEqual([]);
  });
});

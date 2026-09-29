import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

/**
 * Security properties checked for *every* registered route (13.2), so a route added later cannot
 * silently skip them: authentication, Workspace isolation for non-members, parent/child isolation
 * (ids of one Workspace used under another), malformed identifiers, and server-admin routes.
 * Feature tests keep the detailed per-capability negative cases.
 */

/** Routes reachable without a session — each one deliberately public. Adding one needs a review. */
const PUBLIC_ROUTES = [
  'GET /api/health',
  'GET /api/health/ready',
  'GET /api/about',
  'POST /api/auth/sign-in',
  'POST /api/auth/mfa', // needs the short-lived challenge cookie from the password step
  'POST /api/auth/sign-out', // ends a session if there is one
  'POST /api/invitations/resolve', // token in the body
  'POST /api/invitations/accept',
  'POST /api/recoveries/resolve',
  'POST /api/recoveries/complete',
];

const STEP = { title: 'Stove off', required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
/** An exported Procedure document (set in beforeAll), the body the import route expects. */
let exported: object = {};
const PROCEDURE = { title: 'Leave the house', icon: 'home', sections: [{ title: 'Kitchen', steps: [STEP] }] };

/** Bodies that pass validation, so a check reaches the lookup instead of stopping at 400. */
function bodyFor(route: string, ids: Record<string, string>): object {
  const [method, url] = route.split(' ') as [string, string];
  if (method !== 'POST') return {};
  if (url.endsWith('/schedules')) return { procedureId: ids.procedureId ?? '', date: TOMORROW, timeZone: 'UTC', reminders: [] };
  if (url.endsWith('/schedules/:scheduleId/update')) return { expectedRevision: 1, date: TOMORROW, timeZone: 'UTC', reminders: [] };
  if (url.endsWith('/procedures')) return PROCEDURE;
  if (url.endsWith('/procedures/import')) return exported;
  if (url.endsWith('/update')) return { ...PROCEDURE, expectedRevision: 1 };
  if (url.endsWith('/state')) return { expectedState: 'PENDING', state: 'DONE' };
  if (url.endsWith('/runs')) return { procedureId: ids.procedureId ?? '' };
  if (url.endsWith('/knots')) return { target: { type: 'PROCEDURE', id: ids.procedureId ?? '' }, label: 'x', expiresInDays: null };
  if (url.endsWith('/role')) return { role: 'USER' };
  if (url.endsWith('/members')) return { email: 'user@example.org', role: 'USER' };
  if (url.endsWith('/rename')) return { name: 'Taken over' };
  if (url.endsWith('/cancel')) return { expectedRevision: 1 };
  return {};
}

function fill(url: string, values: Record<string, string>): string {
  return url.replace(/:([A-Za-z]+)/g, (_match, name: string) => values[name] ?? `missing-${name}`);
}

describe('security properties of every route (13.2)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let routes: string[];
  /** Ids of Workspace A (Home), where `owner` works. */
  let homeIds: Record<string, string>;
  /** Workspace B (Office), administered by `outsider`, who is no member of Home. */
  let office: string;
  let owner: string;
  let outsider: string;
  let plainUser: string;

  const call = (route: string, cookie: string | undefined, values: Record<string, string>): Promise<InjectResponse> => {
    const [method, pattern] = route.split(' ') as [string, string];
    const url = fill(pattern, values);
    return method === 'GET' ? t.get(url, cookie) : t.post(url, bodyFor(route, values), cookie);
  };

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.invite('owner@example.org', 'Olga');
    outsider = await t.invite('outsider@example.org', 'Otto');
    plainUser = await t.invite('user@example.org', 'Uma');
    const home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'owner@example.org', 'ADMIN');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
    const procedure = (await t.post(`/api/workspaces/${home}/procedures`, PROCEDURE, owner)).json().procedure;
    exported = (await t.get(`/api/workspaces/${home}/procedures/${procedure.id}/export`, owner)).json();
    const run = (await t.post(`/api/workspaces/${home}/runs`, { procedureId: procedure.id }, owner)).json().run;
    const knot = (await t.post(`/api/workspaces/${home}/knots`, { target: { type: 'RUN', id: run.id }, label: 'x', expiresInDays: null }, owner)).json()
      .knot;
    const deleted = (await t.post(`/api/workspaces/${home}/procedures`, { ...PROCEDURE, title: 'Old' }, owner)).json().procedure;
    await t.post(`/api/workspaces/${home}/procedures/${deleted.id}/delete`, {}, owner);
    const uma = (await t.get('/api/auth/session', plainUser)).json().user.id as string;
    const scheduled = (await t.post(`/api/workspaces/${home}/schedules`, { procedureId: procedure.id, date: TOMORROW, timeZone: 'UTC', reminders: [] }, owner)).json()
      .schedule;
    homeIds = {
      workspaceId: home,
      procedureId: procedure.id,
      runId: run.id,
      stepId: run.sections[0].steps[0].id,
      knotId: knot.id,
      userId: uma,
      scheduleId: scheduled.id,
    };
    routes = t.app.routeTable.map((route) => `${route.method} ${route.url}`);
  });

  afterAll(async () => t.close());

  it('pins the list of public routes', () => {
    for (const route of PUBLIC_ROUTES) expect(routes).toContain(route);
  });

  it('requires a session on every other route', async () => {
    for (const route of routes.filter((r) => !PUBLIC_ROUTES.includes(r))) {
      const response = await call(route, undefined, homeIds);
      expect({ route, status: response.statusCode }).toEqual({ route, status: 401 });
    }
  });

  // Runs before the malformed-id sweep, whose many admin calls use up the persisted per-client limits.
  it('keeps every server-admin route for ACTIVE server admins', async () => {
    const adminRoutes = routes.filter((r) => r.includes(' /api/admin/'));
    expect(adminRoutes.length).toBeGreaterThan(5);
    for (const route of adminRoutes) {
      const response = await call(route, plainUser, { id: homeIds.userId ?? '', userId: homeIds.userId ?? '' });
      expect({ route, status: response.statusCode }).toEqual({ route, status: expect.toSatisfy((s: number) => s === 403 || s === 400) });
    }
  });

  it('answers non-members of a Workspace like an unknown Workspace, on every Workspace route', async () => {
    for (const route of routes.filter((r) => r.includes('/workspaces/:workspaceId'))) {
      const response = await call(route, outsider, homeIds);
      expect({ route, status: response.statusCode }).toEqual({ route, status: 404 });
      expect(response.body).not.toContain('Leave the house');
    }
  });

  it('never resolves a child id of one Workspace under another Workspace', async () => {
    // Otto administers Office and uses Home's Procedure/Run/Step/Knot/member ids under Office's id.
    const childRoutes = routes.filter((r) => (r.includes('/:workspaceId/') && /:(procedureId|runId|knotId|userId|scheduleId)/.test(r)) || /^POST .*\/:workspaceId\/(runs|knots|schedules)$/.test(r));
    expect(childRoutes.length).toBeGreaterThan(10);
    for (const route of childRoutes) {
      const response = await call(route, outsider, { ...homeIds, workspaceId: office });
      expect({ route, status: response.statusCode }).toEqual({ route, status: 404 });
      expect(response.body).not.toContain('Leave the house');
    }
    // Nothing of Home changed.
    const run = (await t.get(`/api/workspaces/${homeIds.workspaceId}/runs/${homeIds.runId}`, owner)).json().run;
    expect(run.state).toBe('ACTIVE');
    expect(run.sections[0].steps[0].state).toBe('PENDING');
    const scheduled = (await t.get(`/api/workspaces/${homeIds.workspaceId}/schedules/${homeIds.scheduleId}`, owner)).json().schedule;
    expect(scheduled).toMatchObject({ state: 'SCHEDULED', revision: 1 });
  });

  it('rejects malformed identifiers without errors or data', async () => {
    const withParams = routes.filter((r) => r.includes('/:'));
    let sent = 0;
    for (const route of withParams) {
      for (const name of [...route.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string)) {
        for (const bad of ['not-a-uuid', homeIds[name]?.toUpperCase() ?? 'X', '00000000-0000-0000-0000-000000000000']) {
          // Stay below the global per-client limit (in memory): a fresh process every 200 requests.
          if (sent++ % 200 === 0) await t.restart();
          const response = await call(route, owner, { ...homeIds, [name]: bad });
          expect({ route, name, bad, status: response.statusCode }).toEqual({ route, name, bad, status: expect.toSatisfy((s: number) => s === 400 || s === 404) });
        }
      }
    }
  });
});

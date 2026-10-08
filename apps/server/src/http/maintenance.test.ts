import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const STEP = { title: 'Check pressure', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Boiler service', description: '', icon: 'home', tags: [], sections: [{ title: 'All', description: '', steps: [STEP] }] };

describe('Maintenance over HTTP (16.7)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });
  const create = async (body: object, cookie = user, workspaceId = home) => (await t.post(`${api(workspaceId)}/maintenance`, body, cookie)).json().record as { id: string; revision: number };
  const columns = async (cookie = guest, workspaceId = home) =>
    Object.fromEntries(((await t.get(`${api(workspaceId)}/maintenance/board`, cookie)).json().columns as { status: string; records: { title: string }[] }[]).map((column) => [column.status, column.records.map((record) => record.title)]));

  beforeAll(async () => {
    t = await startTestApp({ captureLogs: true });
    owner = await t.invite('olga@example.org', 'Olga');
    user = await t.invite('uma@example.org', 'Uma');
    guest = await t.invite('gus@example.org', 'Gus');
    outsider = await t.invite('otto@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'olga@example.org', 'ADMIN');
    await t.addMember(home, 'uma@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(office, 'otto@example.org', 'ADMIN');
    await t.post(`${api(office)}/tools`, { tool: 'MAINTENANCE', enabled: true }, outsider);
  }, 60_000);
  afterAll(async () => t.close());

  it('does not exist until a Workspace admin switches it on — whatever other tools are on', async () => {
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: true }, owner);
    for (const cookie of [owner, user, guest]) {
      expect(error(await t.get(`${api()}/maintenance/board`, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
      expect(error(await t.post(`${api()}/maintenance`, { title: 'Early' }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
    }
    expect(error(await t.post(`${api()}/tools`, { tool: 'MAINTENANCE', enabled: true }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.post(`${api()}/tools`, { tool: 'MAINTENANCE', enabled: true }, owner)).json().tools).toContain('MAINTENANCE');
    expect((await t.get(`${api()}`, guest)).json().capabilities).toEqual(expect.arrayContaining(['maintenance.view']));
    expect((await t.get(`${api()}`, guest)).json().capabilities).not.toContain('maintenance.manage');
    expect((await t.get(`${api()}/maintenance/board`, guest)).json()).toEqual({
      statuses: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      columns: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((status) => ({ status, total: 0, records: [] })),
    });
  });

  it('creates a record as Planned and changes its status only on request, refusing a stale one', async () => {
    const technician = (await t.post(`${api()}/contacts`, { name: 'Idraulico Rossi' }, user)).json().contact as { id: string };
    const created = await t.post(`${api()}/maintenance`, { title: 'Boiler service', category: 'Heating', date: '2026-11-03', contactId: technician.id, cost: { amount: '120.00', currency: 'eur' } }, user);
    expect(created.statusCode).toBe(201);
    const record = created.json().record as { id: string };
    expect(created.json().record).toMatchObject({ title: 'Boiler service', status: 'PLANNED', completedOn: null, contact: { id: technician.id, name: 'Idraulico Rossi' }, cost: { amount: '120.00', currency: 'EUR' }, revision: 1, createdBy: 'Uma' });
    expect(await columns()).toEqual({ PLANNED: ['Boiler service'], IN_PROGRESS: [], COMPLETED: [], CANCELLED: [] });
    expect((await t.get(`${api()}/maintenance?status=PLANNED&category=heating&year=2026&contact=${technician.id}&q=boiler`, guest)).json()).toMatchObject({ records: [{ id: record.id }], total: 1, nextCursor: null });
    // A guest sees it all, the cost too (P3) — display names only.
    const seen = await t.get(`${api()}/maintenance/${record.id}`, guest);
    expect(seen.json().record).toMatchObject({ cost: { amount: '120.00', currency: 'EUR' }, modifiedBy: 'Uma' });
    expect(seen.body).not.toMatch(/example\.org|UserId/);
    /** `cookie` null = no session. */
    const status = (body: object, cookie: string | null = user, origin?: null) => t.post(`${api()}/maintenance/${record.id}/status`, body, cookie ?? undefined, origin);
    expect((await status({ status: 'IN_PROGRESS', expectedRevision: 1 })).json().record).toMatchObject({ status: 'IN_PROGRESS', revision: 2 });
    expect(await columns(owner)).toEqual({ PLANNED: [], IN_PROGRESS: ['Boiler service'], COMPLETED: [], CANCELLED: [] });
    // Someone who still has the old card: refused, and told so — the current state is theirs to fetch.
    expect(error(await status({ status: 'CANCELLED', expectedRevision: 1 }, owner))).toEqual({ status: 409, error: 'maintenance_conflict' });
    expect(error(await status({ status: 'IN_PROGRESS', expectedRevision: 2 }))).toEqual({ status: 409, error: 'maintenance_status_unchanged' });
    expect(error(await status({ status: 'DONE', expectedRevision: 2 }))).toEqual({ status: 400, error: 'invalid_maintenance_status' });
    for (const body of [{}, { status: 'COMPLETED' }, { status: 'COMPLETED', expectedRevision: 0 }, { status: 'COMPLETED', expectedRevision: 2, title: 'x' }, { status: 'COMPLETED', expectedRevision: 2, cost: null }]) {
      expect({ body, ...error(await status(body)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    }
    expect(error(await status({ status: 'COMPLETED', expectedRevision: 2 }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await status({ status: 'COMPLETED', expectedRevision: 2 }, null)).statusCode).toBe(401);
    expect((await status({ status: 'COMPLETED', expectedRevision: 2 }, user, null)).statusCode).toBe(403); // no Origin
    expect(error(await status({ status: 'COMPLETED', expectedRevision: 2 }, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await t.post(`${api(office)}/maintenance/${record.id}/status`, { status: 'COMPLETED', expectedRevision: 2 }, outsider))).toEqual({ status: 404, error: 'maintenance_not_found' });
    expect((await t.get(`${api()}/maintenance/${record.id}`, guest)).json().record).toMatchObject({ status: 'IN_PROGRESS', revision: 2 });
    // Completed, with the day the work was done.
    expect((await status({ status: 'COMPLETED', expectedRevision: 2, completedOn: '2026-11-05' })).json().record).toMatchObject({ status: 'COMPLETED', completedOn: '2026-11-05', revision: 3 });
    // An edit changes what the record says — never its status; unknown fields are refused.
    expect(error(await t.post(`${api()}/maintenance/${record.id}/update`, { title: 'x', status: 'PLANNED', expectedRevision: 3 }, user))).toEqual({ status: 400, error: 'invalid_request' });
    expect((await t.post(`${api()}/maintenance/${record.id}/update`, { title: 'Boiler service 2026', expectedRevision: 3 }, user)).json().record).toMatchObject({ title: 'Boiler service 2026', status: 'COMPLETED', completedOn: '2026-11-05', cost: null });
    for (const [body, code] of [
      [{ title: ' ' }, 'maintenance_title_empty'],
      [{ title: 'x', cost: { amount: '-5', currency: 'EUR' } }, 'invalid_cost_amount'],
      [{ title: 'x', cost: { amount: '=1+1', currency: 'EUR' } }, 'invalid_cost_amount'],
      [{ title: 'x', cost: { amount: '5', currency: 'EURO' } }, 'invalid_cost_currency'],
      [{ title: 'x', date: '2026-02-30' }, 'invalid_document_date'],
    ] as const) {
      expect({ body, ...error(await t.post(`${api()}/maintenance`, body, user)) }).toEqual({ body, status: 400, error: code });
    }
    expect(error(await t.get(`${api()}/maintenance?cursor=AAAA`, guest))).toEqual({ status: 400, error: 'invalid_cursor' });
    expect(error(await t.get(`${api()}/maintenance?sort=cost`, guest))).toEqual({ status: 400, error: 'invalid_request' });
    expect((await t.get(`${api()}/maintenance/filters`, guest)).json()).toMatchObject({ filters: { categories: [], years: [2026] }, currencies: expect.arrayContaining(['EUR', 'CHF']) });
  });

  it('keeps a record as it is when a linked Run is completed', async () => {
    const record = await create({ title: 'Chimney sweep' });
    await t.post(`${api()}/maintenance/${record.id}/status`, { status: 'IN_PROGRESS', expectedRevision: 1 }, user);
    const procedure = (await t.post(`${api()}/procedures`, PROCEDURE, owner)).json().procedure as { id: string };
    const run = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, user)).json().run as { id: string; sections: { steps: { id: string }[] }[] };
    const linked = await t.post(`${api()}/maintenance/${record.id}/links`, { target: { type: 'run', id: run.id } }, user);
    expect(linked.statusCode).toBe(201);
    expect(linked.json().link.record).toMatchObject({ type: 'run', id: run.id, title: 'Boiler service', state: 'ok', runState: 'ACTIVE' });
    const before = (await t.get(`${api()}/maintenance/${record.id}`, guest)).json().record;
    await t.post(`${api()}/runs/${run.id}/steps/${run.sections[0]?.steps[0]?.id}/state`, { expectedState: 'PENDING', state: 'DONE' }, user);
    expect((await t.post(`${api()}/runs/${run.id}/complete`, {}, user)).statusCode).toBe(200);
    expect((await t.get(`${api()}/maintenance/${record.id}`, guest)).json().record).toEqual(before);
    expect((await t.get(`${api()}/maintenance/${record.id}/links`, guest)).json().links).toMatchObject([{ record: { type: 'run', runState: 'COMPLETED' } }]);
    // Refusals of the link routes.
    const link = (target: object, cookie = user, workspaceId = home) => t.post(`${api(workspaceId)}/maintenance/${record.id}/links`, { target }, cookie);
    expect(error(await link({ type: 'run', id: run.id }))).toEqual({ status: 409, error: 'already_linked' });
    expect(error(await link({ type: 'procedure', id: procedure.id }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await link({ type: 'contact', id: procedure.id }))).toEqual({ status: 400, error: 'invalid_link_target' });
    expect(error(await link({ type: 'procedure', id: record.id }))).toEqual({ status: 404, error: 'link_target_not_found' });
    expect(error(await link({ type: 'procedure', id: procedure.id }, outsider, office))).toEqual({ status: 404, error: 'maintenance_not_found' });
    const linkId = linked.json().link.id as string;
    expect(error(await t.post(`${api()}/maintenance-links/${linkId}/delete`, {}, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api(office)}/maintenance-links/${linkId}/delete`, {}, outsider))).toEqual({ status: 404, error: 'link_not_found' });
    expect(error(await t.post(`${api()}/document-links/${linkId}/delete`, {}, user))).toEqual({ status: 404, error: 'link_not_found' });
    expect((await t.post(`${api()}/maintenance-links/${linkId}/delete`, {}, user)).statusCode).toBe(204);
  });

  it('lets a guest read and nothing else, keeps Workspaces apart, and lets only an admin delete for good', async () => {
    const mine = await create({ title: 'Gutter cleaning' });
    const theirs = await create({ title: 'Payroll audit' }, outsider, office);
    const writes: [string, object][] = [
      ['/maintenance', { title: 'x' }],
      [`/maintenance/${mine.id}/update`, { title: 'x', expectedRevision: 1 }],
      [`/maintenance/${mine.id}/status`, { status: 'COMPLETED', expectedRevision: 1 }],
      [`/maintenance/${mine.id}/delete`, {}],
      [`/maintenance/${mine.id}/restore`, {}],
      [`/maintenance/${mine.id}/links`, { target: { type: 'procedure', id: mine.id } }],
      ['/maintenance/trash/purge', { all: true }],
      ['/maintenance-links/3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f/delete', {}],
    ];
    for (const [path, body] of writes) {
      expect({ path, ...error(await t.post(`${api()}${path}`, body, guest)) }).toEqual({ path, status: 403, error: 'forbidden' });
      expect({ path, status: (await t.post(`${api()}${path}`, body)).statusCode }).toEqual({ path, status: 401 });
      expect({ path, status: (await t.post(`${api()}${path}`, body, user, null)).statusCode }).toEqual({ path, status: 403 });
      expect({ path, ...error(await t.post(`${api()}${path}`, body, outsider)) }).toEqual({ path, status: 404, error: 'workspace_not_found' });
    }
    expect(error(await t.get(`${api()}/maintenance/trash`, guest))).toEqual({ status: 403, error: 'forbidden' });
    for (const [cookie, workspaceId, recordId] of [[outsider, office, mine.id], [owner, home, theirs.id]] as const) {
      expect(error(await t.get(`${api(workspaceId)}/maintenance/${recordId}`, cookie))).toEqual({ status: 404, error: 'maintenance_not_found' });
      expect(error(await t.get(`${api(workspaceId)}/maintenance/${recordId}/links`, cookie))).toEqual({ status: 404, error: 'maintenance_not_found' });
      expect(error(await t.post(`${api(workspaceId)}/maintenance/${recordId}/update`, { title: 'Taken', expectedRevision: 1 }, cookie))).toEqual({ status: 404, error: 'maintenance_not_found' });
      expect(error(await t.post(`${api(workspaceId)}/maintenance/${recordId}/delete`, {}, cookie))).toEqual({ status: 404, error: 'maintenance_not_found' });
    }
    expect((await t.get(`${api(office)}/maintenance?q=gutter`, outsider)).json().records).toEqual([]);
    expect((await t.get(`${api()}/maintenance/${mine.id}`, guest)).json().record).toMatchObject({ title: 'Gutter cleaning', status: 'PLANNED', revision: 1 });
    // Trash and permanent deletion.
    expect((await t.post(`${api()}/maintenance/${mine.id}/delete`, {}, user)).statusCode).toBe(204);
    expect((await t.get(`${api()}/maintenance/trash`, user)).json().records).toMatchObject([{ id: mine.id, title: 'Gutter cleaning', status: 'PLANNED', deletedBy: 'Uma' }]);
    expect((await t.post(`${api()}/maintenance/${mine.id}/restore`, {}, user)).json().record).toMatchObject({ title: 'Gutter cleaning' });
    await t.post(`${api()}/maintenance/${mine.id}/delete`, {}, user);
    for (const body of [{}, { recordIds: [] }, { all: false }, { all: true, recordIds: [mine.id] }]) expect({ body, ...error(await t.post(`${api()}/maintenance/trash/purge`, body, owner)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/maintenance/trash/purge`, { recordIds: [mine.id] }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api(office)}/maintenance/trash/purge`, { recordIds: [mine.id] }, outsider))).toEqual({ status: 404, error: 'maintenance_not_found' });
    expect((await t.post(`${api()}/maintenance/trash/purge`, { recordIds: [mine.id] }, owner)).json()).toEqual({ purged: 1 });
    expect(error(await t.post(`${api()}/maintenance/${mine.id}/restore`, {}, user))).toEqual({ status: 404, error: 'maintenance_not_found' });
  });

  it('has no route that adds costs up, and hides everything again when switched off', async () => {
    const routes = t.app.routeTable.map((route) => `${route.method} ${route.url}`).filter((route) => route.includes('maintenance'));
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) expect(route).not.toMatch(/total|sum|budget|cost|report|chart/i);
    const total = (await t.get(`${api()}/maintenance`, guest)).json().total as number;
    await t.post(`${api()}/tools`, { tool: 'MAINTENANCE', enabled: false }, owner);
    for (const cookie of [owner, user, guest]) {
      for (const path of ['/maintenance', '/maintenance/board', '/maintenance/filters', '/maintenance/trash']) expect({ path, ...error(await t.get(`${api()}${path}`, cookie)) }).toEqual({ path, status: 404, error: 'tool_not_enabled' });
      expect(error(await t.post(`${api()}/maintenance`, { title: 'x' }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
    }
    await t.post(`${api()}/tools`, { tool: 'MAINTENANCE', enabled: true }, owner);
    expect((await t.get(`${api()}/maintenance`, guest)).json().total).toBe(total); // nothing was deleted
  });

  it("feeds Today's Maintenance due soon card: open, dated, soon — read-only, per Workspace, Equipment only where shown (19.1)", async () => {
    const cabin = await t.createWorkspace('Cabin');
    await t.addMember(cabin, 'uma@example.org', 'USER');
    await t.addMember(cabin, 'gus@example.org', 'GUEST');
    const soon = (cookie: string, today = day(0), workspaceId = cabin) => t.get(`${api(workspaceId)}/maintenance/due-soon?today=${today}`, cookie);
    function day(offset: number) {
      return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    }
    expect(error(await soon(guest))).toEqual({ status: 404, error: 'tool_not_enabled' });
    await t.post(`${api(cabin)}/tools`, { tool: 'MAINTENANCE', enabled: true }, t.admin);
    expect((await soon(guest)).json()).toEqual({ items: [], total: 0 });
    const overdue = await create({ title: 'Chimney sweep', date: day(-20) }, user, cabin);
    const running = await create({ title: 'Roof repair', date: day(-2) }, user, cabin);
    await t.post(`${api(cabin)}/maintenance/${running.id}/status`, { status: 'IN_PROGRESS', expectedRevision: running.revision }, user);
    await create({ title: 'Gutter cleaning', date: day(3) }, user, cabin);
    await create({ title: 'Boiler check', date: day(14) }, user, cabin);
    await create({ title: 'Far away', date: day(15) }, user, cabin);
    await create({ title: 'Undated' }, user, cabin);
    const cancelled = await create({ title: 'Called off', date: day(1) }, user, cabin);
    await t.post(`${api(cabin)}/maintenance/${cancelled.id}/status`, { status: 'CANCELLED', expectedRevision: cancelled.revision }, user);
    const finished = await create({ title: 'Already done', date: day(1) }, user, cabin);
    await t.post(`${api(cabin)}/maintenance/${finished.id}/status`, { status: 'COMPLETED', expectedRevision: finished.revision, completedOn: day(0) }, user);
    const trashed = await create({ title: 'Thrown away', date: day(1) }, user, cabin);
    await t.post(`${api(cabin)}/maintenance/${trashed.id}/delete`, {}, user);
    // Planned and overdue stays; In progress from the past does not; three rows, soonest first, with the total.
    const answer = (await soon(guest)).json() as { items: { title: string; status: string; equipment: string | null }[]; total: number };
    expect(answer.items.map((item) => item.title)).toEqual(['Chimney sweep', 'Gutter cleaning', 'Boiler check']);
    expect(answer.total).toBe(3);
    expect(Object.keys(answer.items[0] ?? {}).sort()).toEqual(['date', 'equipment', 'id', 'status', 'title']);
    // A linked Equipment is named only while Equipment is on.
    const heater = (await t.post(`${api(cabin)}/equipment`, { name: 'Wood stove' }, t.admin)).json().record as { id: string } | undefined;
    expect(heater).toBeUndefined();
    await t.post(`${api(cabin)}/tools`, { tool: 'EQUIPMENT', enabled: true }, t.admin);
    const stove = (await t.post(`${api(cabin)}/equipment`, { name: 'Wood stove' }, t.admin)).json().record as { id: string };
    await t.post(`${api(cabin)}/maintenance/${overdue.id}/links`, { target: { type: 'equipment', id: stove.id } }, user);
    expect(((await soon(guest)).json().items as { equipment: string | null }[])[0]?.equipment).toBe('Wood stove');
    await t.post(`${api(cabin)}/tools`, { tool: 'EQUIPMENT', enabled: false }, t.admin);
    expect(((await soon(guest)).json().items as { equipment: string | null }[])[0]?.equipment).toBeNull();
    // Other Workspaces, outsiders and dates far from the server's day get nothing.
    expect((await soon(outsider, day(0), office)).json().items.map((item: { title: string }) => item.title)).not.toContain('Chimney sweep');
    expect((await soon(outsider)).statusCode).toBe(404);
    expect(error(await soon(guest, day(3)))).toMatchObject({ status: 400 });
    expect((await t.get(`${api(cabin)}/maintenance/due-soon`, guest)).statusCode).toBe(400);
  });
});

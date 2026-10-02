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
  if (/\/schedules\/:scheduleId\/(pause|end|cancel)$/.test(url)) return { expectedRevision: 1 };
  if (url.endsWith('/schedules/:scheduleId/resume')) return { expectedRevision: 1, skipElapsed: false };
  if (url.endsWith('/schedules/:scheduleId/skip-older')) return { before: TOMORROW };
  if (url.endsWith('/occurrences/:occurrenceId/move')) return { date: TOMORROW };
  if (url.endsWith('/occurrences/:occurrenceId/assign')) return { assigneeUserId: null };
  if (url.endsWith('/occurrences/:occurrenceId/link-run')) return { runId: ids.runId ?? '' };
  if (url.endsWith('/tools')) return { tool: 'DOCUMENTS', enabled: true };
  if (url.endsWith('/documents/:documentId/links')) return { target: { type: 'procedure', id: ids.procedureId ?? '' } };
  if (url.endsWith('/runs/:runId/documents')) return { documentId: ids.documentId ?? '' };
  if (url.endsWith('/remove-kept')) return { reason: 'Taken away', confirm: true };
  if (url.endsWith('/contacts') || url.endsWith('/contacts/duplicates')) return { name: 'Stolen contact' };
  if (url.endsWith('/contacts/trash/purge')) return { contactIds: [ids.contactId ?? ''] };
  if (url.endsWith('/contacts/import')) return { format: 'csv', contacts: [{ name: 'Stolen contact' }] };
  if (url.endsWith('/contacts/:contactId/update')) return { name: 'Taken over', expectedRevision: 1 };
  if (url.endsWith('/contacts/:contactId/procedures')) return { procedureId: ids.procedureId ?? '' };
  if (url.endsWith('/maintenance')) return { title: 'Stolen record' };
  if (url.endsWith('/maintenance/trash/purge')) return { recordIds: [ids.recordId ?? ''] };
  if (url.endsWith('/maintenance/:recordId/update')) return { title: 'Taken over', expectedRevision: 1 };
  if (url.endsWith('/maintenance/:recordId/status')) return { status: 'COMPLETED', expectedRevision: 1 };
  if (url.endsWith('/maintenance/:recordId/links')) return { target: { type: 'procedure', id: ids.procedureId ?? '' } };
  if (url.endsWith('/storage/limit')) return { bytes: null };
  if (url.endsWith('/trash/purge')) return { items: [{ kind: 'document', id: ids.documentId ?? '' }] };
  if (url.endsWith('/ceiling')) return { bytes: 1_000_000_000 };
  if (url.endsWith('/document-folders')) return { name: 'Stolen', parentId: ids.folderId ?? null };
  if (url.endsWith('/document-folders/:folderId/rename')) return { name: 'Taken over', expectedRevision: 1 };
  if (url.endsWith('/document-folders/:folderId/move')) return { parentId: null, expectedRevision: 1 };
  if (url.endsWith('/documents')) return { title: 'Stolen', folderId: ids.folderId ?? null, fileIds: [ids.fileId ?? ''] };
  if (url.endsWith('/documents/move')) return { documentIds: [ids.documentId ?? ''], folderId: null };
  if (url.endsWith('/documents/:documentId/update')) return { title: 'Taken over', expectedRevision: 1 };
  if (url.endsWith('/documents/:documentId/files')) return { fileIds: [ids.fileId ?? ''], expectedRevision: 1 };
  if (url.endsWith('/document-types')) return { name: 'Stolen type' };
  if (url.endsWith('/document-types/:typeId/rename')) return { name: 'Taken over' };
  if (url.endsWith('/lists')) return { title: 'Groceries' };
  if (url.endsWith('/lists/:listId/rename')) return { title: 'Taken over', expectedTitle: 'Groceries' };
  if (url.endsWith('/lists/:listId/items')) return { title: 'Stolen milk' };
  if (url.endsWith('/items/:itemId/update')) return { title: 'Stolen milk', expectedRevision: 1 };
  if (url.endsWith('/items/:itemId/check')) return { checked: true };
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
    // The calendar needs a valid range to reach the lookup instead of stopping at 400.
    const url = fill(pattern, values) + (/\/calendar\/?$/.test(pattern) ? `?from=${TOMORROW}&to=${TOMORROW}` : /\/(document|contact)-links$/.test(pattern) ? `?procedure=${values.procedureId ?? ''}` : /\/contacts\/(export|import\/preview)$/.test(pattern) ? '?format=csv' : '');
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
    const image = (
      await t.app.inject({
        method: 'POST',
        url: `/api/workspaces/${home}/images`,
        headers: { origin: 'https://vmn.example.org', cookie: owner, 'content-type': 'application/octet-stream' },
        // A 1×1 PNG.
        payload: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
      })
    ).json().image;
    // Documents are switched on in Home only: under Office every document route is 404 for that reason alone as well.
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    const file = (
      await t.app.inject({
        method: 'POST',
        url: `/api/workspaces/${home}/document-files`,
        headers: { origin: 'https://vmn.example.org', cookie: owner, 'content-type': 'application/octet-stream', 'x-file-name': 'Leave%20the%20house.png' },
        payload: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'),
      })
    ).json().file;
    await t.post(`/api/workspaces/${office}/tools`, { tool: 'DOCUMENTS', enabled: true }, outsider);
    // Contacts (16.6) likewise, in both.
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'CONTACTS', enabled: true }, owner);
    await t.post(`/api/workspaces/${office}/tools`, { tool: 'CONTACTS', enabled: true }, outsider);
    const contact = (await t.post(`/api/workspaces/${home}/contacts`, { name: 'Idraulico Rossi', phones: [{ value: '0471 123456' }] }, owner)).json().contact;
    await t.post(`/api/workspaces/${home}/contacts/${contact.id}/procedures`, { procedureId: procedure.id }, owner);
    // Maintenance (16.7), in both.
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'MAINTENANCE', enabled: true }, owner);
    await t.post(`/api/workspaces/${office}/tools`, { tool: 'MAINTENANCE', enabled: true }, outsider);
    const record = (await t.post(`/api/workspaces/${home}/maintenance`, { title: 'Boiler service', contactId: contact.id, cost: { amount: '120.00', currency: 'EUR' } }, owner)).json().record;
    await t.post(`/api/workspaces/${home}/maintenance/${record.id}/links`, { target: { type: 'run', id: run.id } }, owner);
    const folder = (await t.post(`/api/workspaces/${home}/document-folders`, { name: 'Water', parentId: null }, owner)).json().folder;
    const document = (await t.post(`/api/workspaces/${home}/documents`, { title: 'Water bill', folderId: folder.id, fileIds: [file.id] }, owner)).json().document;
    const documentType = (await t.post(`/api/workspaces/${home}/document-types`, { name: 'Minutes' }, owner)).json().type;
    const knot = (await t.post(`/api/workspaces/${home}/knots`, { target: { type: 'RUN', id: run.id }, label: 'x', expiresInDays: null }, owner)).json()
      .knot;
    const deleted = (await t.post(`/api/workspaces/${home}/procedures`, { ...PROCEDURE, title: 'Old' }, owner)).json().procedure;
    await t.post(`/api/workspaces/${home}/procedures/${deleted.id}/delete`, {}, owner);
    const uma = (await t.get('/api/auth/session', plainUser)).json().user.id as string;
    const scheduled = (await t.post(`/api/workspaces/${home}/schedules`, { procedureId: procedure.id, date: TOMORROW, timeZone: 'UTC', reminders: [] }, owner)).json()
      .schedule;
    const occurrence = (await t.get(`/api/workspaces/${home}/schedules/${scheduled.id}`, owner)).json().occurrences[0];
    const list = (await t.post(`/api/workspaces/${home}/lists`, { title: 'Groceries' }, owner)).json().list;
    const itemId = (await t.post(`/api/workspaces/${home}/lists/${list.id}/items`, { title: 'Milk' }, owner)).json().itemId;
    // Links (16.5): the Document linked to the Procedure, and a version of it retained for the Run.
    const link = (await t.post(`/api/workspaces/${home}/documents/${document.id}/links`, { target: { type: 'procedure', id: procedure.id } }, owner)).json().link;
    const runDocument = (await t.post(`/api/workspaces/${home}/runs/${run.id}/documents`, { documentId: document.id }, owner)).json().document;
    homeIds = {
      workspaceId: home,
      procedureId: procedure.id,
      runId: run.id,
      stepId: run.sections[0].steps[0].id,
      knotId: knot.id,
      userId: uma,
      scheduleId: scheduled.id,
      occurrenceId: occurrence.id,
      imageId: image.id,
      listId: list.id,
      itemId,
      fileId: file.id,
      page: '1',
      folderId: folder.id,
      documentId: document.id,
      typeId: documentType.id,
      linkId: link.id,
      runDocumentId: runDocument.id,
      contactId: contact.id,
      recordId: record.id,
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
    await t.restart(); // a fresh process: the sweeps before this one use up most of the global per-client limit
    for (const route of routes.filter((r) => r.includes('/workspaces/:workspaceId'))) {
      const response = await call(route, outsider, homeIds);
      expect({ route, status: response.statusCode }).toEqual({ route, status: 404 });
      expect(response.body).not.toContain('Leave the house');
      expect(response.body).not.toContain('Groceries');
      expect(response.body).not.toContain('Water');
      expect(response.body).not.toContain('Rossi');
      expect(response.body).not.toContain('Boiler');
      expect(response.body).not.toContain('120.00');
    }
  });

  it('never resolves a child id of one Workspace under another Workspace', async () => {
    // Otto administers Office and uses Home's Procedure/Run/Step/Knot/member ids under Office's id.
    const childRoutes = routes.filter((r) => (r.includes('/:workspaceId/') && /:(procedureId|runId|knotId|userId|scheduleId|occurrenceId|imageId|listId|itemId|fileId|folderId|documentId|typeId|linkId|runDocumentId|contactId|recordId)/.test(r)) || /^POST .*\/:workspaceId\/(runs|knots|schedules|documents|documents\/move|document-folders)$/.test(r));
    expect(childRoutes.length).toBeGreaterThan(10);
    await t.restart(); // a fresh process: the sweeps before this one use up most of the global per-client limit
    for (const route of childRoutes) {
      const response = await call(route, outsider, { ...homeIds, workspaceId: office });
      expect({ route, status: response.statusCode }).toEqual({ route, status: 404 });
      expect(response.body).not.toContain('Leave the house');
      expect(response.body).not.toContain('Water');
    }
    // Nothing of Home changed. (A fresh process first: the sweeps above come close to the global per-client limit.)
    await t.restart();
    const documents = (await t.get(`/api/workspaces/${homeIds.workspaceId}/documents/${homeIds.documentId}`, owner)).json().document;
    expect(documents).toMatchObject({ title: 'Water bill', revision: 1, folderId: homeIds.folderId, files: 1 });
    // … its Link and the version the Run retains included.
    const linked = (await t.get(`/api/workspaces/${homeIds.workspaceId}/documents/${homeIds.documentId}/links`, owner)).json();
    expect(linked).toMatchObject({ links: [{ id: homeIds.linkId, record: { type: 'procedure', state: 'ok' } }], runs: [{ id: homeIds.runDocumentId, runId: homeIds.runId }] });
    expect((await t.get(`/api/workspaces/${office}/document-links?procedure=${homeIds.procedureId}`, outsider)).json()).toEqual({ links: [] });
    // … and its Contact, with the Procedure linked to it.
    expect((await t.get(`/api/workspaces/${homeIds.workspaceId}/contacts/${homeIds.contactId}`, owner)).json().contact).toMatchObject({ name: 'Idraulico Rossi', revision: 1 });
    expect((await t.get(`/api/workspaces/${homeIds.workspaceId}/contacts/${homeIds.contactId}/procedures`, owner)).json().links).toHaveLength(1);
    expect((await t.get(`/api/workspaces/${office}/contacts`, outsider)).json()).toMatchObject({ contacts: [], total: 0 });
    expect((await t.get(`/api/workspaces/${office}/contact-links?procedure=${homeIds.procedureId}`, outsider)).json()).toEqual({ links: [] });
    // … and its MaintenanceRecord: status, revision and Link as they were.
    expect((await t.get(`/api/workspaces/${homeIds.workspaceId}/maintenance/${homeIds.recordId}`, owner)).json().record).toMatchObject({ title: 'Boiler service', status: 'PLANNED', revision: 1 });
    expect((await t.get(`/api/workspaces/${homeIds.workspaceId}/maintenance/${homeIds.recordId}/links`, owner)).json().links).toHaveLength(1);
    expect((await t.get(`/api/workspaces/${office}/maintenance`, outsider)).json()).toMatchObject({ records: [], total: 0 });
    const folders = (await t.get(`/api/workspaces/${homeIds.workspaceId}/document-folders`, owner)).json().folders;
    expect(folders).toEqual([{ id: homeIds.folderId, parentId: null, name: 'Water', revision: 1, documents: 1 }]);
    expect((await t.get(`/api/workspaces/${office}/document-folders`, outsider)).json().folders).toEqual([]);
    const run = (await t.get(`/api/workspaces/${homeIds.workspaceId}/runs/${homeIds.runId}`, owner)).json().run;
    expect(run.state).toBe('ACTIVE');
    expect(run.sections[0].steps[0].state).toBe('PENDING');
    const scheduled = (await t.get(`/api/workspaces/${homeIds.workspaceId}/schedules/${homeIds.scheduleId}`, owner)).json().schedule;
    expect(scheduled).toMatchObject({ state: 'ACTIVE', revision: 1 });
    const occurrence = (await t.get(`/api/workspaces/${homeIds.workspaceId}/occurrences/${homeIds.occurrenceId}`, owner)).json().occurrence;
    expect(occurrence).toMatchObject({ state: 'OPEN', revision: 1 });
    const list = (await t.get(`/api/workspaces/${homeIds.workspaceId}/lists/${homeIds.listId}`, owner)).json().list;
    expect(list).toMatchObject({ title: 'Groceries', deleted: false, items: [{ title: 'Milk', checked: null, revision: 1 }] });
  });

  it('rejects malformed identifiers without errors or data', async () => {
    const withParams = routes.filter((r) => r.includes('/:'));
    let sent = 0;
    for (const route of withParams) {
      for (const name of [...route.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string)) {
        // A page number is no id: its malformed forms are zero, signs, padding and anything beyond 500.
        for (const bad of name === 'page' ? ['not-a-uuid', '0', '01', '501', '-1'] : ['not-a-uuid', homeIds[name]?.toUpperCase() ?? 'X', '00000000-0000-0000-0000-000000000000']) {
          // Stay below the global per-client limit (in memory): a fresh process every 200 requests.
          if (sent++ % 200 === 0) await t.restart();
          const response = await call(route, owner, { ...homeIds, [name]: bad });
          expect({ route, name, bad, status: response.statusCode }).toEqual({ route, name, bad, status: expect.toSatisfy((s: number) => s === 400 || s === 404) });
        }
      }
    }
  });
});

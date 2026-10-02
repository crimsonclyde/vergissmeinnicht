import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const STEP = { title: 'Check pressure', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Boiler service', description: '', icon: 'home', tags: [], sections: [{ title: 'All', description: '', steps: [STEP] }] };

describe('Links and Document versions kept for Runs over HTTP (16.5)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let colour = 0;

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });
  const document = async (title: string, cookie = user, workspaceId = home) => {
    const bytes = await sharp({ create: { width: 64, height: 80, channels: 3, background: { r: (colour += 43) % 255, g: 20, b: 200 } } }).jpeg().toBuffer();
    const file = (await t.app.inject({ method: 'POST', url: `${api(workspaceId)}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'scan.jpg', origin: ORIGIN, cookie }, payload: bytes })).json().file as { id: string };
    const created = (await t.post(`${api(workspaceId)}/documents`, { title, folderId: null, fileIds: [file.id] }, cookie)).json().document as { id: string; revision: number };
    return { ...created, fileId: file.id, bytes };
  };

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
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    await t.post(`${api(office)}/tools`, { tool: 'DOCUMENTS', enabled: true }, outsider);
  }, 60_000);
  afterAll(async () => t.close());

  it('links a bill to a Reminder and a Procedure, shows it from both ends, and lets only managers of the same Workspace change that', async () => {
    const bill = await document('Geheime Wasserrechnung');
    const procedure = (await t.post(`${api()}/procedures`, PROCEDURE, owner)).json().procedure as { id: string };
    const reminder = (await t.post(`${api()}/schedules`, { title: 'Pay water bill', date: '2027-06-30', timeZone: 'UTC', reminders: [] }, user)).json().schedule as { id: string };
    const theirs = await document('Payroll', outsider, office);
    const theirProcedure = (await t.post(`${api(office)}/procedures`, PROCEDURE, outsider)).json().procedure as { id: string };
    /** `cookie` null = no session. */
    const add = (target: object, cookie: string | null = user, workspaceId = home, documentId = bill.id, origin?: null) => t.post(`${api(workspaceId)}/documents/${documentId}/links`, { target }, cookie ?? undefined, origin);

    const created = await add({ type: 'schedule', id: reminder.id });
    expect(created.statusCode).toBe(201);
    expect(created.json().link).toMatchObject({ record: { type: 'schedule', id: reminder.id, title: 'Pay water bill', state: 'ok', scheduleKind: 'REMINDER', nextDue: '2027-06-30' }, createdBy: 'Uma' });
    expect((await add({ type: 'procedure', id: procedure.id })).statusCode).toBe(201);
    // Both ends, for a guest too — titles and states only, no user ids, emails or storage names.
    const fromDocument = await t.get(`${api()}/documents/${bill.id}/links`, guest);
    expect(fromDocument.json().links.map((link: { record: { type: string } }) => link.record.type)).toEqual(['schedule', 'procedure']);
    expect(fromDocument.body).not.toMatch(/example\.org|UserId|[0-9a-f]{64}/);
    expect((await t.get(`${api()}/document-links?schedule=${reminder.id}`, guest)).json().links).toMatchObject([{ record: { type: 'document', id: bill.id, title: 'Geheime Wasserrechnung', state: 'ok' } }]);
    expect((await t.get(`${api()}/document-links?procedure=${procedure.id}`, guest)).json().links).toHaveLength(1);

    // Refusals with stable codes; none of them creates anything.
    expect(error(await add({ type: 'schedule', id: reminder.id }))).toEqual({ status: 409, error: 'already_linked' });
    expect(error(await add({ type: 'procedure', id: procedure.id }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await add({ type: 'procedure', id: procedure.id }, null)).statusCode).toBe(401);
    expect((await add({ type: 'procedure', id: procedure.id }, user, home, bill.id, null)).statusCode).toBe(403); // no Origin
    expect(error(await add({ type: 'procedure', id: procedure.id }, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await add({ type: 'procedure', id: theirProcedure.id }))).toEqual({ status: 404, error: 'link_target_not_found' });
    expect(error(await add({ type: 'document', id: theirs.id }))).toEqual({ status: 404, error: 'link_target_not_found' });
    expect(error(await add({ type: 'procedure', id: procedure.id }, outsider, office, theirs.id))).toEqual({ status: 404, error: 'link_target_not_found' });
    expect(error(await add({ type: 'procedure', id: theirProcedure.id }, outsider, office, bill.id))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await add({ type: 'document', id: bill.id }))).toEqual({ status: 400, error: 'link_to_itself' });
    expect(error(await add({ type: 'mailbox', id: bill.id }))).toEqual({ status: 400, error: 'invalid_link_target' });
    expect(error(await add({ type: 'procedure', id: 'nope' }))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await add({ type: 'procedure', id: procedure.id, workspaceId: office }))).toEqual({ status: 400, error: 'invalid_request' });
    for (const query of ['', `?procedure=${procedure.id}&schedule=${reminder.id}`, '?run=x', '?procedure=nope']) expect({ query, status: (await t.get(`${api()}/document-links${query}`, guest)).statusCode }).toEqual({ query, status: 400 });
    // From the Office, Home's records have no linked Documents and Home's Document is unknown.
    expect((await t.get(`${api(office)}/document-links?schedule=${reminder.id}`, outsider)).json()).toEqual({ links: [] });
    expect(error(await t.get(`${api(office)}/documents/${bill.id}/links`, outsider))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await t.get(`${api()}/documents/${bill.id}/links`, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });

    const linkId = fromDocument.json().links[0].id as string;
    expect(error(await t.post(`${api()}/document-links/${linkId}/delete`, {}, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api(office)}/document-links/${linkId}/delete`, {}, outsider))).toEqual({ status: 404, error: 'link_not_found' });
    expect((await t.post(`${api()}/document-links/${linkId}/delete`, {}, user)).statusCode).toBe(204);
    expect((await t.get(`${api()}/documents/${bill.id}/links`, guest)).json().links).toHaveLength(1);
    // In Trash: the Procedure's page names the Document only to those who can open Trash.
    await t.post(`${api()}/documents/${bill.id}/delete`, {}, user);
    expect((await t.get(`${api()}/document-links?procedure=${procedure.id}`, guest)).json().links[0].record).toMatchObject({ state: 'trash', title: null });
    expect((await t.get(`${api()}/document-links?procedure=${procedure.id}`, user)).json().links[0].record).toMatchObject({ state: 'trash', title: 'Geheime Wasserrechnung' });
  });

  it('keeps the linked Document version with a Run, serves its files to members only, and refuses removal once the Run is finished', async () => {
    const report = await document('Inspection report');
    const procedure = (await t.post(`${api()}/procedures`, { ...PROCEDURE, title: 'Chimney check' }, owner)).json().procedure as { id: string };
    const run = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, user)).json().run as { id: string; sections: { steps: { id: string }[] }[] };
    const theirRun = (await t.post(`${api(office)}/runs`, { procedureId: (await t.post(`${api(office)}/procedures`, PROCEDURE, outsider)).json().procedure.id }, outsider)).json().run as { id: string };
    const keep = (documentId: string, cookie: string | null = user, workspaceId = home, runId = run.id) => t.post(`${api(workspaceId)}/runs/${runId}/documents`, { documentId }, cookie ?? undefined);

    expect(error(await keep(report.id, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await keep(report.id, null)).statusCode).toBe(401);
    expect(error(await keep(report.id, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await keep(report.id, outsider, office, theirRun.id))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await keep(report.id, user, home, theirRun.id))).toEqual({ status: 404, error: 'run_not_found' });
    const kept = await keep(report.id);
    expect(kept.statusCode).toBe(201);
    const version = kept.json().document as { id: string; files: { id: string }[] };
    expect(kept.json().document).toMatchObject({ title: 'Inspection report', source: 'same', linkedBy: 'Uma' });
    expect(error(await keep(report.id))).toEqual({ status: 409, error: 'already_linked' });

    // The Document changes; the Run shows the version of then and still serves the same bytes.
    await t.post(`${api()}/documents/${report.id}/update`, { title: 'Report (corrected)', expectedRevision: report.revision }, user);
    const shown = (await t.get(`${api()}/runs/${run.id}/documents`, guest)).json().documents;
    expect(shown).toMatchObject([{ id: version.id, title: 'Inspection report', source: 'changed' }]);
    const original = await t.app.inject({ method: 'GET', url: `${api()}/document-files/${version.files[0]?.id}/original`, headers: { cookie: guest } });
    expect(original.rawPayload.equals(report.bytes)).toBe(true);
    expect((await t.get(`${api(office)}/document-files/${version.files[0]?.id}/original`, outsider)).statusCode).toBe(404);
    expect(error(await t.get(`${api(office)}/runs/${run.id}/documents`, outsider))).toEqual({ status: 404, error: 'run_not_found' });
    expect(error(await t.get(`${api()}/runs/${run.id}/documents`, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    // The Run's history gained one entry and lost none.
    const history = (await t.get(`${api()}/runs/${run.id}/history`, guest)).json().events as { type: string }[];
    expect(history.map((event) => event.type)).toEqual(['RUN_STARTED', 'RUN_DOCUMENT_LINKED']);

    // Finished: what the Run keeps stays.
    await t.post(`${api()}/runs/${run.id}/steps/${run.sections[0]?.steps[0]?.id}/state`, { expectedState: 'PENDING', state: 'DONE' }, user);
    expect((await t.post(`${api()}/runs/${run.id}/complete`, {}, user)).statusCode).toBeLessThan(300);
    expect(error(await t.post(`${api()}/runs/${run.id}/documents/${version.id}/remove`, {}, guest))).toEqual({ status: 403, error: 'forbidden' });
    for (const cookie of [user, owner]) expect(error(await t.post(`${api()}/runs/${run.id}/documents/${version.id}/remove`, {}, cookie))).toEqual({ status: 409, error: 'run_document_kept' });
    expect((await t.get(`${api()}/runs/${run.id}/documents`, guest)).json().documents).toHaveLength(1);

    // P4: a Workspace admin — nobody else — removes it from the finished Run, confirmed and with a reason.
    const removeKept = (body: object, cookie: string | null = owner, workspaceId = home, origin?: null) => t.post(`${api(workspaceId)}/runs/${run.id}/documents/${version.id}/remove-kept`, body, cookie ?? undefined, origin);
    const good = { reason: 'Linked to the wrong execution', confirm: true };
    for (const cookie of [user, guest]) expect(error(await removeKept(good, cookie))).toEqual({ status: 403, error: 'forbidden' });
    expect((await removeKept(good, null)).statusCode).toBe(401);
    expect((await removeKept(good, owner, home, null)).statusCode).toBe(403); // no Origin
    expect(error(await removeKept(good, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await removeKept(good, outsider, office))).toEqual({ status: 404, error: 'link_not_found' });
    for (const body of [{}, { reason: 'x' }, { reason: 'x', confirm: false }, { reason: 'x', confirm: 'yes' }, { confirm: true }, { ...good, title: 'x' }]) expect({ body, ...error(await removeKept(body)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    expect(error(await removeKept({ reason: '   ', confirm: true }))).toEqual({ status: 400, error: 'removal_reason_required' });
    expect(error(await removeKept({ reason: 'x'.repeat(501), confirm: true }))).toEqual({ status: 400, error: 'removal_reason_too_long' });
    expect((await t.get(`${api()}/runs/${run.id}/documents`, guest)).json().documents).toHaveLength(1); // nothing was removed by any of that
    const removed = await removeKept(good);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().removal).toMatchObject({ reason: 'Linked to the wrong execution', files: 1, removedBy: 'Olga', linkedBy: 'Uma' });
    // The Run shows a note in its place — to everyone who sees the Run — and nothing of the document.
    const after = await t.get(`${api()}/runs/${run.id}/documents`, guest);
    expect(after.json()).toMatchObject({ documents: [], removals: [{ reason: 'Linked to the wrong execution', removedBy: 'Olga' }] });
    expect(after.body).not.toMatch(/Inspection|Report \(corrected\)|scan\.jpg/);
    expect(after.body).not.toContain(report.id);
    expect(((await t.get(`${api()}/runs/${run.id}/history`, guest)).json().events as { type: string }[]).map((event) => event.type)).toEqual(['RUN_STARTED', 'RUN_DOCUMENT_LINKED', 'STEP_STATE_CHANGED', 'RUN_COMPLETED', 'RUN_DOCUMENT_REMOVED']);
    expect(error(await removeKept(good))).toEqual({ status: 404, error: 'link_not_found' });
    // The Document itself is untouched and still serves its file.
    expect((await t.get(`${api()}/documents/${report.id}`, guest)).json().document).toMatchObject({ title: 'Report (corrected)', files: 1 });
    expect((await t.app.inject({ method: 'GET', url: `${api()}/document-files/${version.files[0]?.id}/original`, headers: { cookie: guest } })).rawPayload.equals(report.bytes)).toBe(true);
    // Nothing of a Document in the server log.
    for (const secret of ['Geheime', 'Inspection report', 'Pay water bill']) expect(t.logs).not.toContain(secret);
  });
});

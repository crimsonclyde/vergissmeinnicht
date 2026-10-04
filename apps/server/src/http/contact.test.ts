import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const STEP = { title: 'Check pressure', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Boiler service', description: '', icon: 'home', tags: [], sections: [{ title: 'All', description: '', steps: [STEP] }] };

describe('Contacts over HTTP (16.6)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });
  const create = async (body: object, cookie = user, workspaceId = home) => (await t.post(`${api(workspaceId)}/contacts`, body, cookie)).json().contact as { id: string; revision: number };
  /** An import file as the raw request body. */
  const preview = (format: string, file: string | Buffer, cookie: string | null = user, workspaceId = home, origin: string | null = ORIGIN) =>
    t.app.inject({
      method: 'POST',
      url: `${api(workspaceId)}/contacts/import/preview?format=${format}`,
      headers: { 'content-type': 'application/octet-stream', ...(origin === null ? {} : { origin }), ...(cookie === null ? {} : { cookie }) },
      payload: typeof file === 'string' ? Buffer.from(file, 'utf8') : file,
    });

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
    await t.post(`${api(office)}/tools`, { tool: 'CONTACTS', enabled: true }, outsider);
  }, 60_000);
  afterAll(async () => t.close());

  it('does not exist until a Workspace admin switches it on', async () => {
    expect(error(await t.get(`${api()}/contacts`, owner))).toEqual({ status: 404, error: 'tool_not_enabled' });
    expect(error(await t.post(`${api()}/contacts`, { name: 'Early' }, owner))).toEqual({ status: 404, error: 'tool_not_enabled' });
    expect(error(await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: true }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: true }, owner)).json()).toEqual({ tools: ['CALENDAR', 'CONTACTS', 'LISTS', 'PROCEDURES', 'REMINDERS'], revision: 1 });
    expect((await t.get(`${api()}`, guest)).json()).toMatchObject({ tools: ['CALENDAR', 'CONTACTS', 'LISTS', 'PROCEDURES', 'REMINDERS'], capabilities: expect.arrayContaining(['contact.view']) });
    expect((await t.get(`${api()}/contacts`, guest)).json()).toEqual({ contacts: [], nextCursor: null, total: 0 });
  });

  it('creates, shows, changes and finds Contacts; links are built by the server from checked values only', async () => {
    const created = await t.post(`${api()}/contacts`, { name: 'Idraulico Rossi' }, user);
    expect(created.statusCode).toBe(201);
    const plumber = created.json().contact as { id: string };
    expect(created.json()).toMatchObject({ contact: { name: 'Idraulico Rossi', emails: [], phones: [], website: '', revision: 1, createdBy: 'Uma' }, duplicates: [] });
    const updated = await t.post(`${api()}/contacts/${plumber.id}/update`, { name: 'Idraulico Rossi', category: 'Plumber', phones: [{ value: '+39 (0471) 12-34-56', label: 'Office' }, { value: '333 1234567' }], emails: [{ value: 'Mario+Bills@Example.org' }], website: 'rossi.example/x', expectedRevision: 1 }, user);
    expect(updated.json().contact).toMatchObject({
      revision: 2,
      phones: [
        { value: '+39 (0471) 12-34-56', label: 'Office', href: 'tel:+390471123456' },
        { value: '333 1234567', label: '', href: 'tel:3331234567' },
      ],
      emails: [{ value: 'mario+bills@example.org', label: '', href: 'mailto:mario%2Bbills@example.org' }],
      website: 'https://rossi.example/x',
    });
    // A guest sees it — display names only, no account data.
    const seen = await t.get(`${api()}/contacts/${plumber.id}`, guest);
    expect(seen.json().contact).toMatchObject({ name: 'Idraulico Rossi', category: 'Plumber', modifiedBy: 'Uma' });
    expect(seen.body).not.toMatch(/uma@example\.org|UserId/);
    expect((await t.get(`${api()}/contacts?q=0471123456`, guest)).json()).toMatchObject({ contacts: [{ id: plumber.id }], total: 1 });
    expect((await t.get(`${api()}/contacts?category=plumber&q=rossi`, guest)).json().contacts).toHaveLength(1);
    expect((await t.get(`${api()}/contacts?q=nobody`, guest)).json().contacts).toEqual([]);
    expect((await t.get(`${api()}/contacts/categories`, guest)).json()).toEqual({ categories: ['Plumber'] });
    // Refusals with stable codes; nothing harmful is stored.
    for (const [body, code] of [
      [{ name: 'x', website: 'javascript:alert(1)' }, 'invalid_website'],
      [{ name: 'x', website: 'data:text/html,<script>1</script>' }, 'invalid_website'],
      [{ name: 'x', phones: [{ value: 'tel:112;ext=<script>' }] }, 'invalid_phone'],
      [{ name: 'x', emails: [{ value: 'a@b.example?bcc=evil@example.org' }] }, 'invalid_email'],
      [{ name: '  ' }, 'contact_name_empty'],
      [{ name: 'x\u202Ey' }, 'contact_name_invalid_characters'],
    ] as const) {
      expect({ body, ...error(await t.post(`${api()}/contacts`, body, user)) }).toEqual({ body, status: 400, error: code });
    }
    for (const body of [{}, { name: 'x', id: plumber.id }, { name: 'x', emails: 'a@example.org' }, { name: 'x', phones: [{ number: '112' }] }, { name: 1 }]) expect({ body, ...error(await t.post(`${api()}/contacts`, body, user)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/contacts/${plumber.id}/update`, { name: 'Stale', expectedRevision: 1 }, user))).toEqual({ status: 409, error: 'contact_conflict' });
    expect(error(await t.get(`${api()}/contacts?cursor=AAAA`, guest))).toEqual({ status: 400, error: 'invalid_cursor' });
    expect(error(await t.get(`${api()}/contacts?sort=name`, guest))).toEqual({ status: 400, error: 'invalid_request' });
    // A possible duplicate is pointed out and saved all the same.
    const twin = await t.post(`${api()}/contacts`, { name: 'Rossi (mobile)', phones: [{ value: '0039 0471 123456' }] }, user);
    expect(twin.statusCode).toBe(201);
    expect(twin.json().duplicates).toEqual([{ id: plumber.id, name: 'Idraulico Rossi', organisation: '', reasons: ['phone'] }]);
    expect((await t.post(`${api()}/contacts/duplicates`, { name: 'rossi idraulico' }, guest)).json().duplicates).toMatchObject([{ id: plumber.id, reasons: ['name'] }]);
    expect((await t.get(`${api()}/contacts`, guest)).json().total).toBe(2);
  });

  it('lets a guest read and nothing else, and keeps Workspaces apart', async () => {
    const mine = await create({ name: 'Elettricista Bianchi' });
    const theirs = await create({ name: 'Payroll office' }, outsider, office);
    const procedure = (await t.post(`${api()}/procedures`, PROCEDURE, owner)).json().procedure as { id: string };
    const writes: [string, object][] = [
      ['/contacts', { name: 'x' }],
      [`/contacts/${mine.id}/update`, { name: 'x', expectedRevision: 1 }],
      [`/contacts/${mine.id}/delete`, {}],
      [`/contacts/${mine.id}/restore`, {}],
      [`/contacts/${mine.id}/procedures`, { procedureId: procedure.id }],
      ['/contacts/import', { format: 'csv', contacts: [{ name: 'x' }] }],
      ['/contacts/trash/purge', { all: true }],
      ['/contact-links/3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f/delete', {}],
    ];
    for (const [path, body] of writes) {
      expect({ path, ...error(await t.post(`${api()}${path}`, body, guest)) }).toEqual({ path, status: 403, error: 'forbidden' });
      expect({ path, status: (await t.post(`${api()}${path}`, body)).statusCode }).toEqual({ path, status: 401 });
      expect({ path, status: (await t.post(`${api()}${path}`, body, user, null)).statusCode }).toEqual({ path, status: 403 }); // no Origin
      expect({ path, ...error(await t.post(`${api()}${path}`, body, outsider)) }).toEqual({ path, status: 404, error: 'workspace_not_found' });
    }
    for (const path of ['/contacts/trash', '/contacts/export?format=csv', '/contacts/export?format=vcard']) expect({ path, ...error(await t.get(`${api()}${path}`, guest)) }).toEqual({ path, status: 403, error: 'forbidden' });
    expect(error(await preview('csv', 'Name\nx', guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await preview('csv', 'Name\nx', null)).statusCode).toBe(401);
    expect((await preview('csv', 'Name\nx', user, home, null)).statusCode).toBe(403);
    expect(error(await t.post(`${api()}/contacts/trash/purge`, { all: true }, user))).toEqual({ status: 403, error: 'forbidden' });
    // Ids of one Workspace under the other resolve to nothing.
    for (const [cookie, workspaceId, contactId] of [[outsider, office, mine.id], [owner, home, theirs.id]] as const) {
      expect(error(await t.get(`${api(workspaceId)}/contacts/${contactId}`, cookie))).toEqual({ status: 404, error: 'contact_not_found' });
      expect(error(await t.post(`${api(workspaceId)}/contacts/${contactId}/update`, { name: 'Taken', expectedRevision: 1 }, cookie))).toEqual({ status: 404, error: 'contact_not_found' });
      expect(error(await t.post(`${api(workspaceId)}/contacts/${contactId}/delete`, {}, cookie))).toEqual({ status: 404, error: 'contact_not_found' });
    }
    expect(error(await t.post(`${api()}/contacts/${mine.id}/procedures`, { procedureId: procedure.id }, user))).toEqual({ status: 201, error: undefined });
    expect((await t.get(`${api()}/contact-links?procedure=${procedure.id}`, guest)).json().links).toMatchObject([{ contact: { id: mine.id, name: 'Elettricista Bianchi' } }]);
    expect((await t.get(`${api(office)}/contact-links?procedure=${procedure.id}`, outsider)).json()).toEqual({ links: [] });
    expect((await t.get(`${api(office)}/contacts?q=bianchi`, outsider)).json().contacts).toEqual([]);
    expect((await t.get(`${api()}/contacts/${mine.id}`, guest)).json().contact).toMatchObject({ name: 'Elettricista Bianchi', revision: 1 });
  });

  it('previews CSV and vCard imports, saves what was confirmed, and exports files that do no harm', async () => {
    await create({ name: 'Known Person', emails: [{ value: 'known@example.org' }] });
    const csv = 'Name;Email;Phone;Notes;Shoe size\n=cmd|calc;formula@example.org;+39 0471 555;"two\nlines";42\nKnown again;KNOWN@example.org;;;\nBroken;;not a number;;\n';
    const shown = await preview('csv', csv);
    expect(shown.statusCode).toBe(200);
    expect(shown.json()).toMatchObject({
      ignored: ['Shoe size'],
      entries: [
        { line: 2, name: '=cmd|calc', contact: { name: '=cmd|calc', emails: [{ value: 'formula@example.org', label: '' }], phones: [{ value: '+39 0471 555', label: '' }], notes: 'two\nlines' }, problem: null, duplicates: [] },
        { line: 4, name: 'Known again', problem: null, duplicates: [{ name: 'Known Person', reasons: ['email'] }] },
        { line: 5, name: 'Broken', contact: null, problem: { code: 'invalid_phone', field: 'phone' } },
      ],
    });
    const before = (await t.get(`${api()}/contacts`, guest)).json().total as number;
    const vcard = await preview('vcard', 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Card Person\r\nTEL;TYPE=CELL:0171 1234567\r\nPHOTO;ENCODING=b:AAAA\r\nEND:VCARD\r\n');
    expect(vcard.json()).toMatchObject({ ignored: ['PHOTO'], entries: [{ name: 'Card Person', contact: { phones: [{ value: '0171 1234567', label: 'Mobile' }] } }] });
    // Files that cannot be used at all: a stable reason, never their content.
    for (const [format, file, status, reason] of [
      ['csv', 'Name\n"never closed', 422, 'contact_import_malformed'],
      ['csv', 'Colour\nred', 422, 'contact_import_no_name_column'],
      ['csv', '', 422, 'contact_import_empty'],
      ['csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), 422, 'contact_import_not_text'],
      ['vcard', 'FN:outside a card', 422, 'contact_import_malformed'],
      ['vcard', 'BEGIN:VCARD\nFN:x\nEND:VCARD\n'.repeat(1001), 422, 'contact_import_too_many'],
    ] as const) {
      const refused = await preview(format, file);
      expect({ format, reason, status: refused.statusCode, body: refused.json() }).toMatchObject({ format, reason, status, body: { error: 'contact_import_refused', reason } });
    }
    expect((await preview('csv', Buffer.alloc(1024 * 1024 + 1, 0x61))).statusCode).toBe(413);
    expect(error(await preview('xml', 'Name\nx'))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/contacts/import/preview?format=csv`, { name: 'json instead of a file' }, user))).toEqual({ status: 400, error: 'invalid_request' });
    expect((await t.get(`${api()}/contacts`, guest)).json().total).toBe(before); // looking saved nothing

    // The person confirms two of the entries.
    const chosen = (shown.json().entries as { name: string; contact: object | null }[]).filter((entry) => entry.contact !== null).map((entry) => entry.contact);
    const imported = await t.post(`${api()}/contacts/import`, { format: 'csv', contacts: chosen }, user);
    expect({ status: imported.statusCode, body: imported.json() }).toEqual({ status: 201, body: { created: 2 } });
    expect((await t.get(`${api()}/contacts`, guest)).json().total).toBe(before + 2);
    // All or nothing, checked again on the server.
    expect(error(await t.post(`${api()}/contacts/import`, { format: 'csv', contacts: [{ name: 'Fine' }, { name: 'Bad', website: 'javascript:alert(1)' }] }, user))).toEqual({ status: 400, error: 'invalid_website' });
    expect(error(await t.post(`${api()}/contacts/import`, { format: 'csv', contacts: [] }, user))).toEqual({ status: 400, error: 'invalid_request' });
    expect((await t.get(`${api()}/contacts`, guest)).json().total).toBe(before + 2);

    // Export: downloads, never shown in place; formulas neutralised in CSV, values escaped in vCard.
    const asCsv = await t.get(`${api()}/contacts/export?format=csv`, user);
    expect(asCsv.statusCode).toBe(200);
    expect(asCsv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(asCsv.headers['content-disposition']).toMatch(/^attachment; filename="Contacts - \d{4}-\d{2}-\d{2}\.csv"/);
    expect(asCsv.headers['x-content-type-options']).toBe('nosniff');
    expect(asCsv.body).toContain("'=cmd|calc,");
    expect(asCsv.body).toContain(",'+39 0471 555,");
    expect(asCsv.body).not.toMatch(/(^|,|\n)[=+@-]/);
    const asVcard = await t.get(`${api()}/contacts/export?format=vcard`, user);
    expect(asVcard.headers['content-type']).toBe('text/vcard; charset=utf-8');
    expect(asVcard.headers['content-disposition']).toMatch(/^attachment; filename="Contacts - \d{4}-\d{2}-\d{2}\.vcf"/);
    expect(asVcard.body).toContain('FN:=cmd|calc\r\n');
    expect(asVcard.body).toContain('NOTE:two\\nlines\r\n');
    expect(error(await t.get(`${api()}/contacts/export`, user))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await t.get(`${api()}/contacts/export?format=html`, user))).toEqual({ status: 400, error: 'invalid_request' });
    // What was exported re-imports to the same Contacts.
    const again = (await preview('vcard', asVcard.body, outsider, office)).json().entries as { contact: { name: string } | null }[];
    expect(again.map((entry) => entry.contact?.name).sort()).toEqual(((await t.get(`${api()}/contacts`, guest)).json().contacts as { name: string }[]).map((contact) => contact.name).sort());
  });

  it('moves Contacts to Trash and lets only an admin delete them for good', async () => {
    const contact = await create({ name: 'Segreto Verdi', phones: [{ value: '333 7777777' }] });
    expect((await t.post(`${api()}/contacts/${contact.id}/delete`, {}, user)).statusCode).toBe(204);
    expect(error(await t.get(`${api()}/contacts/${contact.id}`, guest))).toEqual({ status: 404, error: 'contact_not_found' });
    expect((await t.get(`${api()}/contacts/trash`, user)).json().contacts).toMatchObject([{ id: contact.id, name: 'Segreto Verdi', deletedBy: 'Uma' }]);
    expect((await t.post(`${api()}/contacts/${contact.id}/restore`, {}, user)).json().contact).toMatchObject({ name: 'Segreto Verdi' });
    await t.post(`${api()}/contacts/${contact.id}/delete`, {}, user);
    for (const body of [{}, { contactIds: [] }, { all: false }, { all: true, contactIds: [contact.id] }]) expect({ body, ...error(await t.post(`${api()}/contacts/trash/purge`, body, owner)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/contacts/trash/purge`, { contactIds: [contact.id] }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api(office)}/contacts/trash/purge`, { contactIds: [contact.id] }, outsider))).toEqual({ status: 404, error: 'contact_not_found' });
    expect((await t.post(`${api()}/contacts/trash/purge`, { contactIds: [contact.id] }, owner)).json()).toEqual({ purged: 1 });
    expect((await t.get(`${api()}/contacts/trash`, user)).json().contacts).toEqual([]);
    expect(error(await t.post(`${api()}/contacts/${contact.id}/restore`, {}, user))).toEqual({ status: 404, error: 'contact_not_found' });
  });

  it('exports exactly the selected live Contact, scoped and audited without names', async () => {
    const selected = await create({ name: 'Phone-only contact', phones: [{ value: '+49 171 7654321', label: 'Mobile' }], emails: [{ value: 'phone-only@example.org', label: 'Work' }] });
    const other = await create({ name: 'Unselected contact' });
    const url = (id: string, workspace = home) => `${api(workspace)}/contacts/export?format=vcard&contact=${id}`;
    const response = await t.get(url(selected.id), user);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/vcard');
    expect(response.headers['content-disposition']).toMatch(/^attachment;.*Contact - /);
    expect(response.body.match(/BEGIN:VCARD/g)).toHaveLength(1);
    expect(response.body).toContain('FN:Phone-only contact');
    expect(response.body).toContain('TEL;TYPE=CELL:+49 171 7654321');
    expect(response.body).not.toContain('Unselected contact');
    expect(response.body).not.toContain('Rossi');
    const events = t.database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type='CONTACTS_EXPORTED'").all() as { metadata: string }[];
    expect(JSON.parse(events.at(-1)?.metadata ?? '{}')).toMatchObject({ format: 'vcard', contacts: 1, contactId: selected.id });
    expect(JSON.stringify(events)).not.toContain('Phone-only contact');
    expect(error(await t.app.inject({ method: 'GET', url: url(selected.id) }))).toEqual({ status: 401, error: 'unauthenticated' });
    expect(error(await t.get(url(selected.id), guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.get(url(selected.id), outsider)).statusCode).toBe(404);
    expect(error(await t.get(url(selected.id, office), outsider))).toEqual({ status: 404, error: 'contact_not_found' });
    expect(error(await t.get(url('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f'), owner))).toEqual({ status: 404, error: 'contact_not_found' });
    expect(error(await t.get(url('bad'), owner))).toEqual({ status: 400, error: 'invalid_request' });
    await t.post(`${api()}/contacts/${selected.id}/delete`, {}, user);
    expect(error(await t.get(url(selected.id), owner))).toEqual({ status: 404, error: 'contact_not_found' });
    expect(t.database.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE type='CONTACTS_EXPORTED'").get()).toEqual({ n: events.length });
    // Leave no additional active Contact for later suite expectations.
    await t.post(`${api()}/contacts/${other.id}/delete`, {}, user);
  });

  it('writes no name, address or number of a Contact to the log, and hides everything again when switched off', async () => {
    const logged = t.logs;
    for (const secret of ['Rossi', 'Segreto', '7777777', 'known@example.org', 'formula@example.org', 'Bianchi']) expect({ secret, logged: logged.includes(secret) }).toEqual({ secret, logged: false });
    const total = (await t.get(`${api()}/contacts`, guest)).json().total as number;
    await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: false }, owner);
    for (const cookie of [owner, user, guest]) {
      for (const path of ['/contacts', '/contacts/categories', '/contacts/trash', '/contacts/export?format=csv', '/contacts/export?format=vcard&contact=3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', '/contact-links?procedure=3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f']) expect({ path, ...error(await t.get(`${api()}${path}`, cookie)) }).toEqual({ path, status: 404, error: 'tool_not_enabled' });
      expect(error(await t.post(`${api()}/contacts`, { name: 'x' }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
      expect(error(await preview('csv', 'Name\nx', cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
    }
    await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: true }, owner);
    expect((await t.get(`${api()}/contacts`, guest)).json().total).toBe(total); // nothing was deleted
  });
});

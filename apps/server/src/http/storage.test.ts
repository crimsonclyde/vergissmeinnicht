import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';

describe('Workspace storage, export and permanent deletion over HTTP (16.4)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let colour = 0;
  const photos: Buffer[] = [];

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });
  const upload = async (name: string, cookie = user, workspaceId = home) => {
    const bytes = await sharp({ create: { width: 64, height: 80, channels: 3, background: { r: (colour += 41) % 255, g: 120, b: 60 } } }).jpeg().toBuffer();
    photos.push(bytes);
    const response = await t.app.inject({ method: 'POST', url: `${api(workspaceId)}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), origin: ORIGIN, cookie }, payload: bytes });
    return { id: response.json().file.id as string, bytes };
  };
  const document = async (title: string, folderId: string | null, names: string[], cookie = user, workspaceId = home) => {
    const files = [];
    for (const name of names) files.push(await upload(name, cookie, workspaceId));
    const created = (await t.post(`${api(workspaceId)}/documents`, { title, folderId, fileIds: files.map((file) => file.id) }, cookie)).json().document as { id: string };
    return { id: created.id, files };
  };
  const raw = (url: string, cookie?: string) => t.app.inject({ method: 'GET', url, headers: cookie === undefined ? {} : { cookie } });

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

  it('shows a Workspace admin the storage by tool and lets them lower the limit; the ceiling is the server admin’s', async () => {
    await document('Contract', null, ['contract.jpg']);
    const storage = (await t.get(`${api()}/storage`, owner)).json().storage;
    expect(storage).toMatchObject({ imageBytes: 0, trashBytes: 0, limitBytes: 5_000_000_000, ceilingBytes: 5_000_000_000, ownLimitBytes: null });
    expect(storage.documentBytes).toBe(photos[0]?.length);
    expect(storage.usedBytes).toBe(storage.documentBytes + storage.previewBytes);
    // Members who are not admins see no breakdown; outsiders no Workspace; nobody without a session anything.
    for (const cookie of [user, guest]) {
      expect(error(await t.get(`${api()}/storage`, cookie))).toEqual({ status: 403, error: 'forbidden' });
      expect(error(await t.post(`${api()}/storage/limit`, { bytes: 1_000_000_000 }, cookie))).toEqual({ status: 403, error: 'forbidden' });
    }
    expect(error(await t.get(`${api()}/storage`, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await t.post(`${api()}/storage/limit`, { bytes: 1_000_000_000 }, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect((await t.get(`${api()}/storage`)).statusCode).toBe(401);
    expect((await t.post(`${api()}/storage/limit`, { bytes: 1_000_000_000 }, owner, null)).statusCode).toBe(403); // no Origin
    // … but every member learns used and limit (and is told when an upload is refused).
    expect((await t.get(`${api()}/document-files/usage`, guest)).json().usage).toEqual({ usedBytes: storage.usedBytes, limitBytes: 5_000_000_000 });

    expect((await t.post(`${api()}/storage/limit`, { bytes: 1_000_000_000 }, owner)).json().storage).toMatchObject({ limitBytes: 1_000_000_000, ownLimitBytes: 1_000_000_000, ceilingBytes: 5_000_000_000 });
    expect(error(await t.post(`${api()}/storage/limit`, { bytes: 6_000_000_000 }, owner))).toEqual({ status: 400, error: 'storage_limit_above_ceiling' });
    expect(error(await t.post(`${api()}/storage/limit`, { bytes: 5 }, owner))).toEqual({ status: 400, error: 'invalid_storage_limit' });
    expect(error(await t.post(`${api()}/storage/limit`, { bytes: '1000000000' }, owner))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/storage/limit`, { bytes: 1_000_000_000, ceilingBytes: 9_000_000_000 }, owner))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await t.post(`${api()}/storage/limit`, {}, owner))).toEqual({ status: 400, error: 'invalid_request' });
    // A Workspace admin is no server admin: the ceiling is not theirs, and neither is the list of all Workspaces.
    expect((await t.post(`/api/admin/storage/${home}/ceiling`, { bytes: 9_000_000_000 }, owner)).statusCode).toBe(403);
    expect((await t.get('/api/admin/storage', owner)).statusCode).toBe(403);
    expect((await t.post(`/api/admin/storage/${home}/ceiling`, { bytes: 9_000_000_000 })).statusCode).toBe(401);
    expect((await t.post(`/api/admin/storage/${home}/ceiling`, { bytes: 500_000_000 }, t.admin)).statusCode).toBe(204);
    expect(error(await t.post('/api/admin/storage/3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f/ceiling', { bytes: 500_000_000 }, t.admin))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect((await t.get(`${api()}/storage`, owner)).json().storage).toMatchObject({ limitBytes: 500_000_000, ceilingBytes: 500_000_000, ownLimitBytes: 1_000_000_000 });
    const listed = (await t.get('/api/admin/storage', t.admin)).json().workspaces as { id: string; name: string; ceilingBytes: number; usedBytes: number }[];
    expect(listed.map((each) => [each.name, each.ceilingBytes])).toEqual([
      ['Home', 500_000_000],
      ['Office', 5_000_000_000],
    ]);
    expect((await t.post(`${api()}/storage/limit`, { bytes: null }, owner)).json().storage.ownLimitBytes).toBeNull();
    // A full Workspace says how full: the same answer for a Document file and an instruction image.
    t.database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = ? WHERE id = ?').run(storage.usedBytes + 10, home);
    const refused = await t.app.inject({ method: 'POST', url: `${api()}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'more.jpg', origin: ORIGIN, cookie: user }, payload: photos[0] ?? Buffer.alloc(0) });
    expect(refused.statusCode === 201 || refused.statusCode === 409).toBe(true); // identical content is charged once …
    const other = await sharp({ create: { width: 90, height: 90, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
    const full = await t.app.inject({ method: 'POST', url: `${api()}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'new.png', origin: ORIGIN, cookie: user }, payload: other });
    expect(full.json()).toMatchObject({ error: 'storage_full', limitBytes: storage.usedBytes + 10 }); // … new content is refused
    const image = await t.app.inject({ method: 'POST', url: `${api()}/images`, headers: { 'content-type': 'application/octet-stream', origin: ORIGIN, cookie: owner }, payload: other });
    expect(image.json()).toMatchObject({ error: 'storage_full', limitBytes: storage.usedBytes + 10 });
    t.database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = 5000000000 WHERE id = ?').run(home);
  });

  it('exports a Folder as a ZIP of the originals — for a guest too — and nothing of Trash or another Workspace', async () => {
    const water = (await t.post(`${api()}/document-folders`, { name: 'Water', parentId: null }, user)).json().folder as { id: string };
    const bill = await document('Water bill <March>', water.id, ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg']);
    const thrown = await document('Geheim im Papierkorb', water.id, ['trash.jpg']);
    await t.post(`${api()}/documents/${thrown.id}/delete`, {}, user);
    const theirs = await document('Payroll', null, ['payroll.jpg'], outsider, office);

    const size = bill.files.reduce((sum, file) => sum + file.bytes.length, 0);
    expect((await t.get(`${api()}/documents/export/check?folder=${water.id}`, guest)).json()).toEqual({ export: { documents: 1, files: 3, bytes: size, maxFiles: 5000, maxBytes: 2_000_000_000 } });
    const zip = await raw(`${api()}/documents/export?folder=${water.id}`, guest);
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(String(zip.headers['content-disposition'])).toMatch(/^attachment; filename="Documents - Water - \d{4}-\d{2}-\d{2}\.zip"/);
    expect(zip.headers['x-content-type-options']).toBe('nosniff');
    expect(zip.headers['cache-control']).toBe('no-store');
    const body = zip.rawPayload;
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
    // Stored without compression: the originals are in the archive byte for byte.
    for (const file of bill.files) expect(body.includes(file.bytes)).toBe(true);
    for (const name of ['index.html', 'metadata.json', 'Water/Water bill _March_/01 - IMG_0001.jpg', 'Water/Water bill _March_/03 - IMG_0003.jpg']) expect({ name, there: body.includes(Buffer.from(name)) }).toEqual({ name, there: true });
    expect(body.includes(thrown.files[0]?.bytes ?? Buffer.from('x'))).toBe(false);
    expect(body.includes(Buffer.from('Papierkorb'))).toBe(false);
    // Everything, and a selection.
    const all = await raw(`${api()}/documents/export`, user);
    expect(all.rawPayload.includes(bill.files[1]?.bytes ?? Buffer.from('x'))).toBe(true);
    expect(all.rawPayload.includes(theirs.files[0]?.bytes ?? Buffer.from('x'))).toBe(false);
    expect((await raw(`${api()}/documents/export?document=${bill.id}`, guest)).statusCode).toBe(200);

    // Refused, with stable codes: no session, an outsider, the other Workspace's ids, Trash, a bad scope.
    expect((await raw(`${api()}/documents/export`)).statusCode).toBe(401);
    expect((await raw(`${api()}/documents/export/check`)).statusCode).toBe(401);
    expect(error(await raw(`${api()}/documents/export`, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await raw(`${api(office)}/documents/export?folder=${water.id}`, outsider))).toEqual({ status: 404, error: 'folder_not_found' });
    expect(error(await raw(`${api(office)}/documents/export?document=${bill.id}`, outsider))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await raw(`${api()}/documents/export/check?document=${theirs.id}`, guest))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await raw(`${api()}/documents/export?document=${thrown.id}`, guest))).toEqual({ status: 404, error: 'document_not_found' });
    expect(error(await raw(`${api()}/documents/export?folder=${water.id}&document=${bill.id}`, guest))).toEqual({ status: 400, error: 'invalid_export_scope' });
    expect(error(await raw(`${api()}/documents/export?folder=..%2F..`, guest))).toEqual({ status: 400, error: 'invalid_request' });
    expect(error(await raw(`${api()}/documents/export?path=%2Fetc`, guest))).toEqual({ status: 400, error: 'invalid_request' });
    // Recorded in the Workspace's audit trail — the three exports that happened, by whom.
    const events = t.database.sqlite.prepare("SELECT actor_display_name AS actor, metadata FROM audit_events WHERE type = 'DOCUMENTS_EXPORTED' ORDER BY rowid").all() as { actor: string; metadata: string }[];
    expect(events.map((event) => [event.actor, (JSON.parse(event.metadata) as { scope: string }).scope])).toEqual([
      ['Gus', 'folder'],
      ['Uma', 'all'],
      ['Gus', 'selection'],
    ]);
    // Rate-limited per person (ten requests in fifteen minutes, refused ones included): it stops answering with archives.
    const statuses = [];
    for (let i = 0; i < 9; i++) statuses.push((await raw(`${api()}/documents/export?document=${bill.id}`, guest)).statusCode);
    expect({ first: statuses[0], last: statuses.at(-1), only: [...new Set(statuses)].sort() }).toEqual({ first: 200, last: 429, only: [200, 429] });
    expect((await raw(`${api()}/documents/export?document=${bill.id}`, user)).statusCode).toBe(200); // someone else is not affected
  });

  it('lets only a Workspace admin delete from Trash for good, and only what is in Trash', async () => {
    const doomed = await document('Uploaded by mistake', null, ['mistake.jpg']);
    const kept = await document('Kept', null, ['kept.jpg']);
    await t.post(`${api()}/documents/${doomed.id}/delete`, {}, user);
    const items = { items: [{ kind: 'document', id: doomed.id }] };
    const trash = (await t.get(`${api()}/documents/trash`, user)).json().entries as { name: string; files: number }[];
    expect(trash.find((entry) => entry.name === 'Uploaded by mistake')).toMatchObject({ files: 1 });

    expect(error(await t.post(`${api()}/documents/trash/purge`, items, user))).toEqual({ status: 403, error: 'forbidden' }); // a USER restores, never purges
    expect(error(await t.post(`${api()}/documents/trash/purge`, { all: true }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api()}/documents/trash/purge`, items, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api()}/documents/trash/purge`, items, outsider))).toEqual({ status: 404, error: 'workspace_not_found' });
    expect(error(await t.post(`${api(office)}/documents/trash/purge`, items, outsider))).toEqual({ status: 404, error: 'document_not_found' });
    expect((await t.post(`${api()}/documents/trash/purge`, items)).statusCode).toBe(401);
    expect((await t.post(`${api()}/documents/trash/purge`, items, owner, null)).statusCode).toBe(403); // no Origin
    for (const body of [{}, { items: [] }, { all: false }, { all: true, items: items.items }, { items: [{ kind: 'page', id: doomed.id }] }, { items: [{ kind: 'document', id: 'nope' }] }, { items: items.items, force: true }]) {
      expect({ body, ...error(await t.post(`${api()}/documents/trash/purge`, body, owner)) }).toEqual({ body, status: 400, error: 'invalid_request' });
    }
    expect(error(await t.post(`${api()}/documents/trash/purge`, { items: [{ kind: 'document', id: kept.id }] }, owner))).toEqual({ status: 404, error: 'document_not_found' }); // not in Trash
    expect((await t.get(`${api()}/documents/${kept.id}`, guest)).statusCode).toBe(200);

    expect((await t.post(`${api()}/documents/trash/purge`, items, owner)).json()).toEqual({ purged: { folders: 0, documents: 1, files: 1 } });
    expect(error(await t.post(`${api()}/documents/${doomed.id}/restore`, {}, user))).toEqual({ status: 404, error: 'document_not_found' });
    expect((await t.post(`${api()}/documents/trash/purge`, { all: true }, owner)).json().purged).toMatchObject({ documents: 1 }); // "Geheim im Papierkorb" from the export test
    expect((await t.get(`${api()}/documents/trash`, user)).json().entries).toEqual([]);
    // The Office's Trash was never touched.
    const audited = t.database.sqlite.prepare("SELECT actor_display_name AS actor, metadata FROM audit_events WHERE type = 'DOCUMENT_PURGED' ORDER BY rowid").all() as { actor: string; metadata: string }[];
    expect(audited.map((event) => [event.actor, JSON.parse(event.metadata)])).toEqual([
      ['Olga', { title: 'Uploaded by mistake', files: 1 }],
      ['Olga', { title: 'Geheim im Papierkorb', files: 1 }],
    ]);
    // Nothing of a Document's content or name in the server log.
    for (const secret of ['mistake', 'Geheim', 'Water bill', 'IMG_0001', 'Payroll']) expect(t.logs).not.toContain(secret);
  });
});

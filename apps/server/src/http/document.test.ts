import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';

describe('Folders and Documents over HTTP (16.2)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let colour = 0;

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const upload = async (name: string, cookie = user, workspaceId = home) => {
    const bytes = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: (colour += 37) % 255, g: 90, b: 160 } } }).jpeg().toBuffer();
    const response = await t.app.inject({ method: 'POST', url: `${api(workspaceId)}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), origin: ORIGIN, cookie }, payload: bytes });
    return response.json().file.id as string;
  };
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });

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
  }, 60_000);
  afterAll(async () => t.close());

  it('does not exist until a Workspace admin switches Documents on; then every member sees it', async () => {
    expect((await t.get(api(), user)).json().tools).toEqual(['CALENDAR', 'LISTS', 'PROCEDURES', 'REMINDERS']);
    for (const [method, path, body] of [
      ['GET', '/document-folders', undefined],
      ['GET', '/documents', undefined],
      ['GET', '/documents/trash', undefined],
      ['GET', '/document-types', undefined],
      ['GET', '/document-files/usage', undefined],
      ['POST', '/document-folders', { name: 'Water', parentId: null }],
      ['POST', '/document-types', { name: 'Minutes' }],
    ] as const) {
      for (const cookie of [owner, user, guest]) {
        const response = method === 'GET' ? await t.get(`${api()}${path}`, cookie) : await t.post(`${api()}${path}`, body, cookie);
        expect({ path, ...error(response) }).toEqual({ path, status: 404, error: 'tool_not_enabled' });
      }
    }
    // Only a Workspace admin switches tools; a server admin who is no member cannot.
    expect(error(await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, user))).toEqual({ status: 403, error: 'forbidden' });
    expect(error(await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, outsider)).statusCode).toBe(404);
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner, null)).statusCode).toBe(403); // no Origin
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true })).statusCode).toBe(401);
    expect(error(await t.post(`${api()}/tools`, { tool: 'MAIL', enabled: true }, owner))).toEqual({ status: 400, error: 'invalid_tool' });
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true, forAll: true }, owner)).statusCode).toBe(400);
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner)).json()).toEqual({ tools: ['CALENDAR', 'DOCUMENTS', 'LISTS', 'PROCEDURES', 'REMINDERS'], revision: 1 });
    for (const cookie of [owner, user, guest]) {
      expect((await t.get(api(), cookie)).json().tools).toEqual(['CALENDAR', 'DOCUMENTS', 'LISTS', 'PROCEDURES', 'REMINDERS']);
      expect((await t.get(`${api()}/tools`, cookie)).json()).toEqual({ tools: ['CALENDAR', 'DOCUMENTS', 'LISTS', 'PROCEDURES', 'REMINDERS'], revision: 1 });
      expect((await t.get(`${api()}/document-folders`, cookie)).json()).toEqual({ folders: [] }); // nothing is pre-created
    }
    expect((await t.get(api(office), outsider)).json().tools).toEqual(['CALENDAR', 'LISTS', 'PROCEDURES', 'REMINDERS']);
  });

  it("the user's example over the API: a Water folder, three photos as one bill, ordered, dated, previewed, downloaded", async () => {
    const water = (await t.post(`${api()}/document-folders`, { name: 'Water', parentId: null }, user)).json().folder;
    const files = [await upload('IMG_0001.jpg'), await upload('IMG_0002.jpg'), await upload('IMG_0003.jpg')];
    const created = await t.post(`${api()}/documents`, { title: 'Water bill March', folderId: water.id, fileIds: files }, user);
    expect(created.statusCode).toBe(201);
    const bill = created.json().document;
    expect(bill).toMatchObject({ title: 'Water bill March', folderId: water.id, files: 3, uploadedBy: 'Uma', modifiedBy: 'Uma', revision: 1, notes: '', tags: [], type: null, documentDate: null, year: null });
    expect(bill.pages.map((page: { name: string }) => page.name)).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg']);
    expect(bill.cover).toEqual({ fileId: files[0], hasThumbnail: true });
    const reordered = (await t.post(`${api()}/documents/${bill.id}/files`, { fileIds: [files[2], files[0], files[1]], expectedRevision: 1 }, user)).json().document;
    const dated = (await t.post(`${api()}/documents/${bill.id}/update`, { title: 'Water bill March', documentDate: '2026-03-12', year: 2026, type: { builtIn: 'bill' }, tags: ['Water'], notes: 'Paid on 30 March', expectedRevision: reordered.revision }, user)).json().document;
    expect(dated).toMatchObject({ documentDate: '2026-03-12', year: 2026, type: { kind: 'builtin', key: 'bill' }, tags: ['Water'], notes: 'Paid on 30 March', revision: 3 });
    // A guest reads the same order, previews every page and downloads every original.
    const seen = (await t.get(`${api()}/documents/${bill.id}`, guest)).json().document;
    expect(seen.pages.map((page: { id: string }) => page.id)).toEqual([files[2], files[0], files[1]]);
    for (const page of seen.pages as { id: string }[]) {
      expect((await t.get(`${api()}/document-files/${page.id}/pages/1`, guest)).headers['content-type']).toBe('image/jpeg');
      expect((await t.get(`${api()}/document-files/${page.id}/original`, guest)).headers['content-disposition']).toMatch(/^attachment; /);
    }
    expect((await t.get(`${api()}/documents?folder=${water.id}`, guest)).json()).toMatchObject({ documents: [{ id: bill.id, title: 'Water bill March', files: 3 }], nextCursor: null, total: 1 });
    expect((await t.get(`${api()}/documents?folder=top`, guest)).json().documents).toEqual([]); // nothing at the top level
    // Display names only: no user ids, emails or storage names in what a member receives.
    const body = JSON.stringify(seen);
    expect(body).not.toMatch(/@example\.org|[0-9a-f]{64}/);
    expect(body).not.toContain('userId');
  });

  it('requires a version and rejects concurrent stale settings without changing tools', async () => {
    const settings = (await t.get(`${api()}/tools`, owner)).json();
    const write = (payload: object) => t.app.inject({ method: 'POST', url: `${api()}/tools`, headers: { origin: ORIGIN, cookie: owner }, payload });
    expect((await write({ tool: 'CONTACTS', enabled: true })).statusCode).toBe(400);
    const results = await Promise.all([
      write({ tool: 'CONTACTS', enabled: true, expectedRevision: settings.revision }),
      write({ tool: 'MAINTENANCE', enabled: true, expectedRevision: settings.revision }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.statusCode === 409)?.json()).toEqual({ error: 'tool_settings_conflict' });
    const updated = (await t.get(`${api()}/tools`, owner)).json();
    expect(updated.revision).toBe(settings.revision + 1);
    const added = updated.tools.find((tool: string) => !settings.tools.includes(tool));
    await t.post(`${api()}/tools`, { tool: added, enabled: false, expectedRevision: updated.revision }, owner);
  });

  it('refuses a GUEST on every write and an outsider on everything, with ids of Home under Office resolving to nothing', async () => {
    const tree = (await t.get(`${api()}/document-folders`, guest)).json().folders as { id: string; revision: number }[];
    const water = tree[0];
    const bill = (await t.get(`${api()}/documents?folder=${water?.id}`, guest)).json().documents[0] as { id: string; revision: number };
    const spare = await upload('spare.jpg');
    const type = (await t.post(`${api()}/document-types`, { name: 'Condominium minutes' }, user)).json().type;
    const writes: [string, object][] = [
      ['/document-folders', { name: 'Mine', parentId: null }],
      [`/document-folders/${water?.id}/rename`, { name: 'Mine', expectedRevision: water?.revision }],
      [`/document-folders/${water?.id}/move`, { parentId: null, expectedRevision: water?.revision }],
      [`/document-folders/${water?.id}/delete`, {}],
      [`/document-folders/${water?.id}/restore`, {}],
      ['/documents', { title: 'Mine', folderId: null, fileIds: [spare] }],
      ['/documents/move', { documentIds: [bill.id], folderId: null }],
      [`/documents/${bill.id}/update`, { title: 'Mine', expectedRevision: bill.revision }],
      [`/documents/${bill.id}/files`, { fileIds: [spare], expectedRevision: bill.revision }],
      [`/documents/${bill.id}/delete`, {}],
      [`/documents/${bill.id}/restore`, {}],
      ['/document-types', { name: 'Mine' }],
      [`/document-types/${type.id}/rename`, { name: 'Mine' }],
      [`/document-types/${type.id}/retire`, {}],
    ];
    await t.post(`${api(office)}/tools`, { tool: 'DOCUMENTS', enabled: true }, outsider);
    for (const [path, body] of writes) {
      expect({ path, ...error(await t.post(`${api()}${path}`, body, guest)) }).toEqual({ path, status: 403, error: 'forbidden' });
      expect({ path, status: (await t.post(`${api()}${path}`, body)).statusCode }).toEqual({ path, status: 401 });
      expect({ path, status: (await t.post(`${api()}${path}`, body, user, null)).statusCode }).toEqual({ path, status: 403 });
      expect({ path, ...error(await t.post(`${api()}${path}`, body, outsider)) }).toEqual({ path, status: 404, error: 'workspace_not_found' });
      // Home's ids under Office (where Otto is admin and Documents are on): nothing is found, nothing is created.
      const foreign = await t.post(`${api(office)}${path}`, body, outsider);
      if (/\/(document-folders|document-types)$/.test(path)) continue; // these carry no id of Home
      expect({ path, status: foreign.statusCode }).toEqual({ path, status: 404 });
    }
    expect(error(await t.get(`${api()}/documents/trash`, guest))).toEqual({ status: 403, error: 'forbidden' }); // Trash is for those who can restore
    expect((await t.get(`${api(office)}/documents/${bill.id}`, outsider)).statusCode).toBe(404);
    expect((await t.get(`${api(office)}/documents?folder=${water?.id}`, outsider)).statusCode).toBe(404);
    expect((await t.get(`${api(office)}/documents`, outsider)).json().documents).toEqual([]);
    expect((await t.get(`${api()}/documents/${bill.id}`, guest)).json().document).toMatchObject({ title: 'Water bill March', revision: bill.revision, files: 3 });
  });

  it('validates strictly and answers with stable codes', async () => {
    const post = async (path: string, body: object) => error(await t.post(`${api()}${path}`, body, user));
    const water = ((await t.get(`${api()}/document-folders`, user)).json().folders as { id: string; name: string; revision: number }[]).find((each) => each.name === 'Water');
    const file = await upload('one.jpg');
    expect(await post('/document-folders', { name: 'water', parentId: null })).toEqual({ status: 409, error: 'name_taken' });
    expect(await post('/document-folders', { name: 'a/b', parentId: null })).toEqual({ status: 400, error: 'folder_name_invalid_characters' });
    expect(await post('/document-folders', { name: 'x', parentId: null, workspaceId: office })).toEqual({ status: 400, error: 'invalid_request' });
    expect(await post(`/document-folders/${water?.id}/move`, { parentId: water?.id, expectedRevision: water?.revision })).toEqual({ status: 409, error: 'folder_into_itself' });
    expect(await post(`/document-folders/${water?.id}/rename`, { name: 'Acqua', expectedRevision: 99 })).toEqual({ status: 409, error: 'document_conflict' });
    expect(await post('/documents', { title: '', folderId: null, fileIds: [file] })).toEqual({ status: 400, error: 'document_title_empty' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [] })).toEqual({ status: 400, error: 'document_needs_file' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [file], id: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' })).toEqual({ status: 400, error: 'invalid_request' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [file], uploadedBy: 'Mallory' })).toEqual({ status: 400, error: 'invalid_request' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [file], documentDate: '2026-02-30' })).toEqual({ status: 400, error: 'invalid_document_date' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [file], type: { builtIn: 'invoice' } })).toEqual({ status: 400, error: 'invalid_document_type' });
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: ['3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f'] })).toEqual({ status: 404, error: 'file_not_found' });
    expect(await post('/documents', { title: 'x', folderId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f', fileIds: [file] })).toEqual({ status: 404, error: 'folder_not_found' });
    const taken = ((await t.get(`${api()}/documents?folder=${water?.id}`, user)).json().documents[0] as { cover: { fileId: string } }).cover.fileId;
    expect(await post('/documents', { title: 'x', folderId: null, fileIds: [taken] })).toEqual({ status: 409, error: 'file_in_use' });
    expect((await t.get(`${api()}/documents?folder=nope`, user)).statusCode).toBe(400);
    expect((await t.get(`${api()}/documents?limit=5`, user)).statusCode).toBe(400);
    expect((await t.get(`${api()}/documents?folder=top`, user)).json().documents).toEqual([]); // none of the refused requests created anything
    expect((await t.get(`${api()}/documents`, user)).json().total).toBe(1);
  });

  it('moves a Folder to Trash with its contents, restores it, and tells what happened to a name that was taken', async () => {
    const water = ((await t.get(`${api()}/document-folders`, user)).json().folders as { id: string; name: string }[]).find((each) => each.name === 'Water');
    expect((await t.post(`${api()}/document-folders/${water?.id}/delete`, {}, user)).json()).toEqual({ deleted: { folders: 0, documents: 1 } });
    expect((await t.get(`${api()}/document-folders`, guest)).json().folders).toEqual([]);
    const trash = (await t.get(`${api()}/documents/trash`, user)).json().entries;
    expect(trash).toEqual([{ kind: 'folder', id: water?.id, name: 'Water', location: [], deletedAt: expect.any(String), deletedBy: 'Uma', folders: 0, documents: 1, files: 3 }]);
    expect((await t.get(`${api()}/documents/trash?within=${water?.id}`, user)).json().entries).toMatchObject([{ kind: 'document', name: 'Water bill March', location: ['Water'] }]);
    await t.post(`${api()}/document-folders`, { name: 'Water', parentId: null }, user);
    expect((await t.post(`${api()}/document-folders/${water?.id}/restore`, {}, user)).json()).toEqual({ restored: { folders: 0, documents: 1, renamedTo: 'Water (restored)', movedTo: null } });
    expect(((await t.get(`${api()}/document-folders`, guest)).json().folders as { name: string }[]).map((each) => each.name)).toEqual(['Water', 'Water (restored)']);
    expect((await t.get(`${api()}/documents?folder=${water?.id}`, guest)).json().documents).toHaveLength(1);
  });

  it('finds Documents by search, filters and sort, page by page — and nothing of another Workspace or in Trash (16.3)', async () => {
    const list = async (query: string, cookie = guest, workspaceId = home) => (await t.get(`${api(workspaceId)}/documents${query}`, cookie)).json() as { documents: { id: string; title: string }[]; nextCursor: string | null; total: number | null };
    const titles = async (query: string, cookie = guest) => (await list(query, cookie)).documents.map((each) => each.title);
    const water = ((await t.get(`${api()}/document-folders`, user)).json().folders as { id: string; name: string }[]).find((each) => each.name === 'Water (restored)');
    const minutes = ((await t.get(`${api()}/document-types`, user)).json().types.custom as { id: string }[])[0];
    const create = async (body: object, cookie = user, workspaceId = home) => (await t.post(`${api(workspaceId)}/documents`, { folderId: null, ...body, fileIds: [await upload('scan.jpg', cookie, workspaceId)] }, cookie)).json().document as { id: string; revision: number };
    await create({ title: 'Bolletta', type: { builtIn: 'bill' }, year: 2026, notes: "Fornitura dell'acqua — Geheimwort", tags: ['Acqua'] });
    await create({ title: 'Stromrechnung Müller', type: { builtIn: 'bill' }, year: 2025, documentDate: '2025-11-30' }, owner);
    const trashed = await create({ title: 'Acqua vecchia', tags: ['acqua'] });
    await t.post(`${api()}/documents/${trashed.id}/delete`, {}, user);
    await create({ title: 'Acqua ufficio', notes: 'acqua', tags: ['acqua'], year: 2026, type: { builtIn: 'bill' } }, outsider, office);

    // The user's example: type = bill and year = 2026; the file downloads from the result.
    const found = await list('?type=builtin:bill&year=2026');
    expect(found).toMatchObject({ documents: [{ title: 'Bolletta', uploadedBy: 'Uma', files: 1 }, { title: 'Water bill March', files: 3 }], nextCursor: null, total: 2 });
    const cover = (found.documents[1] as unknown as { cover: { fileId: string } }).cover.fileId;
    const original = await t.get(`${api()}/document-files/${cover}/original`, guest);
    expect({ status: original.statusCode, disposition: original.headers['content-disposition'] }).toMatchObject({ status: 200, disposition: expect.stringContaining('attachment') });
    // Search: notes and tags, without case or accents, inside words; Trash and the Office never show up.
    expect(await titles('?q=acqua')).toEqual(['Bolletta']);
    expect((await list('?q=ACQUA')).total).toBe(1);
    expect(await titles('?q=rechnung%20muller')).toEqual(['Stromrechnung Müller']);
    expect(await titles('?tag=ACQUA')).toEqual(['Bolletta']);
    expect(await titles('?tag=acqua&tag=missing')).toEqual([]);
    expect(await titles('?uploader=Olga')).toEqual(['Stromrechnung Müller']);
    expect(await titles(`?folder=${water?.id}`)).toEqual(['Water bill March']);
    expect(await titles('?folder=top&sort=title')).toEqual(['Bolletta', 'Stromrechnung Müller']);
    // Documents without a document date come last, whichever way the dates run.
    for (const dir of ['asc', 'desc']) {
      const dates = ((await list(`?sort=documentDate&dir=${dir}`)).documents as unknown as { documentDate: string | null }[]).map((each) => each.documentDate === null);
      expect({ dir, undatedLast: dates.join() === [...dates].sort((a, b) => Number(a) - Number(b)).join(), some: dates.includes(true) && dates.includes(false) }).toEqual({ dir, undatedLast: true, some: true });
    }
    const filters = (await t.get(`${api()}/documents/filters`, guest)).json().filters as { years: number[]; tags: string[]; uploaders: string[] };
    expect(filters.years).toEqual(expect.arrayContaining([2026, 2025]));
    expect(filters.tags.filter((tag) => tag.toLowerCase() === 'acqua')).toEqual(['Acqua']); // one entry; the trashed and the Office's spelling do not count
    expect(filters.uploaders).toEqual(['Olga', 'Uma']); // names as recorded on the Documents — never ids or emails
    // Otto in the Office: his own Document only, also with Home's type and Folder ids.
    expect((await list('?q=acqua', outsider, office)).documents.map((each) => each.title)).toEqual(['Acqua ufficio']);
    expect((await list(`?type=custom:${minutes?.id}`, outsider, office)).documents).toEqual([]);
    expect(error(await t.get(`${api(office)}/documents?folder=${water?.id}&sub=1&q=water`, outsider))).toEqual({ status: 404, error: 'folder_not_found' });
    for (const path of ['/documents?q=acqua', '/documents/filters']) {
      expect({ path, ...error(await t.get(`${api()}${path}`, outsider)) }).toEqual({ path, status: 404, error: 'workspace_not_found' });
      expect({ path, status: (await t.get(`${api()}${path}`)).statusCode }).toEqual({ path, status: 401 });
    }
    // Only display names and Document facts: no user ids, emails or storage names.
    const body = JSON.stringify(await list(''));
    expect(body).not.toMatch(/example\.org|sha256|[0-9a-f]{64}|UserId/);

    // Strict, bounded parameters with stable codes.
    const refused = async (query: string) => error(await t.get(`${api()}/documents${query}`, guest));
    expect(await refused('?sort=created_at')).toEqual({ status: 400, error: 'invalid_document_sort' });
    expect(await refused('?sort=title%3B%20DROP%20TABLE%20documents')).toEqual({ status: 400, error: 'invalid_document_sort' });
    expect(await refused('?dir=up')).toEqual({ status: 400, error: 'invalid_document_sort' });
    expect(await refused('?type=bill')).toEqual({ status: 400, error: 'invalid_document_type' });
    expect(await refused('?year=20x6')).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused('?year=1800')).toEqual({ status: 400, error: 'invalid_document_year' });
    expect(await refused('?sub=yes')).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused('?limit=1000')).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused(`?q=${'x'.repeat(101)}`)).toEqual({ status: 400, error: 'search_too_long' });
    expect(await refused(`?q=${'x'.repeat(401)}`)).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused(`?${Array.from({ length: 11 }, (_, index) => `tag=t${index}`).join('&')}`)).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused('?cursor=%27%20OR%201%3D1')).toEqual({ status: 400, error: 'invalid_request' });
    expect(await refused('?cursor=bm90IGpzb24')).toEqual({ status: 400, error: 'invalid_cursor' }); // "not json"
    expect(await refused(`?cursor=${Buffer.from(JSON.stringify(['2026-01-01', trashed.id])).toString('base64url')}`)).toEqual({ status: 400, error: 'invalid_cursor' }); // a date under "uploaded"
    expect(await titles("?q=%27%20OR%201%3D1%20--")).toEqual([]);
    expect((await list('')).documents.map((each) => each.title).sort()).toEqual(['Bolletta', 'Stromrechnung Müller', 'Water bill March']); // nothing was harmed

    // Paging: fifty at a time, each Document once, with a new upload in between.
    const users = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'uma@example.org'").get() as { id: string }).id;
    const insert = t.database.sqlite.prepare(
      "INSERT INTO documents (id, workspace_id, title, title_key, tag_keys, search_text, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?, 'Uma', ?, ?, 'Uma', ?)",
    );
    for (let index = 0; index < 120; index++) {
      const title = `ricevuta ${String(index).padStart(3, '0')}`;
      insert.run(crypto.randomUUID(), home, title, title, title, users, 1_000 + index, users, 1_000 + index);
    }
    const first = await list('?q=ricevuta&sort=title');
    expect({ shown: first.documents.length, total: first.total, more: first.nextCursor !== null }).toEqual({ shown: 50, total: 120, more: true });
    await create({ title: 'ricevuta 000 bis' }); // sorts into the first page: must not shift the following ones
    const second = await list(`?q=ricevuta&sort=title&cursor=${first.nextCursor}`);
    const third = await list(`?q=ricevuta&sort=title&cursor=${second.nextCursor}`);
    expect({ second: second.documents.length, third: third.documents.length, total: second.total, end: third.nextCursor }).toEqual({ second: 50, third: 20, total: null, end: null });
    const seen = [...first.documents, ...second.documents, ...third.documents].map((each) => each.title);
    expect(seen).toEqual(Array.from({ length: 120 }, (_, index) => `ricevuta ${String(index).padStart(3, '0')}`));
    // The cursor is only a position: under another order it is refused, in the Office it shows nothing of Home.
    expect(await refused(`?q=ricevuta&cursor=${first.nextCursor}`)).toEqual({ status: 400, error: 'invalid_cursor' });
    expect((await list(`?sort=title&cursor=${first.nextCursor}`, outsider, office)).documents).toEqual([]);
  });

  it('hides everything again when the admin switches the tool off, and writes nothing of a Document to the log', async () => {
    expect((await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: false }, owner)).json()).toMatchObject({ tools: ['CALENDAR', 'LISTS', 'PROCEDURES', 'REMINDERS'] });
    expect(error(await t.get(`${api()}/document-folders`, owner))).toEqual({ status: 404, error: 'tool_not_enabled' });
    expect((await t.get(api(), guest)).json().tools).toEqual(['CALENDAR', 'LISTS', 'PROCEDURES', 'REMINDERS']);
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    expect((await t.get(`${api()}/document-folders`, guest)).json().folders).toHaveLength(2);
    // … nor anything that was searched for (query strings are not logged).
    for (const secret of ['Water bill', 'Paid on 30 March', 'IMG_0001', 'Condominium', 'Geheimwort', 'acqua', 'ACQUA', 'rechnung', 'ricevuta']) expect(t.logs).not.toContain(secret);
  });
});

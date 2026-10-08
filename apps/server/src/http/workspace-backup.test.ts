import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceBackupStoreError } from '@vergissmeinnicht/application';
import { entriesSha256, openWorkspaceBackup, WORKSPACE_BACKUP_FORMAT, type WorkspaceBackupManifest } from '@vergissmeinnicht/import-export';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspaceBackupStore } from '../workspace-backup/workspace-backup-store.ts';
import { startTestApp } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const STEP = { title: 'Stove off', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Wäsche 🧺 – 洗濯 «test»', description: 'Zeilen\nmit Umbruch', icon: 'home', tags: ['ünïcode'], sections: [{ title: 'Küche', description: '', steps: [STEP] }] };
// A 1×1 PNG: stored byte-for-byte as a document original; re-encoded (JPEG) as an instruction image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

describe('Workspace backup export (section 18a)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let editor: string;
  let user: string;
  let guest: string;
  let outsider: string;
  let packageFile: string;
  let manifest: WorkspaceBackupManifest;
  let contents: Map<string, Buffer>;
  const work = mkdtempSync(join(tmpdir(), 'vmn-backup-test-'));
  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const backups = (workspaceId = home) => `${api(workspaceId)}/backups`;
  const upload = (url: string, cookie: string, payload: Buffer, name?: string) =>
    t.app.inject({ method: 'POST', url, headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream', ...(name === undefined ? {} : { 'x-file-name': encodeURIComponent(name) }) }, payload });
  const runQueue = () => t.services.backupRunner.wake();
  const jobs = async (cookie = owner, workspaceId = home) => (await t.get(backups(workspaceId), cookie)).json().jobs as { id: string; state: string; sizeBytes: number | null; counts: Record<string, number> | null; errorCode: string | null }[];
  const sql = (statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).run(...values);

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.invite('owner@example.org', 'Olga Öwner');
    editor = await t.invite('editor@example.org', 'Eddie');
    user = await t.invite('user@example.org', 'Uma');
    guest = await t.invite('guest@example.org', 'Gus');
    outsider = await t.invite('outsider@example.org', 'Otto Outsider');
    home = await t.createWorkspace('Home ✨ Ferienhaus');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'owner@example.org', 'ADMIN');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
    for (const tool of ['DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT']) await t.post(`${api()}/tools`, { tool, enabled: true }, owner);

    // Every kind of record, with relationships.
    const procedure = (await t.post(`${api()}/procedures`, PROCEDURE, owner)).json().procedure;
    const image = (await upload(`${api()}/images`, owner, PNG)).json().image;
    const run = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, owner)).json().run;
    await t.post(`${api()}/runs/${run.id}/steps/${run.sections[0].steps[0].id}/state`, { expectedState: 'PENDING', state: 'DONE' }, owner);
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    expect((await t.post(`${api()}/schedules`, { title: 'Pay the tax — Grundsteuer', date: soon(30), timeZone: 'Europe/Rome', reminders: [] }, owner)).statusCode).toBe(201);
    expect((await t.post(`${api()}/schedules`, { procedureId: procedure.id, date: soon(40), timeZone: 'UTC', reminders: [] }, owner)).statusCode).toBe(201);
    const list = (await t.post(`${api()}/lists`, { title: 'Einkauf 🛒' }, owner)).json().list;
    for (const title of ['Milch', 'Brot', 'Café ☕']) await t.post(`${api()}/lists/${list.id}/items`, { title }, user);
    const file = (await upload(`${api()}/document-files`, owner, PNG, 'Rechnung März.png')).json().file;
    const folder = (await t.post(`${api()}/document-folders`, { name: 'Wasser', parentId: null }, owner)).json().folder;
    const document = (await t.post(`${api()}/documents`, { title: 'Wasserrechnung', folderId: folder.id, fileIds: [file.id] }, owner)).json().document;
    await t.post(`${api()}/documents/${document.id}/links`, { target: { type: 'procedure', id: procedure.id } }, owner);
    await t.post(`${api()}/runs/${run.id}/documents`, { documentId: document.id }, owner);
    const contact = (await t.post(`${api()}/contacts`, { name: 'Idraulico Rossi', phones: [{ value: '0471 123456' }] }, owner)).json().contact;
    await t.post(`${api()}/maintenance`, { title: 'Caldaia', contactId: contact.id }, owner);
    await t.post(`${api()}/equipment`, { name: 'Boiler' }, owner);
    await t.post(`${api()}/knots`, { target: { type: 'RUN', id: run.id }, label: 'door', expiresInDays: null }, owner);
    const old = (await t.post(`${api()}/procedures`, { ...PROCEDURE, title: 'Im Papierkorb' }, owner)).json().procedure;
    await t.post(`${api()}/procedures/${old.id}/delete`, {}, owner);
    // A switched-off tool keeps its data — and its data is in the backup (D6).
    await t.post(`${api()}/tools`, { tool: 'CONTACTS', enabled: false }, owner);
    expect(image.id).toBeTruthy();

    // Secrets and other people's data that must never appear in the package.
    await t.post(`${api(office)}/procedures`, { ...PROCEDURE, title: 'Office secret procedure' }, outsider);
    const ownerId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'owner@example.org'").get() as { id: string }).id;
    sql("INSERT INTO user_weather_settings (user_id, place_name, latitude, longitude, time_zone, elevation, provider, model, fallback, unit, show_tomorrow, updated_at) VALUES (?, 'Secret Holiday House', 1, 1, 'UTC', NULL, 'AUTO', 'best_match', 0, 'C', 1, 0)", ownerId);
    sql("INSERT INTO weather_credentials (id, scope, user_id, provider, sealed, available_to_users, daily_budget, used_today, created_at, updated_at) VALUES ('c0ffee00-0000-4000-8000-000000000001', 'USER', ?, 'OPENWEATHER', 'v1.SEALED-WEATHER-SECRET', 0, 10, 0, 0, 0)", ownerId);
    sql("INSERT INTO telegram_links (user_id, chat_id, chat_label, connected_at) VALUES (?, '987654321', 'Secret chat', 0)", ownerId);
  }, 120_000);
  afterAll(async () => {
    await t.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('lets only a Workspace ADMIN make a backup; other roles are refused and other Workspaces are not found', async () => {
    for (const cookie of [editor, user, guest]) {
      expect((await t.post(backups(), {}, cookie)).statusCode).toBe(403);
      expect((await t.get(backups(), cookie)).statusCode).toBe(403);
    }
    expect((await t.post(backups(), {}, outsider)).statusCode).toBe(404);
    expect((await t.post(backups(), {})).statusCode).toBe(401);
    expect((await t.post(backups(), {}, owner, null)).statusCode).toBe(403);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM workspace_backup_jobs').get()).toEqual({ n: 0 });
  });

  it('makes one backup at a time in the background and reports it ready with its size and counts', async () => {
    const queued = await t.post(backups(), {}, owner);
    expect(queued.statusCode).toBe(202);
    expect(queued.json().job).toMatchObject({ state: 'QUEUED' });
    // The route already woke the worker; a second request while it runs is refused.
    const second = await t.post(backups(), {}, owner);
    expect([409, 202]).toContain(second.statusCode);
    await runQueue();
    const [ready] = await jobs();
    expect(ready).toMatchObject({ state: 'READY', errorCode: null });
    expect(ready?.sizeBytes).toBeGreaterThan(0);
    expect(ready?.counts).toMatchObject({ procedures: 2, runs: 1, list_items: 3, documents: 1, document_files: 1, contacts: 1, maintenance_records: 1, equipment_records: 1, step_images: 1, memberships: 5 });

    // Download: only the ADMIN of this Workspace, through the signed-in route.
    const url = `${backups()}/${ready?.id}/download`;
    expect((await t.get(url, user)).statusCode).toBe(403);
    expect((await t.get(url, outsider)).statusCode).toBe(404);
    expect((await t.get(`${backups(office)}/${ready?.id}/download`, outsider)).statusCode).toBe(404);
    expect((await t.get(url)).statusCode).toBe(401);
    const download = await t.get(url, owner);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/zip');
    expect(download.headers['cache-control']).toBe('no-store');
    expect(String(download.headers['content-disposition'])).toMatch(/^attachment; filename="vergissmeinnicht-workspace-[0-9-]+\.vmnbackup"$/);
    packageFile = join(work, 'home.vmnbackup');
    writeFileSync(packageFile, download.rawPayload);
    expect(download.rawPayload.length).toBe(ready?.sizeBytes);

    const opened = await openWorkspaceBackup(packageFile);
    contents = new Map();
    for (const name of opened.entries.keys()) contents.set(name, await opened.read(name));
    opened.close();
    manifest = JSON.parse(String(contents.get('manifest.json'))) as WorkspaceBackupManifest;

    // Audited: made (by whom, size, counts) and downloaded — never content.
    const events = t.database.sqlite.prepare("SELECT type, metadata FROM security_events WHERE type LIKE 'WORKSPACE_BACKUP_%' ORDER BY occurred_at").all() as { type: string; metadata: string }[];
    expect(events.map((event) => event.type)).toEqual(['WORKSPACE_BACKUP_EXPORTED', 'WORKSPACE_BACKUP_DOWNLOADED']);
    expect(events.map((event) => event.metadata).join()).not.toMatch(/Wäsche|Wasserrechnung|Rossi/);
  });

  it('writes a self-describing, versioned package whose every entry matches its SHA-256', () => {
    expect(manifest).toMatchObject({ format: WORKSPACE_BACKUP_FORMAT, formatVersion: 1, databaseLevel: '0046_restore_administration', appVersion: 'development', workspace: { name: 'Home ✨ Ferienhaus' } });
    expect(manifest.integrity).toMatch(/do not prove who made this package/);
    expect(entriesSha256(manifest.entries)).toBe(manifest.entriesSha256);
    expect(new Set(contents.keys())).toEqual(new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)]));
    for (const entry of manifest.entries) {
      const bytes = contents.get(entry.path);
      expect({ path: entry.path, size: bytes?.length, sha256: createHash('sha256').update(bytes ?? Buffer.alloc(0)).digest('hex') }).toEqual({ path: entry.path, size: entry.size, sha256: entry.sha256 });
    }
    for (const path of contents.keys()) expect(path).toMatch(/^(manifest\.json|data\/[a-z_]+\.ndjson|files\/(documents|images)\/[0-9a-f]{64})$/);
  });

  it('keeps originals byte-identical, text intact in every script, and relationships as package-local references', () => {
    const rows = (name: string) => String(contents.get(`data/${name}.ndjson`)).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const [documentFile] = rows('document_files');
    expect(contents.get(`files/documents/${String(documentFile?.sha256)}`)?.equals(PNG)).toBe(true);
    const [image] = rows('step_images');
    expect(createHash('sha256').update(contents.get(`files/images/${String(image?.sha256)}`) ?? Buffer.alloc(0)).digest('hex')).toBe(image?.sha256);
    expect(rows('procedures').map((row) => row.title)).toEqual(expect.arrayContaining(['Wäsche 🧺 – 洗濯 «test»', 'Im Papierkorb']));
    expect(rows('procedures').find((row) => row.title === 'Im Papierkorb')?.deleted_at).not.toBeNull();
    expect(rows('list_items').map((row) => row.title)).toEqual(expect.arrayContaining(['Milch', 'Brot', 'Café ☕']));
    expect(rows('workspace_tools')).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'CONTACTS', enabled: 0 })]));
    // A Run points to its Procedure, a Document page to its file — by the ids inside the package.
    const run = rows('runs')[0];
    expect(rows('procedures').some((row) => row.id === run?.procedure_id)).toBe(true);
    expect(rows('document_pages')[0]?.file_id).toBe(documentFile?.id);
    // Schedules keep their definitions (the restore pauses them, D7).
    expect(rows('schedules').map((row) => row.time_zone)).toEqual(expect.arrayContaining(['Europe/Rome', 'UTC']));
  });

  it('carries people only as package references: members with name, role and email, nobody else’s email, no user ids', () => {
    const persons = String(contents.get('data/persons.ndjson')).trim().split('\n').map((line) => JSON.parse(line) as { ref: string; displayName: string; email: string | null });
    expect(persons.map((person) => person.displayName)).toEqual(expect.arrayContaining(['Olga Öwner', 'Uma']));
    expect(persons.find((person) => person.displayName === 'Olga Öwner')?.email).toBe('owner@example.org');
    const memberships = String(contents.get('data/memberships.ndjson')).trim().split('\n').map((line) => JSON.parse(line) as { user_id: string; role: string });
    // The server admin who created the Workspace is a member as well.
    expect(memberships.map((row) => row.role).sort()).toEqual(['ADMIN', 'ADMIN', 'EDITOR', 'GUEST', 'USER']);
    for (const row of memberships) expect(row.user_id).toMatch(/^person-\d+$/);
    const everything = [...contents.values()].map((bytes) => bytes.toString('latin1')).join('\n');
    const userIds = (t.database.sqlite.prepare('SELECT id FROM users').all() as { id: string }[]).map((row) => row.id);
    for (const id of userIds) {
      const where = [...contents].filter(([, bytes]) => bytes.toString('latin1').includes(id)).map(([name, bytes]) => `${name}: ${bytes.toString('utf8').split('\n').find((line) => line.includes(id))?.slice(0, 300)}`);
      expect({ id, where }).toEqual({ id, where: [] });
    }
    expect(everything).not.toContain('outsider@example.org');
    expect(everything).not.toContain(home);
  });

  it('contains no secret, token, credential, personal setting or other Workspace', () => {
    const everything = [...contents.values()].map((bytes) => bytes.toString('utf8')).join('\n');
    const secrets = [
      ...(t.database.sqlite.prepare('SELECT password FROM accounts WHERE password IS NOT NULL').all() as { password: string }[]).map((row) => row.password),
      ...(t.database.sqlite.prepare('SELECT token FROM sessions').all() as { token: string }[]).map((row) => row.token),
      ...(t.database.sqlite.prepare('SELECT token_hash FROM knots').all() as { token_hash: string }[]).map((row) => row.token_hash),
      ...(t.database.sqlite.prepare('SELECT token_hash FROM invitations').all() as { token_hash: string }[]).map((row) => row.token_hash),
      'v1.SEALED-WEATHER-SECRET',
      'Secret Holiday House',
      '987654321',
      'Office secret procedure',
    ];
    expect(secrets.length).toBeGreaterThan(8);
    for (const secret of secrets) expect({ secret: secret.slice(0, 12), found: everything.includes(secret) }).toEqual({ secret: secret.slice(0, 12), found: false });
    expect([...contents.keys()].some((name) => /knots|sessions|accounts|weather|telegram|pins|today/.test(name))).toBe(false);
  });

  it('exports an empty Workspace too', async () => {
    const empty = await t.createWorkspace('Leer');
    await t.addMember(empty, 'owner@example.org', 'ADMIN');
    await t.post(backups(empty), {}, owner);
    await runQueue();
    const [job] = await jobs(owner, empty);
    expect(job).toMatchObject({ state: 'READY' });
    expect(job?.counts).toMatchObject({ procedures: 0, runs: 0, memberships: 2 });
  });

  it('cancels a queued backup, deletes a finished one on request, and never serves a cancelled or expired package', async () => {
    const queued = (await t.post(backups(), {}, owner)).json().job as { id: string };
    // Cancelled before the worker got to it (the route's wake may already be running — either way it ends cancelled or ready).
    await t.post(`${backups()}/${queued.id}/cancel`, {}, owner);
    await runQueue();
    const after = (await jobs()).find((job) => job.id === queued.id);
    expect(['CANCELLED']).toContain(after?.state);
    expect((await t.get(`${backups()}/${queued.id}/download`, owner)).statusCode).toBe(404);

    await t.post(backups(), {}, owner);
    await runQueue();
    const ready = (await jobs()).find((job) => job.state === 'READY');
    if (ready === undefined) throw new Error('expected a ready package');
    expect(t.services.workspaceBackups.backupStore.packagePath(ready.id)).toBeDefined();
    // Expired: the next pass marks it and deletes the file.
    sql('UPDATE workspace_backup_jobs SET expires_at = 1 WHERE id = ?', ready.id);
    await runQueue();
    expect((await jobs()).find((job) => job.id === ready.id)?.state).toBe('EXPIRED');
    expect(t.services.workspaceBackups.backupStore.packagePath(ready.id)).toBeUndefined();
    expect((await t.get(`${backups()}/${ready.id}/download`, owner)).statusCode).toBe(404);
  });

  it('marks a job a stopped server left running as interrupted and removes its files', async () => {
    const id = 'feedface-0000-4000-8000-000000000001';
    const ownerId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'owner@example.org'").get() as { id: string }).id;
    sql("INSERT INTO workspace_backup_jobs (id, kind, workspace_id, state, requested_by_user_id, progress_done, progress_total, cancel_requested, created_at, started_at, lease_until) VALUES (?, 'EXPORT', ?, 'RUNNING', ?, 5, 10, 0, 1, 1, 2)", id, home, ownerId);
    const store = t.services.workspaceBackups.backupStore;
    await runQueue();
    expect((await jobs()).find((job) => job.id === id)).toMatchObject({ state: 'FAILED', errorCode: 'interrupted' });
    expect(store.packagePath(id)).toBeUndefined();
  });

  it('fails cleanly when an original is missing or the volume is too full, leaving no files behind', async () => {
    const sha = (t.database.sqlite.prepare('SELECT sha256 FROM document_files LIMIT 1').get() as { sha256: string }).sha256;
    // The store refuses before writing when space is short.
    const tight = createWorkspaceBackupStore({ database: t.database, root: join(work, 'tight'), documentsPath: join(work, 'none'), mediaPath: join(work, 'none'), appVersion: 'test', freeBytes: () => 0 });
    await expect(tight.writeExport({ id: 'feedface-0000-4000-8000-000000000002', workspaceId: home as never }, { onProgress: () => undefined, isCancelled: () => false })).rejects.toBeInstanceOf(WorkspaceBackupStoreError);
    // An original missing from disk: the job fails, nothing is kept.
    const missing = createWorkspaceBackupStore({ database: t.database, root: join(work, 'missing'), documentsPath: join(work, 'empty-documents'), mediaPath: join(work, 'empty-media'), appVersion: 'test' });
    await expect(missing.writeExport({ id: 'feedface-0000-4000-8000-000000000003', workspaceId: home as never }, { onProgress: () => undefined, isCancelled: () => false })).rejects.toMatchObject({ code: 'missing_file' });
    missing.remove('feedface-0000-4000-8000-000000000003');
    expect(existsSync(join(work, 'missing', 'feedface-0000-4000-8000-000000000003'))).toBe(false);
    expect(readdirSync(join(work, 'missing'))).toEqual([]);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles a large Workspace with bounded memory: every row, every hash', async () => {
    const big = await t.createWorkspace('Gross');
    await t.addMember(big, 'owner@example.org', 'ADMIN');
    const list = (await t.post(`${api(big)}/lists`, { title: 'Viel' }, owner)).json().list as { id: string };
    const ownerId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'owner@example.org'").get() as { id: string }).id;
    const insert = t.database.sqlite.prepare(
      "INSERT INTO list_items (id, list_id, workspace_id, position, title, quantity, unit, revision, created_by_user_id, created_by_display_name, created_at, content_changed_at, content_changed_by_display_name, check_changed_at, check_changed_by_display_name) VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, ?, 'Olga', 1, 1, 'Olga', 1, 'Olga')",
    );
    const rows = 40_000;
    t.database.sqlite.transaction(() => {
      for (let index = 0; index < rows; index++) insert.run(`${String(index).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`, list.id, big, index, `Artikel ${index} — ünïcödé ${'x'.repeat(index % 50)}`, ownerId);
    })();
    await t.post(backups(big), {}, owner);
    await runQueue();
    const [job] = await jobs(owner, big);
    expect(job).toMatchObject({ state: 'READY' });
    expect(job?.counts?.list_items).toBe(rows);
    const path = t.services.workspaceBackups.backupStore.packagePath(job?.id ?? '');
    if (path === undefined) throw new Error('package missing');
    const opened = await openWorkspaceBackup(path);
    const items = await opened.read('data/list_items.ndjson');
    const manifestEntry = (JSON.parse(String(await opened.read('manifest.json'))) as WorkspaceBackupManifest).entries.find((entry) => entry.path === 'data/list_items.ndjson');
    opened.close();
    expect(createHash('sha256').update(items).digest('hex')).toBe(manifestEntry?.sha256);
    expect(String(items).trim().split('\n')).toHaveLength(rows);
  }, 120_000);
});


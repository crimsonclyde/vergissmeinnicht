import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { EXPORTED_TABLES } from '@vergissmeinnicht/database';
import { openWorkspaceBackup, writeWorkspaceBackupArchive, type ArchiveSource, type WorkspaceBackupManifest } from '@vergissmeinnicht/import-export';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, startTestApp } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const STEP = { title: 'Stove off', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PROCEDURE = { title: 'Wäsche 🧺 – 洗濯 «test»', description: 'Zeilen\nmit Umbruch', icon: 'home', tags: ['ünïcode'], sections: [{ title: 'Küche', description: '', steps: [STEP] }] };
// A 1×1 PNG: stored byte-for-byte as a document original; re-encoded (JPEG) as an instruction image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type Job = { id: string; state: string; phase: string | null; errorCode: string | null; workspaceId: string | null; preview: Record<string, unknown> & { previousMembers: { displayName: string; email: string | null; role: string }[]; counts: Record<string, number>; persons: number } };

describe('Workspace restore (section 18b)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let outsider: string;
  let userId: string;
  let homePackage: Buffer;
  let restored: string;
  const work = mkdtempSync(join(tmpdir(), 'vmn-restore-test-'));
  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const RESTORES = '/api/admin/workspace-restores';
  const upload = (url: string, cookie: string, payload: Buffer, name?: string) =>
    t.app.inject({ method: 'POST', url, headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream', ...(name === undefined ? {} : { 'x-file-name': encodeURIComponent(name) }) }, payload });
  const sql = (statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).run(...values);
  const one = <T>(statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).get(...values) as T;
  const all = <T>(statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).all(...values) as T[];
  const runQueue = () => t.services.backupRunner.wake();
  const job = async (id: string): Promise<Job> => (await t.get(`${RESTORES}/${id}`, t.admin)).json().restore as Job;

  /** All rows of a Workspace in every exported table — what a restore must never change for the source. */
  const snapshot = (workspaceId: string) => Object.fromEntries(EXPORTED_TABLES.map((spec) => [spec.table, t.database.sqlite.prepare(spec.select).all(...Array.from({ length: (spec.from.match(/\?/g) ?? []).length }, () => workspaceId))]));
  const counts = (workspaceId: string) => Object.fromEntries(Object.entries(snapshot(workspaceId)).map(([table, rows]) => [table, rows.length]));
  /** Rows per table, without memberships (never restored; the restoring admin is the only member). */
  const recordCounts = (workspaceId: string) => Object.fromEntries(Object.entries(counts(workspaceId)).filter(([table]) => table !== 'memberships'));
  const workspaceCount = () => one<{ n: number }>('SELECT count(*) AS n FROM workspaces').n;
  const importedCount = () => one<{ n: number }>("SELECT count(*) AS n FROM users WHERE status = 'IMPORTED'").n;

  async function exportOf(workspaceId: string, cookie: string): Promise<Buffer> {
    expect((await t.post(`${api(workspaceId)}/backups`, {}, cookie)).statusCode).toBe(202);
    await runQueue();
    const [ready] = (await t.get(`${api(workspaceId)}/backups`, cookie)).json().jobs as { id: string; state: string }[];
    expect(ready?.state).toBe('READY');
    return (await t.get(`${api(workspaceId)}/backups/${ready?.id}/download`, cookie)).rawPayload;
  }

  /** Uploads and validates; returns the job as it waits for confirmation (or as it failed). */
  async function validated(payload: Buffer): Promise<Job> {
    // The upload limit (20 per hour) is tested in its own place; this suite uploads more often.
    sql('DELETE FROM rate_limits');
    const response = await upload(RESTORES, t.admin, payload);
    expect(response.statusCode).toBe(202);
    const id = (response.json().restore as Job).id;
    await runQueue();
    return job(id);
  }

  async function restore(payload: Buffer): Promise<{ job: Job; workspaceId: string }> {
    const ready = await validated(payload);
    expect(ready, String(ready.errorCode)).toMatchObject({ state: 'READY', phase: 'validated' });
    expect((await t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)).statusCode).toBe(202);
    await runQueue();
    const done = await job(ready.id);
    expect(done, String(done.errorCode)).toMatchObject({ state: 'READY', phase: 'restored' });
    return { job: done, workspaceId: done.workspaceId as string };
  }

  /** A package changed record by record: the hashes and manifest are made anew, so only the content checks can catch it. */
  async function repack(source: Buffer, change: (files: Map<string, Buffer>) => void, manifestChange: Partial<WorkspaceBackupManifest> = {}): Promise<Buffer> {
    const original = join(work, `source-${randomUUID()}.vmnbackup`);
    writeFileSync(original, source);
    const opened = await openWorkspaceBackup(original);
    const files = new Map<string, Buffer>();
    for (const name of opened.entries.keys()) files.set(name, await opened.read(name));
    opened.close();
    const manifest = JSON.parse(String(files.get('manifest.json'))) as WorkspaceBackupManifest;
    files.delete('manifest.json');
    change(files);
    const dir = join(work, randomUUID());
    mkdirSync(dir);
    const entries: ArchiveSource[] = [...files].map(([path, bytes], index) => {
      const file = join(dir, String(index));
      writeFileSync(file, bytes);
      return { path, source: file, size: bytes.length, sha256: sha(bytes), kind: path.startsWith('data/') ? 'data' : 'file' };
    });
    const target = join(dir, 'package.vmnbackup');
    await writeWorkspaceBackupArchive({ entries, manifest: { databaseLevel: manifest.databaseLevel, appVersion: manifest.appVersion, createdAt: manifest.createdAt, workspace: manifest.workspace, counts: manifest.counts, ...manifestChange } }, target);
    return readFileSync(target);
  }
  const lines = (files: Map<string, Buffer>, name: string) => String(files.get(`data/${name}.ndjson`)).split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as Record<string, unknown>);
  const write = (files: Map<string, Buffer>, name: string, rows: Record<string, unknown>[]) => files.set(`data/${name}.ndjson`, Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join('')));

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.invite('owner@example.org', 'Olga Öwner');
    await t.invite('editor@example.org', 'Eddie');
    user = await t.invite('user@example.org', 'Uma 🌸');
    await t.invite('guest@example.org', 'Gus');
    outsider = await t.invite('outsider@example.org', 'Otto Outsider');
    userId = one<{ id: string }>("SELECT id FROM users WHERE email = 'user@example.org'").id;
    home = await t.createWorkspace('Home ✨ Ferienhaus');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'owner@example.org', 'ADMIN');
    await t.addMember(home, 'editor@example.org', 'EDITOR');
    await t.addMember(home, 'user@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    await t.addMember(office, 'outsider@example.org', 'ADMIN');
    for (const tool of ['DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT']) await t.post(`${api()}/tools`, { tool, enabled: true }, owner);

    const procedure = (await t.post(`${api()}/procedures`, PROCEDURE, owner)).json().procedure;
    expect((await upload(`${api()}/images`, owner, PNG)).statusCode).toBe(201);
    const newDocument = async (title: string, bytes: Buffer) => {
      const file = (await upload(`${api()}/document-files`, owner, bytes, `${title}.png`)).json().file;
      return (await t.post(`${api()}/documents`, { title, folderId: null, fileIds: [file.id] }, owner)).json().document as { id: string };
    };
    const kept = await newDocument('Wasserrechnung März', PNG);
    const trashed = await newDocument('Alte Rechnung', PNG2);
    const purged = await newDocument('Vertrag (gelöscht)', PNG);
    for (const document of [kept, trashed, purged]) expect((await t.post(`${api()}/documents/${document.id}/links`, { target: { type: 'procedure', id: procedure.id } }, owner)).statusCode).toBe(201);

    // A finished Run whose kept Document version was removed with a note; an active Run keeping a version of a Document deleted for good.
    const finished = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, owner)).json().run;
    await t.post(`${api()}/runs/${finished.id}/steps/${finished.sections[0].steps[0].id}/state`, { expectedState: 'PENDING', state: 'DONE' }, user);
    const keptVersion = (await t.post(`${api()}/runs/${finished.id}/documents`, { documentId: kept.id }, owner)).json().document;
    expect((await t.post(`${api()}/runs/${finished.id}/complete`, {}, owner)).statusCode).toBe(200);
    expect((await t.post(`${api()}/runs/${finished.id}/documents/${keptVersion.id}/remove-kept`, { reason: 'Falsches Dokument', confirm: true }, owner)).statusCode).toBe(200);
    const active = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, owner)).json().run;
    expect((await t.post(`${api()}/runs/${active.id}/documents`, { documentId: purged.id }, owner)).statusCode).toBe(201);
    expect((await t.post(`${api()}/documents/${trashed.id}/delete`, {}, owner)).statusCode).toBeLessThan(300);
    expect((await t.post(`${api()}/documents/${purged.id}/delete`, {}, owner)).statusCode).toBeLessThan(300);
    expect((await t.post(`${api()}/documents/trash/purge`, { items: [{ kind: 'document', id: purged.id }] }, owner)).statusCode).toBe(200);

    // Schedules with an assignee and reminders; the source keeps planning its reminders.
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    expect((await t.post(`${api()}/schedules`, { title: 'Pay the tax — Grundsteuer', date: soon(3), timeZone: 'Europe/Rome', reminders: [{ unit: 'DAYS', amount: 1 }], assigneeUserId: userId }, owner)).statusCode).toBe(201);
    expect((await t.post(`${api()}/schedules`, { procedureId: procedure.id, date: soon(40), timeZone: 'UTC', reminders: [] }, owner)).statusCode).toBe(201);
    const list = (await t.post(`${api()}/lists`, { title: 'Einkauf 🛒' }, owner)).json().list;
    for (const title of ['Milch', 'Brot', 'Café ☕']) await t.post(`${api()}/lists/${list.id}/items`, { title }, user);
    // A maintenance record whose responsible Contact is in Trash.
    const contact = (await t.post(`${api()}/contacts`, { name: 'Idraulico Rossi', phones: [{ value: '0471 123456' }] }, owner)).json().contact;
    expect((await t.post(`${api()}/maintenance`, { title: 'Caldaia', contactId: contact.id }, owner)).statusCode).toBe(201);
    expect((await t.post(`${api()}/contacts/${contact.id}/delete`, {}, owner)).statusCode).toBeLessThan(300);
    await t.post(`${api()}/equipment`, { name: 'Boiler' }, owner);
    // Recognised text with a person's correction (16.13).
    const ownerId = one<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.org'").id;
    sql("UPDATE document_file_texts SET state = 'DONE', source = 'OCR', text = 'Rechnung', search_text = 'rechnung', bytes = 8, pages = 1, corrected_text = 'Rechnung März', corrected_search_text = 'rechnung marz', correction_bytes = 14, corrected_by_user_id = ?, corrected_by_display_name = 'Olga Öwner', corrected_at = 1 WHERE workspace_id = ?", ownerId, home);
    // A switched-off tool stays off, with its data.
    await t.post(`${api()}/tools`, { tool: 'EQUIPMENT', enabled: false }, owner);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM scheduled_reminders').n).toBeGreaterThan(0);
    await t.post(`${api(office)}/procedures`, { ...PROCEDURE, title: 'Office procedure' }, outsider);

    homePackage = await exportOf(home, owner);
  }, 180_000);
  afterAll(async () => {
    await t.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('is for server admins only: a Workspace ADMIN, other users and anonymous requests are refused, and nothing is stored', async () => {
    for (const cookie of [owner, user, outsider]) {
      expect((await upload(RESTORES, cookie, homePackage)).statusCode).toBe(403);
      expect((await t.get(RESTORES, cookie)).statusCode).toBe(403);
      expect((await t.get(`${RESTORES}/${randomUUID()}`, cookie)).statusCode).toBe(403);
      expect((await t.post(`${RESTORES}/${randomUUID()}/confirm`, {}, cookie)).statusCode).toBe(403);
    }
    expect((await upload(RESTORES, '', homePackage)).statusCode).toBe(401);
    expect((await t.post(`${RESTORES}/${randomUUID()}/confirm`, {}, t.admin, null)).statusCode).toBe(403);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM workspace_backup_jobs WHERE kind = 'RESTORE'").n).toBe(0);
  });

  it('validates the whole package first and shows what it would restore — without creating anything', async () => {
    const before = { workspaces: workspaceCount(), imported: importedCount() };
    const ready = await validated(homePackage);
    expect(ready, JSON.stringify(ready)).toMatchObject({ state: 'READY', phase: 'validated', errorCode: null, workspaceId: null });
    expect(ready.preview).toMatchObject({ workspaceName: 'Home ✨ Ferienhaus', databaseLevel: '0045_imported_identities', schedulesPaused: 2, assignmentsCleared: 1 });
    expect(ready.preview.counts).toMatchObject({ procedures: 1, runs: 2, documents: 2, document_files: 3, links: 3, run_document_removals: 1, contacts: 1, list_items: 3 });
    // Previous members, for inviting them again by hand — the restore itself invites and matches nobody.
    expect(ready.preview.previousMembers.map((member) => `${member.displayName}:${member.email}:${member.role}`).sort()).toEqual(['Ada:admin@example.org:ADMIN', 'Eddie:editor@example.org:EDITOR', 'Gus:guest@example.org:GUEST', 'Olga Öwner:owner@example.org:ADMIN', 'Uma 🌸:user@example.org:USER']);
    expect({ workspaces: workspaceCount(), imported: importedCount() }).toEqual(before);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM workspace_restore_marks').n).toBe(0);
    expect(JSON.stringify(await job(ready.id))).not.toMatch(/requestedBy/);
    expect((await t.post(`${RESTORES}/${ready.id}/cancel`, {}, t.admin)).json().restore.state).toBe('CANCELLED');
    expect(existsSync(join(backupRoot(), ready.id))).toBe(false);
    expect((await t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)).statusCode).toBe(409);
  });

  it('restores into a new Workspace: every record with a new id, every relationship rebuilt, the source untouched', async () => {
    const source = snapshot(home);
    const sourceCounts = counts(home);
    const otherImages = all('SELECT sha256 FROM step_images');
    const { job: done, workspaceId } = await restore(homePackage);
    restored = workspaceId;
    expect(restored).not.toBe(home);
    expect(snapshot(home)).toEqual(source);

    const copy = snapshot(restored);
    expect(recordCounts(restored)).toEqual(Object.fromEntries(Object.entries(sourceCounts).filter(([table]) => table !== 'memberships')));
    // No identifier of the source appears anywhere in the restored Workspace's records.
    const sourceIds = new Set(Object.values(source).flatMap((rows) => (rows as Record<string, unknown>[]).flatMap((row) => Object.entries(row).filter(([column, value]) => (column === 'id' || column.endsWith('_id')) && typeof value === 'string').map(([, value]) => value as string))));
    // (The restoring admin's own membership is the one deliberate exception: a real account, by design.)
    const restoredText = JSON.stringify(Object.entries(copy).filter(([table]) => table !== 'memberships'));
    for (const id of sourceIds) expect(restoredText.includes(id), id).toBe(false);
    expect(t.database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM workspace_restore_marks').n).toBe(0);

    // Name, settings and tools — on and off — as they were; the restoring admin is the only member.
    expect(one('SELECT name, text_recognition, storage_limit_bytes FROM workspaces WHERE id = ?', restored)).toEqual(one('SELECT name, text_recognition, storage_limit_bytes FROM workspaces WHERE id = ?', home));
    expect(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', restored)).toEqual(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', home));
    expect(all('SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?', restored)).toEqual([{ email: 'admin@example.org', role: 'ADMIN' }]);

    // History: names, states, notes and links as they were — by historical identities, not by today's accounts.
    expect(all('SELECT title, state, started_by_display_name FROM runs WHERE workspace_id = ? ORDER BY started_at', restored)).toEqual(all('SELECT title, state, started_by_display_name FROM runs WHERE workspace_id = ? ORDER BY started_at', home));
    const actors = all<{ name: string; status: string; email: string }>('SELECT DISTINCT a.actor_display_name AS name, u.status, u.email FROM audit_events a JOIN users u ON u.id = a.actor_user_id WHERE a.workspace_id = ?', restored);
    expect(actors.length).toBeGreaterThan(0);
    for (const actor of actors) expect(actor).toMatchObject({ status: 'IMPORTED', email: expect.stringMatching(/^[0-9a-f-]{36}@imported\.invalid$/) });
    expect(all('SELECT reason FROM run_document_removals WHERE workspace_id = ?', restored)).toEqual([{ reason: 'Falsches Dokument' }]);
    const links = all<{ from_id: string; to_id: string; from_gone_at: number | null; title: string | null }>('SELECT l.from_id, l.to_id, l.from_gone_at, d.title FROM links l LEFT JOIN documents d ON d.id = l.from_id WHERE l.workspace_id = ? ORDER BY d.title', restored);
    expect(links.map((link) => [link.title, link.from_gone_at === null])).toEqual([
      [null, false],
      ['Alte Rechnung', true],
      ['Wasserrechnung März', true],
    ]);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM documents WHERE workspace_id = ? AND deleted_at IS NOT NULL", restored).n).toBe(1);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM maintenance_records m JOIN contacts c ON c.id = m.contact_id WHERE m.workspace_id = ? AND c.workspace_id = ? AND c.deleted_at IS NOT NULL', restored, restored).n).toBe(1);
    expect(one('SELECT corrected_text, corrected_by_display_name FROM document_file_texts WHERE workspace_id = ? AND corrected_text IS NOT NULL', restored)).toEqual({ corrected_text: 'Rechnung März', corrected_by_display_name: 'Olga Öwner' });
    expect(one<{ n: number }>('SELECT count(*) AS n FROM contact_keys WHERE workspace_id = ?', restored).n).toBe(one<{ n: number }>('SELECT count(*) AS n FROM contact_keys WHERE workspace_id = ?', home).n);

    // Nothing reminds anyone: Schedules paused, assignments cleared, no reminder planned.
    expect(all('SELECT DISTINCT state FROM schedules WHERE workspace_id = ?', restored)).toEqual([{ state: 'PAUSED' }]);
    expect(one('SELECT count(*) AS n FROM schedules WHERE workspace_id = ? AND assignee_user_id IS NOT NULL', restored)).toEqual({ n: 0 });
    expect(one('SELECT count(*) AS n FROM occurrences WHERE workspace_id = ? AND assignee_user_id IS NOT NULL', restored)).toEqual({ n: 0 });
    expect(one('SELECT count(*) AS n FROM scheduled_reminders r JOIN occurrences o ON o.id = r.occurrence_id WHERE o.workspace_id = ?', restored)).toEqual({ n: 0 });
    // …also once an admin resumes one: its creator is a historical identity and nobody is assigned.
    const schedule = one<{ id: string; revision: number }>('SELECT id, revision FROM schedules WHERE workspace_id = ? AND title IS NOT NULL', restored);
    expect((await t.post(`${api(restored)}/schedules/${schedule.id}/resume`, { expectedRevision: schedule.revision, skipElapsed: true }, t.admin)).statusCode).toBe(200);
    expect(one('SELECT count(*) AS n FROM scheduled_reminders r JOIN occurrences o ON o.id = r.occurrence_id WHERE o.workspace_id = ?', restored)).toEqual({ n: 0 });

    // Originals byte for byte, and the same storage accounting as the source.
    const files = all<{ id: string; sha256: string }>('SELECT id, sha256 FROM document_files WHERE workspace_id = ?', restored);
    for (const file of files) {
      const original = await t.get(`${api(restored)}/document-files/${file.id}/original`, t.admin);
      expect(original.statusCode).toBe(200);
      expect(sha(original.rawPayload)).toBe(file.sha256);
    }
    expect(files.map((file) => file.sha256).sort()).toEqual([sha(PNG), sha(PNG), sha(PNG2)].sort());
    const usage = async (workspaceId: string, cookie: string) => (await t.get(`${api(workspaceId)}/document-files/usage`, cookie)).json().usage;
    expect(await usage(restored, t.admin)).toEqual(await usage(home, owner));
    expect(all('SELECT sha256 FROM step_images')).toEqual(expect.arrayContaining(otherImages));

    // Audited without content; the job's files are gone.
    const events = all<{ type: string; metadata: string }>("SELECT type, metadata FROM security_events WHERE type IN ('WORKSPACE_RESTORE_UPLOADED', 'WORKSPACE_RESTORED') ORDER BY occurred_at");
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['WORKSPACE_RESTORE_UPLOADED', 'WORKSPACE_RESTORED']));
    expect(events.map((event) => event.metadata).join()).not.toMatch(/Wäsche|Wasserrechnung|Rossi|example\.org/);
    expect(existsSync(join(backupRoot(), done.id))).toBe(false);
  });

  it('keeps historical identities apart from accounts: no sign-in, recovery, invitation, membership or activation', async () => {
    const imported = all<{ id: string; email: string; display_name: string }>("SELECT id, email, display_name FROM users WHERE status = 'IMPORTED'");
    expect(imported.map((person) => person.display_name).sort()).toEqual(expect.arrayContaining(['Olga Öwner', 'Uma 🌸']));
    // Real accounts with the same names and addresses are untouched and were not matched.
    expect(one("SELECT status FROM users WHERE email = 'owner@example.org'")).toEqual({ status: 'ACTIVE' });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'owner@example.org'").n).toBe(1);
    const person = imported[0] as { id: string; email: string };
    expect((await t.post('/api/auth/sign-in', { email: person.email, password: PASSWORD })).statusCode).not.toBe(200);
    expect(((await t.get('/api/admin/accounts', t.admin)).json().accounts as { id: string }[]).map((account) => account.id)).not.toContain(person.id);
    expect((await t.post(`/api/admin/accounts/${person.id}/status`, { status: 'ACTIVE', password: PASSWORD }, t.admin)).statusCode).toBe(404);
    expect((await t.post(`/api/admin/accounts/${person.id}/status`, { status: 'DISABLED', password: PASSWORD }, t.admin)).statusCode).toBe(404);
    expect((await t.post('/api/admin/recoveries', { email: person.email, scope: 'PASSWORD', password: PASSWORD }, t.admin)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.post('/api/admin/invitations', { email: person.email }, t.admin)).statusCode).toBe(400);
    expect((await t.addMember(restored, person.email, 'USER')).statusCode).toBeGreaterThanOrEqual(400);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM users WHERE status = 'IMPORTED' AND (email_verified = 1 OR server_admin = 1)").n).toBe(0);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.status = 'IMPORTED'").n).toBe(0);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.status = 'IMPORTED'").n).toBe(0);
  });

  it('restores the same package twice as two independent Workspaces, and confirms each restore exactly once', async () => {
    const first = new Set(Object.values(snapshot(restored)).flatMap((rows) => (rows as { id?: string }[]).map((row) => row.id)).filter(Boolean));
    const ready = await validated(homePackage);
    const confirmations = await Promise.all([t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin), t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)]);
    expect(confirmations.map((response) => response.statusCode).sort()).toEqual([202, 409]);
    const workspaces = workspaceCount();
    await runQueue();
    expect(workspaceCount()).toBe(workspaces + 1);
    const second = (await job(ready.id)).workspaceId as string;
    expect((await t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)).statusCode).toBe(409);
    expect((await t.post(`${RESTORES}/${ready.id}/cancel`, {}, t.admin)).json().restore).toMatchObject({ state: 'READY', phase: 'restored' });
    for (const row of Object.values(snapshot(second)).flat() as { id?: string }[]) if (row.id !== undefined) expect(first.has(row.id)).toBe(false);
    // Complete on its own (compared with the source: the first restore has been used since).
    expect(recordCounts(second)).toEqual(recordCounts(home));
    // Its own historical identities: none shared with the first restore.
    const actorsOf = (workspaceId: string) => new Set(all<{ id: string }>('SELECT DISTINCT actor_user_id AS id FROM audit_events WHERE workspace_id = ?', workspaceId).map((row) => row.id));
    const overlap = [...actorsOf(second)].filter((id) => actorsOf(restored).has(id));
    expect(overlap).toEqual([]);
  });

  it('works for a Workspace whose optional tools are all off', async () => {
    const { workspaceId } = await restore(await exportOf(office, outsider));
    expect(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', workspaceId)).toEqual(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', office));
    expect(one<{ title: string }>('SELECT title FROM procedures WHERE workspace_id = ?', workspaceId).title).toBe('Office procedure');
  });

  describe('refuses damaged, malicious and incompatible packages — creating nothing', () => {
    const refused = async (payload: Buffer, code: string | RegExp) => {
      const before = { workspaces: workspaceCount(), imported: importedCount(), files: one<{ n: number }>('SELECT count(*) AS n FROM document_files').n };
      const failed = await validated(payload);
      expect(failed.state).toBe('FAILED');
      expect(failed.errorCode).toMatch(code);
      expect({ workspaces: workspaceCount(), imported: importedCount(), files: one<{ n: number }>('SELECT count(*) AS n FROM document_files').n }).toEqual(before);
      expect(existsSync(join(backupRoot(), failed.id))).toBe(false);
      expect(one<{ n: number }>('SELECT count(*) AS n FROM workspace_restore_marks').n).toBe(0);
    };

    it('not a package, a damaged one, a newer or unknown version', async () => {
      await refused(Buffer.from('PK definitely not a zip'), 'not_a_backup');
      const flipped = Buffer.from(homePackage);
      const at = flipped.indexOf(PNG2.subarray(8, 30));
      flipped[at + 5] = (flipped[at + 5] as number) ^ 0xff;
      await refused(flipped, 'damaged');
      await refused(await repack(homePackage, () => undefined, { databaseLevel: '9999_from_the_future' }), 'unsupported_version');
      await refused(await repack(homePackage, () => undefined, { databaseLevel: '0040_list_change_stamps' }), 'unsupported_version');
    });

    it('records that are malformed, refer to nothing, or invent people', async () => {
      await refused(await repack(homePackage, (files) => write(files, 'procedures', lines(files, 'procedures').map((row) => ({ ...row, injected: 'x' })))), 'malformed_records');
      await refused(await repack(homePackage, (files) => write(files, 'run_steps', lines(files, 'run_steps').map((row) => ({ ...row, run_id: randomUUID() })))), 'broken_reference');
      await refused(await repack(homePackage, (files) => write(files, 'runs', lines(files, 'runs').map((row) => ({ ...row, started_by_user_id: 'person-999' })))), 'broken_reference');
      // An id used twice — e.g. to make a link point at a record of another kind.
      await refused(
        await repack(homePackage, (files) => {
          const procedure = lines(files, 'procedures')[0] as { id: string };
          write(files, 'lists', lines(files, 'lists').map((row) => ({ ...row, id: procedure.id })));
        }),
        'malformed_records',
      );
      // A live link to a record the package does not contain.
      await refused(await repack(homePackage, (files) => write(files, 'links', lines(files, 'links').map((row) => (row.from_gone_at === null ? { ...row, to_id: randomUUID() } : row)))), 'broken_reference');
      await refused(await repack(homePackage, (files) => write(files, 'schedules', lines(files, 'schedules').map((row) => ({ ...row, reminders: '[{"unit":"YEARS","amount":1}]' })))), 'malformed_records');
      await refused(await repack(homePackage, (files) => write(files, 'workspace', [])), 'malformed_records');
      await refused(await repack(homePackage, (files) => files.delete('data/persons.ndjson')), 'malformed_records');
    });

    it('files that are not what they claim, missing or unused', async () => {
      const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
      await refused(
        await repack(homePackage, (files) => {
          files.delete(`files/documents/${sha(PNG2)}`);
          files.set(`files/documents/${sha(html)}`, html);
          write(files, 'document_files', lines(files, 'document_files').map((row) => (row.sha256 === sha(PNG2) ? { ...row, sha256: sha(html), bytes: html.length } : row)));
        }),
        'unsupported_file',
      );
      await refused(await repack(homePackage, (files) => files.delete(`files/documents/${sha(PNG2)}`)), 'missing_file');
      await refused(await repack(homePackage, (files) => files.set(`files/documents/${sha(Buffer.from('%PDF-1.4 extra'))}`, Buffer.from('%PDF-1.4 extra'))), /unsupported_file|unexpected_file/);
    });

    it('a Workspace larger than its storage limit allows', async () => {
      await refused(await repack(homePackage, (files) => write(files, 'workspace', lines(files, 'workspace').map((row) => ({ ...row, storage_limit_bytes: 10 })))), 'storage_limit');
    });

    it('an upload above the server’s restore limit', async () => {
      const adminId = one<{ id: string }>("SELECT id FROM users WHERE email = 'admin@example.org'").id;
      sql('INSERT INTO instance_settings (id, updated_at, updated_by_user_id, workspace_restore_max_bytes) VALUES (1, 0, ?, 1000) ON CONFLICT(id) DO UPDATE SET workspace_restore_max_bytes = 1000', adminId);
      try {
        const response = await upload(RESTORES, t.admin, homePackage);
        expect(response.statusCode).toBe(413);
        const [latest] = (await t.get(RESTORES, t.admin)).json().restores as Job[];
        expect(latest).toMatchObject({ state: 'FAILED', errorCode: 'too_large' });
        expect(existsSync(join(backupRoot(), (latest as Job).id))).toBe(false);
      } finally {
        sql('UPDATE instance_settings SET workspace_restore_max_bytes = 20000000000 WHERE id = 1');
      }
    });
  });

  it('rolls everything back when the database fails during the restore, and never deletes files another Workspace uses', async () => {
    const ready = await validated(homePackage);
    const before = { workspaces: workspaceCount(), imported: importedCount() };
    t.database.sqlite.exec("CREATE TEMP TRIGGER fail_restore BEFORE INSERT ON main.links BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    try {
      expect((await t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)).statusCode).toBe(202);
      await runQueue();
    } finally {
      t.database.sqlite.exec('DROP TRIGGER fail_restore');
    }
    expect(await job(ready.id)).toMatchObject({ state: 'FAILED', workspaceId: null });
    expect({ workspaces: workspaceCount(), imported: importedCount() }).toEqual(before);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM workspace_restore_marks').n).toBe(0);
    // The source's originals are still there and still download.
    const file = one<{ id: string }>('SELECT id FROM document_files WHERE workspace_id = ? LIMIT 1', home);
    expect((await t.get(`${api()}/document-files/${file.id}/original`, owner)).statusCode).toBe(200);
  });

  it('handles restarts predictably: an interrupted job fails and is cleaned up; a validated one can still be confirmed', async () => {
    const adminId = one<{ id: string }>("SELECT id FROM users WHERE email = 'admin@example.org'").id;
    const stale = randomUUID();
    sql("INSERT INTO workspace_backup_jobs (id, kind, state, phase, requested_by_user_id, progress_done, progress_total, cancel_requested, created_at, started_at, lease_until) VALUES (?, 'RESTORE', 'RUNNING', 'restore', ?, 0, 0, 0, 1, 1, 2)", stale, adminId);
    mkdirSync(join(backupRoot(), stale), { recursive: true });
    writeFileSync(join(backupRoot(), stale, 'upload.vmnbackup'), 'partial');
    const ready = await validated(homePackage);
    await t.restart();
    await runQueue();
    expect(await job(stale)).toMatchObject({ state: 'FAILED', errorCode: 'interrupted' });
    expect(existsSync(join(backupRoot(), stale))).toBe(false);
    expect(await job(ready.id)).toMatchObject({ state: 'READY', phase: 'validated' });
    expect((await t.post(`${RESTORES}/${ready.id}/confirm`, {}, t.admin)).statusCode).toBe(202);
    await runQueue();
    expect(await job(ready.id)).toMatchObject({ state: 'READY', phase: 'restored' });
  });

  it('never takes the server down when the jobs cannot be read (e.g. migrations pending): the runner reports and goes on', async () => {
    t.database.sqlite.exec('ALTER TABLE workspace_backup_jobs RENAME TO workspace_backup_jobs_hidden');
    try {
      await expect(runQueue()).resolves.toBe(false);
    } finally {
      t.database.sqlite.exec('ALTER TABLE workspace_backup_jobs_hidden RENAME TO workspace_backup_jobs');
    }
    expect((await t.get('/api/health', t.admin)).statusCode).toBe(200);
  });

  it('restores a large Workspace', async () => {
    const big = await t.createWorkspace('Groß 🏔️');
    const list = (await t.post(`${api(big)}/lists`, { title: 'Vorrat' }, t.admin)).json().list;
    const adminId = one<{ id: string }>("SELECT id FROM users WHERE email = 'admin@example.org'").id;
    const insert = t.database.sqlite.prepare(
      'INSERT INTO list_items (id, list_id, workspace_id, position, title, revision, created_by_user_id, created_by_display_name, created_at, content_changed_at, content_changed_by_display_name, check_changed_at, check_changed_by_display_name) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, 1, ?, 1, ?)',
    );
    t.database.sqlite.transaction(() => {
      for (let index = 0; index < 5000; index++) insert.run(randomUUID(), list.id, big, index + 1, `Artikel ${index} – ü`, adminId, 'Ada', 'Ada', 'Ada');
    })();
    const { workspaceId } = await restore(await exportOf(big, t.admin));
    expect(one<{ n: number }>('SELECT count(*) AS n FROM list_items WHERE workspace_id = ?', workspaceId).n).toBe(5000);
  }, 120_000);

  function backupRoot(): string {
    return join(dirname(t.documentsPath), 'workspace-backups');
  }
});

import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPORTED_TABLES } from '@vergissmeinnicht/database';
import { openWorkspaceBackup } from '@vergissmeinnicht/import-export';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

/**
 * Section 18c — the whole recovery path, as an administrator uses it: a Workspace with every tool is exported,
 * uploaded through the server-admin restore, checked, previewed and confirmed; the restored Workspace is compared
 * with the original record by record and file by file, and then exported again — its package must equal the
 * original package after normalising what legitimately differs (see `normalise`).
 */
const ORIGIN = 'https://vmn.example.org';
const STEP = { title: 'Stove off', description: 'Knopf nach links ⟲', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const PNG2 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'base64');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type Row = Record<string, unknown>;

/** A package's records and files (records by table name, in package order). */
async function contents(work: string, payload: Buffer): Promise<{ tables: Map<string, Row[]>; persons: Map<string, string>; files: string[] }> {
  const path = join(work, `${randomUUID()}.vmnbackup`);
  writeFileSync(path, payload);
  const opened = await openWorkspaceBackup(path);
  const tables = new Map<string, Row[]>();
  const persons = new Map<string, string>();
  const files: string[] = [];
  for (const name of opened.entries.keys()) {
    if (name.startsWith('files/')) files.push(name);
    if (!name.startsWith('data/')) continue;
    const rows = String(await opened.read(name))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Row);
    const table = name.slice('data/'.length, -'.ndjson'.length);
    if (table === 'persons') for (const row of rows) persons.set(row.ref as string, row.displayName as string);
    else tables.set(table, rows);
  }
  opened.close();
  return { tables, persons, files: files.sort() };
}

/**
 * The records with what legitimately differs between an original and a re-export of its restore made equal:
 * - ids: every id becomes its order of first appearance (`#1`, `#2`, …) — a restore gives everything new ids;
 * - people: a person reference becomes the person's name — references are numbered per package;
 * - memberships: not restored (the restoring admin is the only member) — left out;
 * - Schedules: restored paused (`PAUSED`, paused at the restore) and unassigned; Occurrences unassigned (D7);
 * - recognised text being read when exported is queued again;
 * - people named only by a membership or an assignment are not in the re-export (see the test).
 * Row order needs no normalising: packages list rows in insertion order, which a restore keeps.
 */
function normalise(packageContents: { tables: Map<string, Row[]>; persons: Map<string, string> }): Record<string, Row[]> {
  const ordinals = new Map<string, string>();
  const ordinal = (id: string) => {
    let value = ordinals.get(id);
    if (value === undefined) {
      value = `#${ordinals.size + 1}`;
      ordinals.set(id, value);
    }
    return value;
  };
  const result: Record<string, Row[]> = {};
  for (const spec of EXPORTED_TABLES) {
    const rows = packageContents.tables.get(spec.name) ?? [];
    result[spec.name] = rows.map((row) => {
      const copy: Row = {};
      for (const key of Object.keys(row).sort()) {
        const value = row[key];
        if (spec.userColumns.includes(key)) copy[key] = value === null ? null : `person:${packageContents.persons.get(value as string) ?? '?'}`;
        else copy[key] = typeof value === 'string' ? value.replace(UUID, ordinal) : value;
      }
      if (spec.name === 'schedules') {
        if (copy.state === 'ACTIVE' || copy.state === 'PAUSED') copy.state = 'PAUSED';
        delete copy.paused_at;
        copy.assignee_user_id = null;
      }
      if (spec.name === 'occurrences') copy.assignee_user_id = null;
      if (spec.name === 'document_file_texts' && copy.state === 'PROCESSING') copy.state = 'QUEUED';
      return copy;
    });
  }
  delete result.memberships;
  return result;
}

describe('Workspace recovery end to end (section 18c): export → restore → compare → re-export', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let owner: string;
  const work = mkdtempSync(join(tmpdir(), 'vmn-recovery-test-'));
  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const RESTORES = '/api/admin/workspace-restores';
  const upload = (url: string, cookie: string, payload: Buffer, name?: string) =>
    t.app.inject({ method: 'POST', url, headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream', ...(name === undefined ? {} : { 'x-file-name': encodeURIComponent(name) }) }, payload });
  const one = <T>(statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).get(...values) as T;
  const all = <T>(statement: string, ...values: unknown[]) => t.database.sqlite.prepare(statement).all(...values) as T[];
  const snapshot = (workspaceId: string) => Object.fromEntries(EXPORTED_TABLES.map((spec) => [spec.table, t.database.sqlite.prepare(spec.select).all(...Array.from({ length: (spec.from.match(/\?/g) ?? []).length }, () => workspaceId))]));

  async function exportOf(workspaceId: string, cookie: string): Promise<Buffer> {
    expect((await t.post(`${api(workspaceId)}/backups`, {}, cookie)).statusCode).toBe(202);
    await t.services.backupRunner.wake();
    const [ready] = (await t.get(`${api(workspaceId)}/backups`, cookie)).json().jobs as { id: string; state: string }[];
    expect(ready?.state).toBe('READY');
    const download = await t.get(`${api(workspaceId)}/backups/${ready?.id}/download`, cookie);
    expect(download.statusCode).toBe(200);
    return download.rawPayload;
  }

  beforeAll(async () => {
    t = await startTestApp({ captureLogs: true });
    owner = await t.invite('owner@example.org', 'Olga Öwner');
    await t.invite('helper@example.org', 'Hélène 助手');
    await t.invite('guest@example.org', 'Gus');
    const helperId = one<{ id: string }>("SELECT id FROM users WHERE email = 'helper@example.org'").id;
    home = await t.createWorkspace('Ferienhaus Triora 🏡');
    await t.addMember(home, 'owner@example.org', 'ADMIN');
    await t.addMember(home, 'helper@example.org', 'USER');
    await t.addMember(home, 'guest@example.org', 'GUEST');
    for (const tool of ['DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT']) await t.post(`${api()}/tools`, { tool, enabled: true }, owner);

    // Procedures with an instruction image; a second one in Trash.
    const image = (await upload(`${api()}/images`, owner, PNG)).json().image as { id: string };
    const procedure = (
      await t.post(`${api()}/procedures`, { title: 'Haus schließen', description: 'Vor der Abreise', icon: 'home', tags: ['abreise'], sections: [{ title: 'Küche', description: '', steps: [{ ...STEP, image: { id: image.id, caption: 'So sieht es aus' } }, { ...STEP, title: 'Fenster zu' }] }] }, owner)
    ).json().procedure as { id: string };
    const old = (await t.post(`${api()}/procedures`, { title: 'Alte Liste', description: '', icon: 'home', tags: [], sections: [{ title: 'A', description: '', steps: [STEP] }] }, owner)).json().procedure as { id: string };
    await t.post(`${api()}/procedures/${old.id}/delete`, {}, owner);

    // Documents: live (in a Folder), in Trash, deleted for good but kept by a Run; recognised text with a correction.
    const document = async (title: string, bytes: Buffer, folderId: string | null) => {
      const file = (await upload(`${api()}/document-files`, owner, bytes, `${title}.png`)).json().file as { id: string };
      return (await t.post(`${api()}/documents`, { title, folderId, fileIds: [file.id] }, owner)).json().document as { id: string };
    };
    const folder = (await t.post(`${api()}/document-folders`, { name: 'Verträge', parentId: null }, owner)).json().folder as { id: string };
    const contract = await document('Stromvertrag', PNG, folder.id);
    const trashed = await document('Alte Rechnung', PNG2, null);
    const purged = await document('Garantie (weg)', PNG, null);
    for (const each of [contract, trashed, purged]) await t.post(`${api()}/documents/${each.id}/links`, { target: { type: 'procedure', id: procedure.id } }, owner);

    // Runs: one completed by two people with a kept Document version; one still active keeping a Document deleted later.
    const finished = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, owner)).json().run;
    await t.post(`${api()}/runs/${finished.id}/steps/${finished.sections[0].steps[0].id}/state`, { expectedState: 'PENDING', state: 'DONE' }, owner);
    await t.post(`${api()}/runs/${finished.id}/steps/${finished.sections[0].steps[1].id}/state`, { expectedState: 'PENDING', state: 'NOT_APPLICABLE', reason: 'Fenster schon zu' }, owner);
    await t.post(`${api()}/runs/${finished.id}/documents`, { documentId: contract.id }, owner);
    expect((await t.post(`${api()}/runs/${finished.id}/complete`, {}, owner)).statusCode).toBe(200);
    const active = (await t.post(`${api()}/runs`, { procedureId: procedure.id }, owner)).json().run;
    await t.post(`${api()}/runs/${active.id}/documents`, { documentId: purged.id }, owner);
    await t.post(`${api()}/documents/${trashed.id}/delete`, {}, owner);
    await t.post(`${api()}/documents/${purged.id}/delete`, {}, owner);
    expect((await t.post(`${api()}/documents/trash/purge`, { items: [{ kind: 'document', id: purged.id }] }, owner)).statusCode).toBe(200);
    const ownerId = one<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.org'").id;
    t.database.sqlite
      .prepare("UPDATE document_file_texts SET state = 'DONE', source = 'OCR', text = 'Strom', search_text = 'strom', bytes = 5, pages = 1, corrected_text = 'Strom 2026', corrected_search_text = 'strom 2026', correction_bytes = 10, corrected_by_user_id = ?, corrected_by_display_name = 'Olga Öwner', corrected_at = 1 WHERE workspace_id = ?")
      .run(ownerId, home);

    // Schedules: active and assigned (with reminders, one Occurrence done), paused; a recurring Procedure schedule.
    const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const tax = (await t.post(`${api()}/schedules`, { title: 'Grundsteuer zahlen', date: soon(2), timeZone: 'Europe/Rome', recurrence: { kind: 'FIXED', unit: 'YEAR', interval: 1 }, reminders: [{ unit: 'DAYS', amount: 1 }], assigneeUserId: helperId }, owner)).json().schedule as { id: string };
    const occurrence = (await t.get(`${api()}/schedules/${tax.id}/occurrences`, owner)).json().occurrences?.[0] as { id: string } | undefined;
    if (occurrence !== undefined) await t.post(`${api()}/occurrences/${occurrence.id}/complete`, {}, owner);
    const paused = (await t.post(`${api()}/schedules`, { title: 'Pool winterfest', date: soon(60), timeZone: 'Europe/Rome', reminders: [] }, owner)).json().schedule as { id: string; revision: number };
    expect((await t.post(`${api()}/schedules/${paused.id}/pause`, { expectedRevision: paused.revision }, owner)).statusCode).toBe(200);
    await t.post(`${api()}/schedules`, { procedureId: procedure.id, date: soon(30), timeZone: 'UTC', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 1 }, reminders: [] }, owner);

    // Lists, Contacts, Maintenance (with a Contact), Equipment; then Equipment switched off (its data stays).
    const list = (await t.post(`${api()}/lists`, { title: 'Einkauf' }, owner)).json().list as { id: string };
    for (const title of ['Olivenöl', 'Brot', 'Caffè']) await t.post(`${api()}/lists/${list.id}/items`, { title }, owner);
    const contact = (await t.post(`${api()}/contacts`, { name: 'Elettricista Bianchi', phones: [{ value: '+39 0184 000000' }] }, owner)).json().contact as { id: string };
    await t.post(`${api()}/maintenance`, { title: 'Heizung warten', contactId: contact.id }, owner);
    await t.post(`${api()}/equipment`, { name: 'Wärmepumpe' }, owner);
    await t.post(`${api()}/tools`, { tool: 'EQUIPMENT', enabled: false }, owner);
  }, 180_000);
  afterAll(async () => {
    await t.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('restores a Workspace completely through the server-admin workflow and re-exports it unchanged', async () => {
    const original = await exportOf(home, owner);
    const sourceBefore = snapshot(home);
    const sentBefore = t.outbox.length;
    const deliveriesBefore = one<{ n: number }>('SELECT (SELECT count(*) FROM reminder_deliveries) + (SELECT count(*) FROM notification_summaries) + (SELECT count(*) FROM invitations) AS n').n;
    const logsBefore = t.logs.length;

    // Upload, check, preview.
    const uploaded = await upload(RESTORES, t.admin, original);
    expect(uploaded.statusCode).toBe(202);
    const jobId = (uploaded.json().restore as { id: string }).id;
    await t.services.backupRunner.wake();
    const checked = (await t.get(`${RESTORES}/${jobId}`, t.admin)).json().restore;
    expect(checked).toMatchObject({ state: 'READY', phase: 'validated', workspaceId: null });
    expect(checked.preview).toMatchObject({ workspaceName: 'Ferienhaus Triora 🏡', schedulesPaused: 2 });
    expect(checked.preview.counts).toMatchObject({ procedures: 2, runs: 2, step_images: 1, documents: 2, document_folders: 1, contacts: 1, maintenance_records: 1, equipment_records: 1, list_items: 3 });
    expect(checked.preview.previousMembers.map((member: { email: string }) => member.email).sort()).toEqual(['admin@example.org', 'guest@example.org', 'helper@example.org', 'owner@example.org']);

    // Confirm; the new Workspace is linked from the job.
    expect((await t.post(`${RESTORES}/${jobId}/confirm`, {}, t.admin)).statusCode).toBe(202);
    await t.services.backupRunner.wake();
    const done = (await t.get(`${RESTORES}/${jobId}`, t.admin)).json().restore;
    expect(done).toMatchObject({ state: 'READY', phase: 'restored' });
    const restored = done.workspaceId as string;
    expect((await t.get(`${api(restored)}`, t.admin)).statusCode).toBe(200);

    // The original is unchanged; the copy has its own identifiers throughout.
    expect(snapshot(home)).toEqual(sourceBefore);
    const copy = snapshot(restored);
    const sourceIds = new Set(JSON.stringify(sourceBefore).match(UUID));
    const ownIds = JSON.stringify(Object.entries(copy).filter(([table]) => table !== 'memberships')).match(UUID) ?? [];
    expect(ownIds.filter((id) => sourceIds.has(id))).toEqual([]);
    expect(t.database.sqlite.pragma('foreign_key_check')).toEqual([]);

    // Relationships: the Step's image, the Run's kept version, links (live, to Trash, to an end deleted for good), Maintenance ↔ Contact.
    expect(one<{ n: number }>('SELECT count(*) AS n FROM procedure_steps s JOIN procedures p ON p.id = s.procedure_id JOIN step_images i ON i.id = s.image_id WHERE p.workspace_id = ? AND i.workspace_id = ?', restored, restored).n).toBe(1);
    expect(one<{ n: number }>('SELECT count(*) AS n FROM run_document_files f JOIN document_files d ON d.id = f.file_id WHERE f.workspace_id = ? AND d.workspace_id = ?', restored, restored).n).toBe(2);
    expect(all('SELECT from_type, to_type, from_gone_at IS NULL AS live FROM links WHERE workspace_id = ? ORDER BY created_at', restored)).toEqual(all('SELECT from_type, to_type, from_gone_at IS NULL AS live FROM links WHERE workspace_id = ? ORDER BY created_at', home));
    expect(one<{ n: number }>('SELECT count(*) AS n FROM maintenance_records m JOIN contacts c ON c.id = m.contact_id AND c.workspace_id = m.workspace_id WHERE m.workspace_id = ?', restored).n).toBe(1);
    expect(all('SELECT state, title, started_by_display_name, ended_by_display_name FROM runs WHERE workspace_id = ? ORDER BY started_at', restored)).toEqual(all('SELECT state, title, started_by_display_name, ended_by_display_name FROM runs WHERE workspace_id = ? ORDER BY started_at', home));
    expect(all('SELECT s.state, s.state_reason, s.state_changed_by_display_name FROM run_steps s JOIN runs r ON r.id = s.run_id WHERE r.workspace_id = ? ORDER BY r.started_at, s.position', restored)).toEqual(
      all('SELECT s.state, s.state_reason, s.state_changed_by_display_name FROM run_steps s JOIN runs r ON r.id = s.run_id WHERE r.workspace_id = ? ORDER BY r.started_at, s.position', home),
    );
    expect(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', restored)).toEqual(all('SELECT tool, enabled FROM workspace_tools WHERE workspace_id = ? ORDER BY tool', home));

    // Original bytes: every Document original downloads byte for byte; the instruction image is the same file.
    for (const file of all<{ id: string; sha256: string }>('SELECT id, sha256 FROM document_files WHERE workspace_id = ?', restored)) {
      const original_ = await t.get(`${api(restored)}/document-files/${file.id}/original`, t.admin);
      expect(sha(original_.rawPayload)).toBe(file.sha256);
    }
    const imageRow = one<{ id: string; sha256: string }>('SELECT id, sha256 FROM step_images WHERE workspace_id = ?', restored);
    expect(imageRow.sha256).toBe(one<{ sha256: string }>('SELECT sha256 FROM step_images WHERE workspace_id = ?', home).sha256);

    // Schedules paused and unassigned; nothing sent, nobody invited, nothing planned; no address in the logs.
    expect(all('SELECT DISTINCT state FROM schedules WHERE workspace_id = ?', restored)).toEqual([{ state: 'PAUSED' }]);
    expect(one('SELECT count(*) AS n FROM schedules WHERE workspace_id = ? AND assignee_user_id IS NOT NULL', restored)).toEqual({ n: 0 });
    expect(one('SELECT count(*) AS n FROM scheduled_reminders r JOIN occurrences o ON o.id = r.occurrence_id WHERE o.workspace_id = ?', restored)).toEqual({ n: 0 });
    expect(t.outbox.length).toBe(sentBefore);
    expect(one<{ n: number }>('SELECT (SELECT count(*) FROM reminder_deliveries) + (SELECT count(*) FROM notification_summaries) + (SELECT count(*) FROM invitations) AS n').n).toBe(deliveriesBefore);
    const restoreLogs = t.logs.slice(logsBefore);
    expect(restoreLogs).not.toMatch(/example\.org|Olga|Hélène|Triora/);

    // Re-export the restored Workspace: equal to the original once ids, people and the documented differences are normalised.
    const again = await exportOf(restored, t.admin);
    const first = await contents(work, original);
    const second = await contents(work, again);
    expect(second.files).toEqual(first.files);
    const a = normalise(first);
    const b = normalise(second);
    for (const table of Object.keys(a)) expect(b[table], table).toEqual(a[table]);
    // The people: everyone the restored records name, by the same name (as historical identities now). People who
    // were only members or assignees are named by no restored record (memberships are not restored, assignments are
    // cleared) — they are listed for re-inviting instead, and have no historical identity.
    expect([...second.persons.values()].every((name) => [...first.persons.values()].includes(name))).toBe(true);
    expect([...first.persons.values()].filter((name) => ![...second.persons.values()].includes(name)).sort()).toEqual(['Gus', 'Hélène 助手']);
    expect(String(again)).not.toMatch(/owner@example\.org|helper@example\.org|guest@example\.org/);
  }, 120_000);
});

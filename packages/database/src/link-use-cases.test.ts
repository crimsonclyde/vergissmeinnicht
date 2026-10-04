import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadyLinkedError,
  DOCUMENT_FILE_PENDING_MS,
  DocumentNotFoundError,
  LinkNotFoundError,
  LinkTargetNotFoundError,
  DocumentFileNotFoundError,
  NotAuthorizedError,
  RunFinishedError,
  RunNotFoundError,
  RunStillActiveError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  addDocumentLink,
  addMember,
  changeMemberRole,
  changeStepState,
  completeRun,
  createDocument,
  createFolder,
  createPreviewQueue,
  createProcedure,
  createSchedule,
  createWorkspace,
  deleteDocument,
  deleteProcedure,
  endSchedule,
  exportDocuments,
  getDocument,
  getRun,
  linkRunDocument,
  listDocumentLinks,
  listLinkedDocuments,
  listRunDocuments,
  moveDocuments,
  openOriginal,
  purgeDocumentTrash,
  purgeUnusedDocumentFiles,
  removeDocumentLink,
  removeRunDocumentFromFinishedRun,
  restoreDocument,
  setDocumentFiles,
  setWorkspaceTool,
  startRun,
  unlinkRunDocument,
  updateDocument,
  uploadDocumentFile,
  workspaceStorage,
  type DocumentExport,
  type DocumentExportDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type LinkDeps,
  type ProcedureInput,
  type RunDeps,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ProcedureId, type RunId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createLinkRepository } from './link-repository.ts';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createStorageRepository } from './storage-usage.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

let serial = 0;
const bytesOf = (size: number, label = 'file') => {
  const data = new Uint8Array(size);
  data.set(new TextEncoder().encode(`${label} ${++serial} `).subarray(0, size));
  return data;
};
const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async () => ({ jpeg: bytesOf(100, 'preview'), width: 1800, height: 2400 }),
  thumbnail: async () => ({ jpeg: bytesOf(20, 'thumb'), width: 300, height: 400 }),
};
const PROCEDURE: ProcedureInput = {
  title: 'Boiler service',
  description: '',
  icon: 'home',
  tags: [],
  sections: [{ title: 'All', description: '', steps: [{ title: 'Check pressure', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' }] }],
};
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('Links between Documents, Procedures, Reminders and Runs (16.5)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let links: LinkDeps;
  let docs: DocumentExportDeps;
  let files: DocumentFileDeps;
  let work: ScheduleDeps & RunDeps;
  let admin: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let boiler: ProcedureId;
  let theirProcedure: ProcedureId;
  const clock = { now: () => now };
  const tick = () => (now = new Date(now.getTime() + 60_000));
  const ref = (actor: User, workspace = home) => ({ actor, workspaceId: workspace.id });
  const procedureDeps = () => ({ workspaces: docs.workspaces, procedures: createProcedureRepository(database), clock });
  const upload = async (content: Uint8Array, name: string, actor = uma, workspace = home) =>
    (
      await uploadDocumentFile(files, {
        actor,
        workspaceId: workspace.id,
        name,
        source: (async function* () {
          yield content;
        })(),
      })
    ).file;
  const document = async (title: string, pages = 1, actor = uma, workspace = home, folderId: string | null = null) => {
    tick();
    const fileIds = [];
    for (let page = 1; page <= pages; page++) fileIds.push((await upload(bytesOf(1000 + page), `${title}-${page}.jpg`, actor, workspace)).id);
    return createDocument(docs, { ...ref(actor, workspace), folderId, content: { title }, fileIds });
  };
  const reminder = (title = 'Pay water bill', actor = uma, workspace = home) => createSchedule(work, { actor, workspaceId: workspace.id, title, date: '2027-06-30', timeZone: 'Europe/Berlin', reminders: [] });
  const finishedRun = async (procedureId = boiler, actor = uma, workspace = home) => {
    const started = await startRun(work, { actor, workspaceId: workspace.id, procedureId });
    const runId = started.run.id as RunId;
    for (const step of started.sections.flatMap((section) => section.steps)) await changeStepState(work, { actor, workspaceId: workspace.id, runId, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
    await completeRun(work, { actor, workspaceId: workspace.id, runId });
    return runId;
  };
  /** A minute after the one before, so Links are listed in the order they were made. */
  const link = (documentId: string, type: string, id: string, actor = uma, workspace = home) => {
    tick();
    return addDocumentLink(links, { ...ref(actor, workspace), documentId, target: { type, id } });
  };
  const linksOf = async (documentId: string, actor = gus) => listDocumentLinks(links, { ...ref(actor), documentId });
  const audit = (type: string) =>
    (database.sqlite.prepare('SELECT actor_display_name AS actor, subject_type AS subject, subject_id AS id, run_id AS runId, metadata FROM audit_events WHERE type = ? ORDER BY rowid').all(type) as { actor: string; subject: string; id: string; runId: string | null; metadata: string }[]).map(
      (event) => ({ ...event, metadata: JSON.parse(event.metadata) as Record<string, unknown> }),
    );
  const code = async (run: Promise<unknown>) => run.then(
    () => undefined,
    (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : (caught as Error).name),
  );
  const read = async (stream: AsyncIterable<Uint8Array>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  /** Per Document title: its relationships as an export names them. */
  const exportedLinks = async () => {
    let archive: DocumentExport | undefined;
    await exportDocuments(docs, { ...ref(gus), request: {} }, async (given) => {
      archive = given;
    });
    return new Map((archive?.documents ?? []).map((each) => [each.title, each.links.map((related) => `${related.type}:${related.id}`)]));
  };
  const rows = (table: string) => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-links-'));
    now = new Date('2026-10-02T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const tools = createWorkspaceToolRepository(database);
    const fileRepository = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    docs = { workspaces, tools, documents: createDocumentRepository(database), store, clock };
    files = { workspaces, tools, files: fileRepository, store, processor, clock, previews: createPreviewQueue({ files: fileRepository, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] }) };
    links = { workspaces, tools, links: createLinkRepository(database), clock };
    work = { workspaces, schedules: createScheduleRepository(database), notificationPreferences: createNotificationPreferencesRepository(database), runs: createRunRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: uma.email, role: 'USER' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: gus.email, role: 'GUEST' });
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
    await setWorkspaceTool(docs, { ...ref(otto, office), tool: 'DOCUMENTS', enabled: true });
    boiler = (await createProcedure(procedureDeps(), { actor: admin, workspaceId: home.id, content: PROCEDURE })).procedure.id as ProcedureId;
    theirProcedure = (await createProcedure(procedureDeps(), { actor: otto, workspaceId: office.id, content: { ...PROCEDURE, title: 'Payroll run' } })).procedure.id as ProcedureId;
  });
  afterEach(() => {
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('Links to Procedures, Reminders and related Documents', () => {
    it('links a bill to its payment Reminder, a Procedure and its receipt — references seen from both ends, with their state', async () => {
      const bill = await document('Water bill');
      const receipt = await document('Receipt');
      const pay = await reminder();
      const scheduled = await createSchedule(work, { actor: uma, workspaceId: home.id, procedureId: boiler, date: '2026-11-01', timeZone: 'Europe/Berlin', reminders: [] });
      await link(bill.id, 'schedule', pay.id);
      await link(bill.id, 'procedure', boiler);
      await link(bill.id, 'schedule', scheduled.id);
      await link(receipt.id, 'document', bill.id); // "related": no direction

      const seen = await linksOf(bill.id);
      expect(seen.links.map((each) => [each.record.type, each.record.title, each.record.state, each.record.scheduleKind ?? null, each.record.nextDue ?? null, each.createdByName])).toEqual([
        ['schedule', 'Pay water bill', 'ok', 'REMINDER', '2027-06-30', 'Uma'],
        ['procedure', 'Boiler service', 'ok', null, null, 'Uma'],
        ['schedule', 'Boiler service', 'ok', 'PROCEDURE', '2026-11-01', 'Uma'],
        ['document', 'Receipt', 'ok', null, null, 'Uma'],
      ]);
      expect((await linksOf(receipt.id)).links.map((each) => [each.record.type, each.record.title])).toEqual([['document', 'Water bill']]);
      // From the other end: the Reminder (and so its Occurrences) and the Procedure show the bill.
      expect((await listLinkedDocuments(links, { ...ref(gus), target: { type: 'schedule', id: pay.id } })).map((each) => [each.record.id, each.record.title, each.record.state])).toEqual([[bill.id, 'Water bill', 'ok']]);
      expect((await listLinkedDocuments(links, { ...ref(gus), target: { type: 'procedure', id: boiler } })).map((each) => each.record.title)).toEqual(['Water bill']);
      // Nothing was copied: still two Documents with one file each, and the Reminder is an ordinary Schedule.
      expect({ documents: rows('documents'), files: rows('document_files'), schedules: rows('schedules') }).toEqual({ documents: 2, files: 2, schedules: 2 });
      expect(audit('DOCUMENT_LINK_ADDED').map((event) => [event.actor, event.id, event.metadata])).toContainEqual(['Uma', bill.id, { title: 'Water bill', linkedType: 'schedule', linkedId: pay.id, linkedTitle: 'Pay water bill' }]);

      // The same pair cannot be linked twice — in either direction for two Documents.
      await expect(link(bill.id, 'schedule', pay.id)).rejects.toThrow(AlreadyLinkedError);
      await expect(link(bill.id, 'document', receipt.id)).rejects.toThrow(AlreadyLinkedError);
      expect(await code(link(bill.id, 'document', bill.id))).toBe('link_to_itself');
      expect(await code(link(bill.id, 'run', boiler))).toBe('invalid_link_target');
      expect(await code(link(bill.id, 'constructor', boiler))).toBe('invalid_link_target');

      // Removing a Link removes neither record.
      const first = seen.links[0];
      await removeDocumentLink(links, { ...ref(uma), linkId: first?.id ?? '' });
      expect((await linksOf(bill.id)).links).toHaveLength(3);
      expect(rows('schedules')).toBe(2);
      await expect(removeDocumentLink(links, { ...ref(uma), linkId: first?.id ?? '' })).rejects.toThrow(LinkNotFoundError);
      expect(audit('DOCUMENT_LINK_REMOVED').map((event) => event.metadata)).toEqual([{ title: 'Water bill', linkedType: 'schedule', linkedId: pay.id, linkedTitle: 'Pay water bill' }]);
    });

    it('stays consistent when either end is moved, ended, deleted, restored or deleted for good', async () => {
      const folder = await createFolder(docs, { ...ref(uma), name: 'Water', parentId: null });
      const bill = await document('Water bill');
      const receipt = await document('Receipt');
      const pay = await reminder();
      await link(bill.id, 'schedule', pay.id);
      await link(bill.id, 'procedure', boiler);
      await link(bill.id, 'document', receipt.id);
      const state = async (documentId = bill.id, actor = gus) => (await linksOf(documentId, actor)).links.map((each) => `${each.record.type}:${each.record.state}:${each.record.title ?? '-'}`);
      const onReminder = async (actor = gus) => (await listLinkedDocuments(links, { ...ref(actor), target: { type: 'schedule', id: pay.id } })).map((each) => `${each.record.state}:${each.record.title ?? '-'}`);

      // Moving the Document keeps its Links.
      await moveDocuments(docs, { ...ref(uma), documentIds: [bill.id], folderId: folder.id });
      expect(await state()).toEqual(['schedule:ok:Pay water bill', 'procedure:ok:Boiler service', 'document:ok:Receipt']);
      // An ended Schedule and a deleted Procedure stay visible from the Document, as what they are now.
      await endSchedule(work, { actor: uma, workspaceId: home.id, scheduleId: pay.id, expectedRevision: pay.revision });
      await deleteProcedure(procedureDeps(), { actor: admin, workspaceId: home.id, procedureId: boiler });
      expect(await state()).toEqual(['schedule:ended:Pay water bill', 'procedure:deleted:Boiler service', 'document:ok:Receipt']);
      // A new Link to what is deleted or in Trash cannot be made.
      const other = await document('Other');
      await expect(link(other.id, 'procedure', boiler)).rejects.toThrow(LinkTargetNotFoundError);

      // The Document in Trash: the other end says "in Trash" — and names it only to those who can open Trash.
      await deleteDocument(docs, { ...ref(uma), documentId: bill.id });
      expect(await onReminder(gus)).toEqual(['trash:-']);
      expect(await onReminder(uma)).toEqual(['trash:Water bill']);
      expect(await state(receipt.id, gus)).toEqual(['document:trash:-']);
      await expect(linksOf(bill.id)).rejects.toThrow(DocumentNotFoundError);
      await expect(link(receipt.id, 'document', other.id)).resolves.toBeDefined();
      await expect(link(other.id, 'document', bill.id)).rejects.toThrow(LinkTargetNotFoundError);
      // Restored: the Links are back as they were.
      await restoreDocument(docs, { ...ref(uma), documentId: bill.id });
      expect(await onReminder()).toEqual(['ok:Water bill']);
      expect(await state()).toEqual(['schedule:ended:Pay water bill', 'procedure:deleted:Boiler service', 'document:ok:Receipt']);

      // Deleted for good: the other ends keep a note — when and by whom, no title, no content.
      await deleteDocument(docs, { ...ref(uma), documentId: bill.id });
      const purgedAt = tick();
      await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' });
      const note = await listLinkedDocuments(links, { ...ref(gus), target: { type: 'schedule', id: pay.id } });
      expect(note.map((each) => each.record)).toEqual([{ type: 'document', id: bill.id, title: null, state: 'gone', goneAt: purgedAt, goneByName: 'Ada' }]);
      expect(await state(receipt.id)).toEqual(['document:gone:-', 'document:ok:Other']);
      expect(JSON.stringify(note)).not.toContain('Water bill');
      // The note can be removed; and when both related Documents are gone, nothing is left of the Link.
      await removeDocumentLink(links, { ...ref(uma), linkId: note[0]?.id ?? '' });
      await deleteDocument(docs, { ...ref(uma), documentId: receipt.id });
      await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' });
      expect((database.sqlite.prepare("SELECT count(*) AS n FROM links WHERE to_type = 'document' AND from_gone_at IS NOT NULL AND to_gone_at IS NOT NULL").get() as { n: number }).n).toBe(0);
      expect((await linksOf(other.id)).links.map((each) => each.record.state)).toEqual(['gone']);
    });

    it('gives nobody access: a Link needs manage rights and both ends in the same Workspace, and a guest only reads', async () => {
      const bill = await document('Water bill');
      const pay = await reminder();
      const theirs = await document('Payroll', 1, otto, office);
      const theirReminder = await reminder('Pay salaries', otto, office);
      // A guest reads Links and cannot make or remove one.
      await link(bill.id, 'schedule', pay.id);
      const existing = (await linksOf(bill.id)).links[0];
      await expect(link(bill.id, 'procedure', boiler, gus)).rejects.toThrow(NotAuthorizedError);
      await expect(removeDocumentLink(links, { ...ref(gus), linkId: existing?.id ?? '' })).rejects.toThrow(NotAuthorizedError);
      // An outsider learns nothing, whichever id they use.
      await expect(linksOf(bill.id, otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(link(bill.id, 'schedule', pay.id, otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(listLinkedDocuments(links, { ...ref(otto), target: { type: 'schedule', id: pay.id } })).rejects.toThrow(WorkspaceNotFoundError);
      // Across Workspaces, in every combination: Home's Document under the Office, the Office's records from Home.
      await expect(link(bill.id, 'procedure', theirProcedure, otto, office)).rejects.toThrow(DocumentNotFoundError);
      await expect(link(theirs.id, 'procedure', boiler, otto, office)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(link(theirs.id, 'schedule', pay.id, otto, office)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(link(theirs.id, 'document', bill.id, otto, office)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(link(bill.id, 'procedure', theirProcedure)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(link(bill.id, 'schedule', theirReminder.id)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(link(bill.id, 'document', theirs.id)).rejects.toThrow(LinkTargetNotFoundError);
      await expect(removeDocumentLink(links, { ...ref(otto, office), linkId: existing?.id ?? '' })).rejects.toThrow(LinkNotFoundError);
      // Asked from the Office, Home's records have no linked Documents — not even a count.
      expect(await listLinkedDocuments(links, { ...ref(otto, office), target: { type: 'schedule', id: pay.id } })).toEqual([]);
      await expect(listDocumentLinks(links, { ...ref(otto, office), documentId: bill.id })).rejects.toThrow(DocumentNotFoundError);
      expect(rows('links')).toBe(1);
      // The database itself refuses a Link across Workspaces or to nothing.
      const insert = database.sqlite.prepare("INSERT INTO links (id, workspace_id, from_type, from_id, to_type, to_id, created_by_user_id, created_by_display_name, created_at) VALUES (?, ?, 'document', ?, ?, ?, ?, 'Uma', 1)");
      const id = () => crypto.randomUUID();
      expect(() => insert.run(id(), home.id, bill.id, 'procedure', theirProcedure, uma.id)).toThrow('its own workspace');
      expect(() => insert.run(id(), office.id, bill.id, 'procedure', theirProcedure, uma.id)).toThrow('its own workspace');
      expect(() => insert.run(id(), home.id, bill.id, 'document', theirs.id, uma.id)).toThrow('its own workspace');
      expect(() => insert.run(id(), home.id, bill.id, 'mailbox', id(), uma.id)).toThrow('its own workspace');
      expect(() => insert.run(id(), home.id, id(), 'procedure', boiler, uma.id)).toThrow('its own workspace');
      expect(() => database.sqlite.prepare('UPDATE links SET to_id = ? WHERE id = ?').run(theirProcedure, existing?.id)).toThrow('immutable');
      // Switched off, the tool's Links are as absent as the tool.
      await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
      await expect(linksOf(bill.id, admin)).rejects.toThrow(ToolNotEnabledError);
      await expect(listLinkedDocuments(links, { ...ref(admin), target: { type: 'schedule', id: pay.id } })).rejects.toThrow(ToolNotEnabledError);
      await expect(link(bill.id, 'procedure', boiler, admin)).rejects.toThrow(ToolNotEnabledError);
    });

    it('re-checks the role inside the write', async () => {
      const users = createUserRepository(database);
      const bill = await document('Water bill');
      const demoting: LinkDeps = {
        ...links,
        workspaces: {
          ...links.workspaces,
          findMembership: async (workspaceId, userId) => {
            const membership = await links.workspaces.findMembership(workspaceId, userId);
            if (userId === uma.id) await changeMemberRole({ users, workspaces: links.workspaces, clock }, { actor: admin, workspaceId: home.id, userId: uma.id, role: 'GUEST' }).catch(() => undefined);
            return membership;
          },
        },
      };
      await expect(addDocumentLink(demoting, { ...ref(uma), documentId: bill.id, target: { type: 'procedure', id: boiler } })).rejects.toThrow(NotAuthorizedError);
      expect(rows('links')).toBe(0);
    });
  });

  describe('a Run retains the Document version it was linked with', () => {
    it("keeps the inspection report as it was — title and both pages, byte for byte — through an edit, a replaced page, Trash and permanent deletion", async () => {
      const first = bytesOf(2000, 'page one');
      const second = bytesOf(2100, 'page two');
      tick();
      const fileIds = [(await upload(first, 'report-1.jpg')).id, (await upload(second, 'report-2.jpg')).id];
      const report = await createDocument(docs, { ...ref(uma), folderId: null, content: { title: 'Inspection report', type: { builtIn: 'inspection_report' }, documentDate: '2026-09-30', year: 2026, notes: 'No findings', tags: ['Boiler'] }, fileIds });
      const runId = await finishedRun();
      const before = {
        run: await getRun(work, { actor: gus, workspaceId: home.id, runId }),
        row: database.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runId),
        steps: database.sqlite.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY id').all(runId),
        events: database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(runId),
      };

      const linkedAt = tick();
      const kept = await linkRunDocument(links, { ...ref(uma), runId, documentId: report.id });
      expect(kept).toMatchObject({ title: 'Inspection report', source: 'same', type: { kind: 'builtin', key: 'inspection_report' }, documentDate: '2026-09-30', year: 2026, notes: 'No findings', tags: ['Boiler'], linkedAt, linkedByName: 'Uma' });
      expect(kept.files.map((file) => file.originalName)).toEqual(['report-1.jpg', 'report-2.jpg']);
      // The Run itself — snapshot, Steps, everything recorded before — is untouched; the link is one added event.
      expect(database.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runId)).toEqual(before.row);
      expect(database.sqlite.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY id').all(runId)).toEqual(before.steps);
      expect(await getRun(work, { actor: gus, workspaceId: home.id, runId })).toEqual(before.run);
      const events = database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(runId);
      expect(events.slice(0, before.events.length)).toEqual(before.events);
      expect(audit('RUN_DOCUMENT_LINKED')).toEqual([{ actor: 'Uma', subject: 'run', id: runId, runId, metadata: { documentId: report.id, title: 'Inspection report', files: 2 } }]);
      // Seen from the Document.
      expect((await linksOf(report.id)).runs).toMatchObject([{ runId, runTitle: 'Boiler service', runState: 'COMPLETED', linkedByName: 'Uma', changedSince: false }]);

      const shown = async (actor = gus) => {
        const [document] = (await listRunDocuments(links, { ...ref(actor), runId })).documents;
        if (document === undefined) throw new Error('the Run shows no document');
        const contents = [];
        for (const file of document.files) contents.push(sha(await read((await openOriginal(files, { ...ref(actor), fileId: file.id })).stream)));
        return { title: document.title, notes: document.notes, source: document.source, names: document.files.map((file) => file.originalName), contents };
      };
      const original = { title: 'Inspection report', notes: 'No findings', names: ['report-1.jpg', 'report-2.jpg'], contents: [sha(first), sha(second)] };
      expect(await shown()).toEqual({ ...original, source: 'same' });

      // Retitled: the Run still shows the title of then, and says the Document has changed.
      const edited = await updateDocument(docs, { ...ref(uma), documentId: report.id, expectedRevision: report.revision, content: { title: 'Report (corrected)', notes: 'Two findings' } });
      expect(await shown()).toEqual({ ...original, source: 'changed' });
      expect((await linksOf(report.id)).runs[0]?.changedSince).toBe(true);
      // A page replaced: the removed file is no longer in the Document, and a day of housekeeping later the Run still has it.
      const replacement = await upload(bytesOf(1900, 'new page two'), 'report-2-new.jpg');
      await setDocumentFiles(docs, { ...ref(uma), documentId: report.id, expectedRevision: edited.revision, fileIds: [fileIds[0] ?? '', replacement.id] });
      now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 60_000);
      await purgeUnusedDocumentFiles(files);
      expect(await shown()).toEqual({ ...original, source: 'changed' });
      // In Trash, then deleted for good — and housekeeping again.
      await deleteDocument(docs, { ...ref(uma), documentId: report.id });
      expect(await shown()).toEqual({ ...original, source: 'trash' });
      await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' });
      now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 60_000);
      expect((await purgeUnusedDocumentFiles(files)).files).toBeGreaterThan(0); // the replacement page, which nothing keeps, goes
      expect(await shown()).toEqual({ ...original, source: 'gone' });
      await setWorkspaceTool(docs, { ...ref(admin), tool: 'PROCEDURES', enabled: false });
      await expect(openOriginal(files, { ...ref(gus), fileId: fileIds[0] ?? '' })).rejects.toThrow(DocumentFileNotFoundError);
      await setWorkspaceTool(docs, { ...ref(admin), tool: 'PROCEDURES', enabled: true });
      expect(await shown()).toEqual({ ...original, source: 'gone' });
      await expect(openOriginal(files, { ...ref(gus), fileId: replacement.id })).rejects.toThrow();
      // What the Run keeps still counts towards storage, under its own line.
      const storage = await workspaceStorage({ workspaces: docs.workspaces, storage: createStorageRepository(database), clock }, ref(admin));
      expect(storage).toMatchObject({ originals: 0, trash: 0 });
      expect(storage.retained).toBeGreaterThanOrEqual(first.length + second.length);
      expect(storage.used).toBe(storage.images + storage.previews + storage.retained); // … and towards the limit
      // And the Run is still exactly what it was.
      expect(database.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runId)).toEqual(before.row);
      expect(await getRun(work, { actor: gus, workspaceId: home.id, runId })).toEqual(before.run);
    });

    it('lets a version be removed while the Run is active, and never from a finished Run', async () => {
      const report = await document('Report', 2);
      const started = await startRun(work, { actor: uma, workspaceId: home.id, procedureId: boiler });
      const runId = started.run.id as RunId;
      const kept = await linkRunDocument(links, { ...ref(uma), runId, documentId: report.id });
      await expect(linkRunDocument(links, { ...ref(uma), runId, documentId: report.id })).rejects.toThrow(AlreadyLinkedError);
      await unlinkRunDocument(links, { ...ref(uma), runId, runDocumentId: kept.id });
      expect((await listRunDocuments(links, { ...ref(gus), runId })).documents).toEqual([]);
      expect(audit('RUN_DOCUMENT_UNLINKED')).toEqual([{ actor: 'Uma', subject: 'run', id: runId, runId, metadata: { documentId: report.id, title: 'Report', files: 2 } }]);

      const again = await linkRunDocument(links, { ...ref(uma), runId, documentId: report.id });
      for (const step of started.sections.flatMap((section) => section.steps)) await changeStepState(work, { actor: uma, workspaceId: home.id, runId, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
      await completeRun(work, { actor: uma, workspaceId: home.id, runId });
      for (const actor of [uma, admin]) await expect(unlinkRunDocument(links, { ...ref(actor), runId, runDocumentId: again.id })).rejects.toThrow(RunFinishedError);
      expect((await listRunDocuments(links, { ...ref(gus), runId })).documents).toHaveLength(1);
      // The database refuses it as well, and refuses any change to what is kept.
      expect(() => database.sqlite.prepare('DELETE FROM run_document_files WHERE run_document_id = ?').run(again.id)).toThrow('finished run');
      expect(() => database.sqlite.prepare('DELETE FROM run_documents WHERE id = ?').run(again.id)).toThrow();
      expect(() => database.sqlite.prepare("UPDATE run_documents SET title = 'Rewritten' WHERE id = ?").run(again.id)).toThrow('immutable');
      expect(() => database.sqlite.prepare('UPDATE run_document_files SET position = 5 WHERE run_document_id = ?').run(again.id)).toThrow('immutable');
    });

    it('lets only a Workspace admin remove a version from a finished Run — confirmed, with a reason — leaving a permanent note and nothing of the document (P4)', async () => {
      const users = createUserRepository(database);
      const members = { users, workspaces: links.workspaces, clock };
      const first = bytesOf(2000, 'page one');
      const second = bytesOf(2100, 'page two');
      tick();
      const fileIds = [(await upload(first, 'report-1.jpg')).id, (await upload(second, 'report-2.jpg')).id];
      const report = await createDocument(docs, { ...ref(uma), folderId: null, content: { title: 'Sensitive diagnosis', notes: 'Private findings', tags: ['Health'] }, fileIds });
      const runA = await finishedRun();
      const runB = await finishedRun();
      const keptA = await linkRunDocument(links, { ...ref(uma), runId: runA, documentId: report.id });
      await linkRunDocument(links, { ...ref(uma), runId: runB, documentId: report.id });
      // Page two is replaced afterwards: the Document no longer holds that file — only the two Runs do.
      const replacement = await upload(bytesOf(1900, 'new page two'), 'report-2-new.jpg');
      const edited = await setDocumentFiles(docs, { ...ref(uma), documentId: report.id, expectedRevision: report.revision, fileIds: [fileIds[0] ?? '', replacement.id] });
      const storageOf = () => workspaceStorage({ workspaces: docs.workspaces, storage: createStorageRepository(database), clock }, ref(admin));
      const before = {
        storage: await storageOf(),
        row: database.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runA),
        steps: database.sqlite.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY id').all(runA),
        events: database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(runA),
        run: await getRun(work, { actor: gus, workspaceId: home.id, runId: runA }),
      };
      expect(before.storage.retained).toBeGreaterThanOrEqual(second.length);
      const remove = (actor: User, overrides: Partial<{ runId: string; runDocumentId: string; reason: string; confirmed: boolean; workspace: Workspace; deps: LinkDeps }> = {}) =>
        removeRunDocumentFromFinishedRun(overrides.deps ?? links, { ...ref(actor, overrides.workspace ?? home), runId: overrides.runId ?? runA, runDocumentId: overrides.runDocumentId ?? keptA.id, reason: overrides.reason ?? 'Linked by mistake', confirmed: overrides.confirmed ?? true });

      // Not for a USER or a guest, not from outside, not with Home's ids under another Workspace.
      await expect(remove(uma)).rejects.toThrow(NotAuthorizedError);
      await expect(remove(gus)).rejects.toThrow(NotAuthorizedError);
      await expect(remove(otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(remove(otto, { workspace: office })).rejects.toThrow(LinkNotFoundError);
      // Not without the explicit confirmation, and not without a usable reason.
      expect(await code(remove(admin, { confirmed: false }))).toBe('removal_not_confirmed');
      expect(await code(remove(admin, { reason: '' }))).toBe('removal_reason_required');
      expect(await code(remove(admin, { reason: '  \n ' }))).toBe('removal_reason_required');
      expect(await code(remove(admin, { reason: 'x'.repeat(501) }))).toBe('removal_reason_too_long');
      expect(await code(remove(admin, { reason: 'hidden\u202Etext' }))).toBe('removal_reason_invalid_characters');
      await expect(remove(admin, { runId: runB })).rejects.toThrow(LinkNotFoundError); // this version belongs to the other Run
      // An admin demoted between the check and the write removes nothing.
      const ana = await users.create({ email: normalizeEmail('ana@example.org'), displayName: 'Ana', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
      await addMember(members, { actor: admin, workspaceId: home.id, email: ana.email, role: 'ADMIN' });
      const demoting: LinkDeps = {
        ...links,
        links: {
          ...links.links,
          // After every check of the use-case, right before the transaction that re-checks.
          removeFromFinishedRun: async (input, actor, guard) => {
            await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'USER' });
            return links.links.removeFromFinishedRun(input, actor, guard);
          },
        },
      };
      await expect(remove(ana, { deps: demoting })).rejects.toThrow(NotAuthorizedError);
      // While a Run is active the ordinary removal applies, not this one.
      const started = await startRun(work, { actor: uma, workspaceId: home.id, procedureId: boiler });
      const keptActive = await linkRunDocument(links, { ...ref(uma), runId: started.run.id, documentId: report.id });
      await expect(remove(admin, { runId: started.run.id, runDocumentId: keptActive.id })).rejects.toThrow(RunStillActiveError);
      await unlinkRunDocument(links, { ...ref(uma), runId: started.run.id, runDocumentId: keptActive.id });
      // Nothing was removed by any of that, and nothing but a note allows it below the application either.
      expect((await listRunDocuments(links, { ...ref(gus), runId: runA })).documents).toHaveLength(1);
      expect(rows('run_document_removals')).toBe(0);
      expect(() => database.sqlite.prepare('DELETE FROM run_document_files WHERE run_document_id = ?').run(keptA.id)).toThrow('finished run');

      // The admin removes it.
      const removedAt = tick();
      const note = await remove(admin, { reason: '  Linked to the wrong execution  ' });
      expect(note).toEqual({ id: note.id, reason: 'Linked to the wrong execution', files: 2, linkedAt: keptA.linkedAt, linkedByName: 'Uma', removedAt, removedByName: 'Ada' });
      const shownA = await listRunDocuments(links, { ...ref(gus), runId: runA });
      expect(shownA).toEqual({ documents: [], removals: [note] });
      // Nothing of the document is left with this Run: not in the note, not in the new history entry.
      expect(audit('RUN_DOCUMENT_REMOVED')).toEqual([{ actor: 'Ada', subject: 'run', id: runA, runId: runA, metadata: { reason: 'Linked to the wrong execution', files: 2 } }]);
      const stored = JSON.stringify([database.sqlite.prepare('SELECT * FROM run_document_removals').all(), audit('RUN_DOCUMENT_REMOVED'), shownA]);
      for (const secret of ['Sensitive diagnosis', 'Private findings', 'Health', 'report-1', report.id, fileIds[1]]) expect({ secret, kept: stored.includes(String(secret)) }).toEqual({ secret, kept: false });
      await expect(remove(admin)).rejects.toThrow(LinkNotFoundError); // it is gone; the note is not repeated
      // The Run itself and everything recorded before are as they were; the removal is one added entry.
      expect(database.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(runA)).toEqual(before.row);
      expect(database.sqlite.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY id').all(runA)).toEqual(before.steps);
      expect(await getRun(work, { actor: gus, workspaceId: home.id, runId: runA })).toEqual(before.run);
      const events = database.sqlite.prepare('SELECT * FROM audit_events WHERE run_id = ? ORDER BY rowid').all(runA) as { type: string }[];
      expect(events.slice(0, before.events.length)).toEqual(before.events);
      expect(events.slice(before.events.length).map((event) => event.type)).toEqual(['RUN_DOCUMENT_REMOVED']);
      // The Document is untouched, and the other Run still keeps its version — byte for byte.
      expect(await linksOf(report.id)).toMatchObject({ runs: [{ runId: runB }] });
      expect((await linksOf(report.id)).runs).toHaveLength(1);
      const [keptB] = (await listRunDocuments(links, { ...ref(gus), runId: runB })).documents;
      expect(keptB).toMatchObject({ title: 'Sensitive diagnosis', notes: 'Private findings' });
      const contents = [];
      for (const file of keptB?.files ?? []) contents.push(sha(await read((await openOriginal(files, { ...ref(gus), fileId: file.id })).stream)));
      expect(contents).toEqual([sha(first), sha(second)]);
      expect((await exportedLinks()).get('Sensitive diagnosis')).toEqual([`run:${runB}`]);
      // Storage: the files are still needed by the other Run — nothing is reclaimed yet.
      expect(await storageOf()).toEqual(before.storage);

      // Removed from the last Run that kept it: the file no Document holds is unreachable at once and no longer counted …
      const noteB = await remove(admin, { runId: runB, runDocumentId: keptB?.id ?? '', reason: 'Not part of this execution' });
      expect(noteB.files).toBe(2);
      await expect(openOriginal(files, { ...ref(admin), fileId: fileIds[1] ?? '' })).rejects.toThrow(DocumentFileNotFoundError);
      const after = await storageOf();
      expect(after.retained).toBe(0);
      expect(after.used).toBeLessThanOrEqual(before.storage.used - second.length);
      // … while page one, which the Document still holds, and the Document itself are exactly as before.
      expect(sha(await read((await openOriginal(files, { ...ref(gus), fileId: fileIds[0] ?? '' })).stream))).toBe(sha(first));
      expect(await getDocument(docs, { ...ref(gus), documentId: report.id })).toMatchObject({ title: 'Sensitive diagnosis', revision: edited.revision, notes: 'Private findings' });
      expect((await linksOf(report.id)).runs).toEqual([]);
      expect((await exportedLinks()).get('Sensitive diagnosis')).toEqual([]);
      // The bytes leave the disk with housekeeping, after the usual grace period.
      expect(await files.store.locate(sha(second))).toBeDefined();
      // (Well past the grace period on the real clock too: the store goes by the file's own time.)
      now = new Date(Date.now() + 2 * DOCUMENT_FILE_PENDING_MS);
      await purgeUnusedDocumentFiles(files);
      expect(await files.store.locate(sha(second))).toBeUndefined();
      expect(await files.store.locate(sha(first))).toBeDefined();
      // The notes are permanent.
      expect((await listRunDocuments(links, { ...ref(gus), runId: runB })).removals.map((each) => each.reason)).toEqual(['Not part of this execution']);
      expect(() => database.sqlite.prepare("UPDATE run_document_removals SET reason = 'rewritten'").run()).toThrow('permanent');
      expect(() => database.sqlite.prepare('DELETE FROM run_document_removals').run()).toThrow('permanent');
    });

    it('needs manage rights and one Workspace, and reveals nothing to others', async () => {
      const report = await document('Report');
      const theirs = await document('Payroll', 1, otto, office);
      const runId = await finishedRun();
      const theirRun = await finishedRun(theirProcedure, otto, office);
      await expect(linkRunDocument(links, { ...ref(gus), runId, documentId: report.id })).rejects.toThrow(NotAuthorizedError);
      await expect(linkRunDocument(links, { ...ref(otto), runId, documentId: report.id })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(linkRunDocument(links, { ...ref(uma), runId: theirRun, documentId: report.id })).rejects.toThrow(RunNotFoundError);
      await expect(linkRunDocument(links, { ...ref(uma), runId, documentId: theirs.id })).rejects.toThrow(DocumentNotFoundError);
      await expect(linkRunDocument(links, { ...ref(otto, office), runId, documentId: theirs.id })).rejects.toThrow(RunNotFoundError);
      await expect(linkRunDocument(links, { ...ref(otto, office), runId: theirRun, documentId: report.id })).rejects.toThrow(DocumentNotFoundError);
      const trashed = await document('Thrown away');
      await deleteDocument(docs, { ...ref(uma), documentId: trashed.id });
      await expect(linkRunDocument(links, { ...ref(uma), runId, documentId: trashed.id })).rejects.toThrow(DocumentNotFoundError);
      expect(rows('run_documents')).toBe(0);

      const kept = await linkRunDocument(links, { ...ref(uma), runId, documentId: report.id });
      await expect(listRunDocuments(links, { ...ref(otto), runId })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(listRunDocuments(links, { ...ref(otto, office), runId })).rejects.toThrow(RunNotFoundError);
      await expect(unlinkRunDocument(links, { ...ref(otto, office), runId: theirRun, runDocumentId: kept.id })).rejects.toThrow(LinkNotFoundError);
      // The files of a retained version are served like any file: to members of the Workspace only.
      await expect(openOriginal(files, { ...ref(otto, office), fileId: kept.files[0]?.id ?? '' })).rejects.toThrow();
      expect((await openOriginal(files, { ...ref(gus), fileId: kept.files[0]?.id ?? '' })).bytes).toBeGreaterThan(0);
      // The database refuses a version for a Run of another Workspace.
      expect(() =>
        database.sqlite
          .prepare("INSERT INTO run_documents (id, workspace_id, run_id, source_document_id, source_revision, title, linked_by_user_id, linked_by_display_name, linked_at) VALUES (?, ?, ?, ?, 1, 'x', ?, 'Uma', 1)")
          .run(crypto.randomUUID(), home.id, theirRun, report.id, uma.id),
      ).toThrow('its own workspace');
    });
  });

  it('names relationships in an export — Procedures, Reminders, related Documents and Runs — and nothing that is gone', async () => {
    const bill = await document('Water bill');
    const receipt = await document('Receipt');
    const hidden = await document('Thrown away');
    const pay = await reminder();
    await link(bill.id, 'schedule', pay.id);
    await link(bill.id, 'procedure', boiler);
    await link(bill.id, 'document', receipt.id);
    await link(bill.id, 'document', hidden.id);
    const runId = await finishedRun();
    await linkRunDocument(links, { ...ref(uma), runId, documentId: bill.id });
    await deleteDocument(docs, { ...ref(uma), documentId: hidden.id });
    let archive: DocumentExport | undefined;
    await exportDocuments(docs, { ...ref(gus), request: {} }, async (given) => {
      archive = given;
    });
    const byTitle = new Map((archive?.documents ?? []).map((each) => [each.title, each.links.map((related) => `${related.type}:${related.title}`).sort()]));
    expect(byTitle.get('Water bill')).toEqual(['document:Receipt', 'procedure:Boiler service', 'reminder:Pay water bill', 'run:Boiler service']);
    expect(byTitle.get('Receipt')).toEqual(['document:Water bill']);
    expect(JSON.stringify(archive)).not.toContain('Thrown away');
  });
});

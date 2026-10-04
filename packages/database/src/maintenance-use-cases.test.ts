import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadyLinkedError,
  ContactNotFoundError,
  InvalidCursorError,
  LinkNotFoundError,
  LinkTargetNotFoundError,
  MaintenanceConflictError,
  MaintenanceRecordNotFoundError,
  MaintenanceStatusUnchangedError,
  NotAuthorizedError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  abortRun,
  addDocumentLink,
  addMaintenanceLink,
  addMember,
  changeMemberRole,
  changeStepState,
  completeRun,
  createContact,
  createDocument,
  createMaintenanceRecord,
  createPreviewQueue,
  createProcedure,
  createSchedule,
  createWorkspace,
  deleteContact,
  deleteDocument,
  deleteMaintenanceRecord,
  findMaintenance,
  getMaintenanceRecord,
  getRun,
  listDocumentLinks,
  listMaintenanceLinks,
  listMaintenanceTrash,
  maintenanceBoard,
  maintenanceFilterValues,
  purgeContactTrash,
  purgeMaintenanceTrash,
  removeDocumentLink,
  removeMaintenanceLink,
  restoreMaintenanceRecord,
  setMaintenanceStatus,
  setWorkspaceTool,
  startRun,
  unlinkContactProcedure,
  updateMaintenanceRecord,
  uploadDocumentFile,
  type ContactDeps,
  type DocumentExportDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type LinkDeps,
  type MaintenanceDeps,
  type ProcedureInput,
  type RunDeps,
  type ScheduleDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, MAINTENANCE_STATUSES, normalizeEmail, type MaintenanceInput, type ProcedureId, type RunId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { createContactRepository } from './contact-repository.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createLinkRepository } from './link-repository.ts';
import { createMaintenanceRepository } from './maintenance-repository.ts';
import { createNotificationPreferencesRepository } from './notification-preferences-repository.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createScheduleRepository } from './schedule-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async () => ({ jpeg: new Uint8Array(100), width: 1800, height: 2400 }),
  thumbnail: async () => ({ jpeg: new Uint8Array(20), width: 300, height: 400 }),
};
const PROCEDURE: ProcedureInput = {
  title: 'Boiler service',
  description: '',
  icon: 'home',
  tags: [],
  sections: [{ title: 'All', description: '', steps: [{ title: 'Check pressure', description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' }] }],
};
const TOOLS = ['MAINTENANCE', 'CONTACTS', 'DOCUMENTS'];

describe('Maintenance (16.7)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let serial = 0;
  let deps: MaintenanceDeps;
  let contactDeps: ContactDeps;
  let links: LinkDeps;
  let docs: DocumentExportDeps;
  let files: DocumentFileDeps;
  let work: ScheduleDeps & RunDeps;
  let members: { users: ReturnType<typeof createUserRepository>; workspaces: ReturnType<typeof createWorkspaceRepository>; clock: { now: () => Date } };
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
  const add = async (content: MaintenanceInput, actor = uma, workspace = home) => {
    tick();
    return createMaintenanceRecord(deps, { ...ref(actor, workspace), content });
  };
  const setStatus = (recordId: string, status: string, expectedRevision: number, actor = uma, completedOn?: string) => setMaintenanceStatus(deps, { ...ref(actor), recordId, status, expectedRevision, completedOn });
  const titles = async (query: Parameters<typeof findMaintenance>[1]['query'] = {}, actor = gus, workspace = home) => (await findMaintenance(deps, { ...ref(actor, workspace), query })).records.map((record) => record.title);
  const board = async (actor = gus, workspace = home) => Object.fromEntries((await maintenanceBoard(deps, ref(actor, workspace))).map((column) => [column.status, column.records.map((record) => record.title)]));
  const document = async (title: string, actor = uma, workspace = home) => {
    const content = new TextEncoder().encode(`file ${++serial} ${'x'.repeat(200)}`);
    const { file } = await uploadDocumentFile(files, {
      actor,
      workspaceId: workspace.id,
      name: `${title}.jpg`,
      source: (async function* () {
        yield content;
      })(),
    });
    return createDocument(docs, { ...ref(actor, workspace), folderId: null, content: { title }, fileIds: [file.id] });
  };
  const run = async (finish: 'complete' | 'abort' | 'leave', procedureId = boiler, actor = uma, workspace = home) => {
    const started = await startRun(work, { actor, workspaceId: workspace.id, procedureId });
    const runId = started.run.id as RunId;
    if (finish === 'leave') return runId;
    if (finish === 'abort') {
      await abortRun(work, { actor, workspaceId: workspace.id, runId });
      return runId;
    }
    for (const step of started.sections.flatMap((section) => section.steps)) await changeStepState(work, { actor, workspaceId: workspace.id, runId, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
    await completeRun(work, { actor, workspaceId: workspace.id, runId });
    return runId;
  };
  const audit = (type = 'MAINTENANCE%') =>
    (database.sqlite.prepare('SELECT type, actor_display_name AS actor, subject_id AS id, metadata FROM audit_events WHERE type LIKE ? ORDER BY rowid').all(type) as { type: string; actor: string; id: string; metadata: string }[]).map((event) => ({
      ...event,
      metadata: JSON.parse(event.metadata) as Record<string, unknown>,
    }));
  const row = (id: string) => database.sqlite.prepare('SELECT * FROM maintenance_records WHERE id = ?').get(id);
  /** Every table but those Maintenance itself writes: what must stay exactly as it is when a record changes. */
  const everythingElse = () =>
    JSON.stringify(
      (database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('maintenance_records', 'audit_events', 'links') ORDER BY name").all() as { name: string }[]).map((table) => [
        table.name,
        database.sqlite.prepare(`SELECT * FROM "${table.name}"`).all(),
      ]),
    );
  const code = async (attempt: Promise<unknown>) =>
    attempt.then(
      () => undefined,
      (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : (caught as Error).name),
    );

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-maintenance-'));
    now = new Date('2026-10-02T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const tools = createWorkspaceToolRepository(database);
    const fileRepository = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    members = { users, workspaces, clock };
    deps = { workspaces, tools, maintenance: createMaintenanceRepository(database), clock };
    contactDeps = { workspaces, tools, contacts: createContactRepository(database), clock };
    docs = { workspaces, tools, documents: createDocumentRepository(database), store, clock };
    files = { workspaces, tools, files: fileRepository, store, processor, clock, previews: createPreviewQueue({ files: fileRepository, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] }) };
    links = { workspaces, tools, links: createLinkRepository(database), clock };
    work = { workspaces, schedules: createScheduleRepository(database), notificationPreferences: createNotificationPreferencesRepository(database), runs: createRunRepository(database), clock };
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace(members, { actor: admin, name: 'Home' });
    office = await createWorkspace(members, { actor: admin, name: 'Office' });
    await addMember(members, { actor: admin, workspaceId: home.id, email: uma.email, role: 'USER' });
    await addMember(members, { actor: admin, workspaceId: home.id, email: gus.email, role: 'GUEST' });
    await addMember(members, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    for (const tool of TOOLS) {
      await setWorkspaceTool(docs, { ...ref(admin), tool, enabled: true });
      await setWorkspaceTool(docs, { ...ref(otto, office), tool, enabled: true });
    }
    const procedures = { workspaces, procedures: createProcedureRepository(database), clock };
    boiler = (await createProcedure(procedures, { actor: admin, workspaceId: home.id, content: PROCEDURE })).procedure.id as ProcedureId;
    theirProcedure = (await createProcedure(procedures, { actor: otto, workspaceId: office.id, content: { ...PROCEDURE, title: 'Payroll run' } })).procedure.id as ProcedureId;
  });
  afterEach(() => {
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates "Boiler service" as Planned — on the board and in the List — and moves it through the statuses by hand', async () => {
    const created = await add({ title: 'Boiler service', category: 'Heating', date: '2026-11-03' });
    expect(created).toMatchObject({ title: 'Boiler service', category: 'Heating', date: '2026-11-03', status: 'PLANNED', completedOn: null, contact: null, cost: null, revision: 1, createdByName: 'Uma' });
    expect(await board()).toEqual({ PLANNED: ['Boiler service'], IN_PROGRESS: [], COMPLETED: [], CANCELLED: [] });
    expect(await titles()).toEqual(['Boiler service']);
    // In progress: for everyone, guests included.
    tick();
    const started = await setStatus(created.id, 'IN_PROGRESS', 1);
    expect(started).toMatchObject({ status: 'IN_PROGRESS', completedOn: null, revision: 2, updatedByName: 'Uma' });
    expect(await board(gus)).toEqual({ PLANNED: [], IN_PROGRESS: ['Boiler service'], COMPLETED: [], CANCELLED: [] });
    // A form opened before that change does not overwrite it.
    await expect(updateMaintenanceRecord(deps, { ...ref(uma), recordId: created.id, expectedRevision: 1, content: { title: 'Stale form' } })).rejects.toThrow(MaintenanceConflictError);
    expect(await titles()).toEqual(['Boiler service']);
    // Two people move the same card at once: one succeeds, the other is told and nothing is overwritten.
    const [first, second] = await Promise.allSettled([setStatus(created.id, 'COMPLETED', 2, uma), setStatus(created.id, 'CANCELLED', 2, admin)]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(second.status === 'rejected' ? second.reason : first.status === 'rejected' ? first.reason : null).toBeInstanceOf(MaintenanceConflictError);
    const after = await getMaintenanceRecord(deps, { ...ref(gus), recordId: created.id });
    expect(after.revision).toBe(3);
    expect(['COMPLETED', 'CANCELLED']).toContain(after.status);
    // Completed shows its completion date — today unless the person says when; Cancelled never has one.
    if (after.status === 'CANCELLED') await setStatus(created.id, 'COMPLETED', 3);
    else {
      await setStatus(created.id, 'CANCELLED', 3);
      expect(await getMaintenanceRecord(deps, { ...ref(gus), recordId: created.id })).toMatchObject({ status: 'CANCELLED', completedOn: null });
      await setStatus(created.id, 'COMPLETED', 4);
    }
    const done = await getMaintenanceRecord(deps, { ...ref(gus), recordId: created.id });
    expect(done).toMatchObject({ status: 'COMPLETED', completedOn: now.toISOString().slice(0, 10) });
    // Reopened and completed again with the day the work was really done.
    const reopened = await setStatus(created.id, 'IN_PROGRESS', done.revision);
    expect(reopened).toMatchObject({ status: 'IN_PROGRESS', completedOn: null });
    expect(await setStatus(created.id, 'COMPLETED', reopened.revision, uma, '2026-09-28')).toMatchObject({ status: 'COMPLETED', completedOn: '2026-09-28' });
    // Refusals: the status it already has, an unknown status, a date that is none, a stale revision.
    await expect(setStatus(created.id, 'COMPLETED', reopened.revision + 1)).rejects.toThrow(MaintenanceStatusUnchangedError);
    expect(await code(setStatus(created.id, 'DONE', reopened.revision + 1))).toBe('invalid_maintenance_status');
    expect(await code(setStatus(created.id, 'PLANNED', reopened.revision + 1, uma, '2026-13-01'))).toBe('invalid_document_date');
    await expect(setStatus(created.id, 'PLANNED', 1)).rejects.toThrow(MaintenanceConflictError);
    // Whatever writes the row: Completed has a completion date and nothing else has one.
    expect(() => database.sqlite.prepare("UPDATE maintenance_records SET status = 'COMPLETED', completed_on = NULL WHERE id = ?").run(created.id)).toThrow('maintenance_records_completion_consistent');
    expect(() => database.sqlite.prepare("UPDATE maintenance_records SET status = 'CANCELLED' WHERE id = ?").run(created.id)).toThrow('maintenance_records_completion_consistent');
    expect(() => database.sqlite.prepare("UPDATE maintenance_records SET status = 'ON_HOLD', completed_on = NULL WHERE id = ?").run(created.id)).toThrow('maintenance_records_status_valid');
    // History: every change, who made it, from what to what.
    const changes = audit('MAINTENANCE_STATUS_CHANGED').map((event) => `${event.metadata.from}>${event.metadata.to}`);
    expect(changes[0]).toBe('PLANNED>IN_PROGRESS');
    expect(changes.at(-1)).toBe('IN_PROGRESS>COMPLETED');
    expect(audit('MAINTENANCE_STATUS_CHANGED').at(-1)).toMatchObject({ actor: 'Uma', id: created.id, metadata: { title: 'Boiler service', completedOn: '2026-09-28' } });
  });

  it('keeps a record In progress when its linked Run is completed or aborted — only a person completes maintenance', async () => {
    const record = await add({ title: 'Boiler service' });
    await setStatus(record.id, 'IN_PROGRESS', 1);
    const active = await run('leave');
    tick();
    const link = await addMaintenanceLink(deps, { ...ref(uma), recordId: record.id, target: { type: 'run', id: active } });
    expect(link.record).toEqual({ type: 'run', id: active, title: 'Boiler service', state: 'ok', runState: 'ACTIVE' });
    const before = row(record.id);
    // The Run is completed …
    const started = await getRun(work, { actor: uma, workspaceId: home.id, runId: active });
    for (const step of started.sections.flatMap((section) => section.steps)) await changeStepState(work, { actor: uma, workspaceId: home.id, runId: active as RunId, stepId: step.id, expectedState: 'PENDING', to: 'DONE' });
    await completeRun(work, { actor: uma, workspaceId: home.id, runId: active as RunId });
    // … the record is exactly as it was: status, completion date, revision, who changed it last.
    expect(row(record.id)).toEqual(before);
    expect((await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).map((each) => each.record)).toEqual([{ type: 'run', id: active, title: 'Boiler service', state: 'ok', runState: 'COMPLETED' }]);
    // Linking a Run that is already finished, or one that gets aborted, changes nothing either.
    await addMaintenanceLink(deps, { ...ref(uma), recordId: record.id, target: { type: 'run', id: await run('complete') } });
    const aborted = await run('leave');
    await addMaintenanceLink(deps, { ...ref(uma), recordId: record.id, target: { type: 'run', id: aborted } });
    await abortRun(work, { actor: uma, workspaceId: home.id, runId: aborted });
    expect(row(record.id)).toEqual(before);
    expect(audit('MAINTENANCE_STATUS_CHANGED')).toHaveLength(1);
    // A person sets Completed: then, and only then, it is.
    expect(await setStatus(record.id, 'COMPLETED', 2)).toMatchObject({ status: 'COMPLETED', completedOn: now.toISOString().slice(0, 10) });
  });

  it('touches no Run, Occurrence, Schedule or reminder when a record is created, changed, completed, deleted or restored', async () => {
    const runId = await run('leave');
    const reminder = await createSchedule(work, { actor: uma, workspaceId: home.id, title: 'Service the boiler', date: '2026-11-03', timeZone: 'Europe/Berlin', reminders: [{ unit: 'DAYS', amount: 1 }] });
    const scheduled = await createSchedule(work, { actor: uma, workspaceId: home.id, procedureId: boiler, date: '2026-11-04', timeZone: 'Europe/Berlin', reminders: [] });
    const before = everythingElse();
    const record = await add({ title: 'Boiler service', date: '2026-11-03', cost: { amount: '120.00', currency: 'EUR' } });
    for (const target of [{ type: 'run', id: runId }, { type: 'schedule', id: reminder.id }, { type: 'schedule', id: scheduled.id }, { type: 'procedure', id: boiler }]) await addMaintenanceLink(deps, { ...ref(uma), recordId: record.id, target });
    let revision = 1;
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'PLANNED', 'CANCELLED', 'COMPLETED']) revision = (await setStatus(record.id, status, revision)).revision;
    await updateMaintenanceRecord(deps, { ...ref(uma), recordId: record.id, expectedRevision: revision, content: { title: 'Boiler service 2026' } });
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: record.id });
    await restoreMaintenanceRecord(deps, { ...ref(uma), recordId: record.id });
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: record.id });
    await purgeMaintenanceTrash(deps, { ...ref(admin), recordIds: 'all' });
    // One reminder engine: nothing was scheduled, queued, delivered, started, completed or changed anywhere else.
    expect(everythingElse()).toBe(before);
    expect(await getRun(work, { actor: gus, workspaceId: home.id, runId })).toMatchObject({ run: { state: 'ACTIVE' } });
  });

  it('records the technician as a Contact and a cost as written; filters return exactly the matching records and nothing is summed', async () => {
    const technician = (await createContact(contactDeps, { ...ref(uma), content: { name: 'Idraulico Rossi', phones: [{ value: '0471 123456' }] } })).contact;
    const electrician = (await createContact(contactDeps, { ...ref(uma), content: { name: 'Elettricista Bianchi' } })).contact;
    const theirContact = (await createContact(contactDeps, { ...ref(otto, office), content: { name: 'Payroll office' } })).contact;
    const boilerRecord = await add({ title: 'Boiler service', category: 'Heating', date: '2026-11-03', contactId: technician.id, cost: { amount: '120.00', currency: 'EUR' }, description: 'Annual check' });
    expect(boilerRecord).toMatchObject({ contact: { id: technician.id, name: 'Idraulico Rossi' }, cost: { amount: '120.00', currency: 'EUR' } });
    await add({ title: 'Fuse box', category: 'Electrics', date: '2025-03-10', contactId: electrician.id, cost: { amount: '80.5', currency: 'CHF' } });
    await add({ title: 'Chimney sweep', category: 'heating', date: '2025-12-01' });
    await add({ title: 'Garden 100%_done' });
    await add({ title: 'Payroll audit', date: '2026-11-03' }, otto, office);
    // Newest first, by the day each record is filed under.
    expect(await titles()).toEqual(['Boiler service', 'Garden 100%_done', 'Chimney sweep', 'Fuse box']);
    expect(await titles({ category: 'HEATING' })).toEqual(['Boiler service', 'Chimney sweep']);
    expect(await titles({ year: 2025 })).toEqual(['Chimney sweep', 'Fuse box']);
    expect(await titles({ year: 2026 })).toEqual(['Boiler service', 'Garden 100%_done']);
    expect(await titles({ contact: technician.id })).toEqual(['Boiler service']);
    expect(await titles({ contact: electrician.id, year: 2025 })).toEqual(['Fuse box']);
    expect(await titles({ status: 'PLANNED', category: 'electrics' })).toEqual(['Fuse box']);
    expect(await titles({ status: 'COMPLETED' })).toEqual([]);
    expect(await titles({ q: 'annual' })).toEqual(['Boiler service']); // the description is searched
    expect(await titles({ q: '%' })).toEqual(['Garden 100%_done']); // a wildcard is a character
    expect(await titles({ q: 'payroll' })).toEqual([]); // another Workspace
    expect(await titles({ contact: theirContact.id })).toEqual([]);
    // A completed record is filed under its completion day: the year filter follows.
    const fuse = (await findMaintenance(deps, { ...ref(gus), query: { q: 'fuse' } })).records[0];
    await setStatus(fuse?.id ?? '', 'COMPLETED', 1, uma, '2026-01-15');
    expect(await titles({ year: 2025 })).toEqual(['Chimney sweep']);
    expect(await titles({ status: 'COMPLETED', year: 2026 })).toEqual(['Fuse box']);
    expect(await maintenanceFilterValues(deps, ref(gus))).toEqual({ categories: ['Electrics', 'Heating'], years: [2026, 2025], contacts: [{ id: electrician.id, name: 'Elettricista Bianchi' }, { id: technician.id, name: 'Idraulico Rossi' }] });
    // No answer carries a sum, a total or an average of costs — only each record's own.
    const everything = JSON.stringify([await maintenanceBoard(deps, ref(gus)), await findMaintenance(deps, { ...ref(gus), query: {} }), await maintenanceFilterValues(deps, ref(gus))]);
    for (const sum of ['200.5', '200.50', '"sum"', '"totalCost"', '"costs"']) expect({ sum, found: everything.includes(sum) }).toEqual({ sum, found: false });
    // A cost the domain refuses is not stored; nor is one written past the application.
    expect(await code(updateMaintenanceRecord(deps, { ...ref(uma), recordId: boilerRecord.id, expectedRevision: 1, content: { title: 'x', cost: { amount: '1e3', currency: 'EUR' } } }))).toBe('invalid_cost_amount');
    expect(await code(updateMaintenanceRecord(deps, { ...ref(uma), recordId: boilerRecord.id, expectedRevision: 1, content: { title: 'x', cost: { amount: '5', currency: 'EURO' } } }))).toBe('invalid_cost_currency');
    expect(() => database.sqlite.prepare("UPDATE maintenance_records SET cost_amount = '-5' WHERE id = ?").run(boilerRecord.id)).toThrow('maintenance_records_cost_shape');
    expect(() => database.sqlite.prepare('UPDATE maintenance_records SET cost_currency = NULL WHERE id = ?').run(boilerRecord.id)).toThrow('maintenance_records_cost_consistent');
    // The responsible Contact is one of this Workspace that is there — by the use-case and by the database.
    await expect(createMaintenanceRecord(deps, { ...ref(uma), content: { title: 'x', contactId: theirContact.id } })).rejects.toThrow(ContactNotFoundError);
    await expect(updateMaintenanceRecord(deps, { ...ref(uma), recordId: boilerRecord.id, expectedRevision: 1, content: { title: 'x', contactId: theirContact.id } })).rejects.toThrow(ContactNotFoundError);
    expect(() => database.sqlite.prepare('UPDATE maintenance_records SET contact_id = ? WHERE id = ?').run(theirContact.id, boilerRecord.id)).toThrow('contact of the same workspace');
    // A Contact in Trash or deleted for good is "a deleted contact" on the record — never named — and the record stays.
    await deleteContact(contactDeps, { ...ref(uma), contactId: technician.id });
    expect((await getMaintenanceRecord(deps, { ...ref(gus), recordId: boilerRecord.id })).contact).toEqual({ id: technician.id, name: null });
    await expect(createMaintenanceRecord(deps, { ...ref(uma), content: { title: 'x', contactId: technician.id } })).rejects.toThrow(ContactNotFoundError);
    // Editing the record keeps the Contact that is already set, even while it is in Trash.
    expect((await updateMaintenanceRecord(deps, { ...ref(uma), recordId: boilerRecord.id, expectedRevision: 1, content: { title: 'Boiler service', contactId: technician.id } })).contact).toEqual({ id: technician.id, name: null });
    await purgeContactTrash(contactDeps, { ...ref(admin), contactIds: 'all' });
    expect((await getMaintenanceRecord(deps, { ...ref(gus), recordId: boilerRecord.id })).contact).toEqual({ id: technician.id, name: null });
    expect((await maintenanceFilterValues(deps, ref(gus))).contacts).toEqual([{ id: electrician.id, name: 'Elettricista Bianchi' }]);
    expect(JSON.stringify(audit())).not.toMatch(/Rossi|120\.00|Annual check/); // history: titles and statuses only
    // With Contacts switched off, nothing of them appears with Maintenance — and who is responsible is not lost.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: false });
    const fuseRecord = await getMaintenanceRecord(deps, { ...ref(gus), recordId: fuse?.id ?? '' });
    expect(fuseRecord.contact).toBeNull();
    expect((await maintenanceFilterValues(deps, ref(gus))).contacts).toEqual([]);
    await expect(findMaintenance(deps, { ...ref(gus), query: { contact: electrician.id } })).rejects.toThrow(ToolNotEnabledError);
    await updateMaintenanceRecord(deps, { ...ref(uma), recordId: fuseRecord.id, expectedRevision: fuseRecord.revision, content: { title: 'Fuse box', contactId: null } });
    expect((await createMaintenanceRecord(deps, { ...ref(uma), content: { title: 'Without contacts', contactId: electrician.id } })).contact).toBeNull();
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: true });
    expect((await getMaintenanceRecord(deps, { ...ref(gus), recordId: fuseRecord.id })).contact).toEqual({ id: electrician.id, name: 'Elettricista Bianchi' });
    expect((await findMaintenance(deps, { ...ref(gus), query: { q: 'without' } })).records[0]?.contact).toBeNull();
  });

  it('pages the List fifty at a time and bounds every column of the board', async () => {
    const insert = database.sqlite.prepare(
      "INSERT INTO maintenance_records (id, workspace_id, title, status, completed_on, sort_date, search_text, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'bulk', ?, 'Ada', 1, ?, 'Ada', 1)",
    );
    for (let n = 0; n < 120; n++) {
      const id = `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
      const date = `2025-${String(1 + (n % 12)).padStart(2, '0')}-10`;
      insert.run(id, home.id, `Bulk ${String(n).padStart(3, '0')}`, n < 70 ? 'COMPLETED' : 'PLANNED', n < 70 ? date : null, date, admin.id, admin.id);
    }
    const first = await findMaintenance(deps, { ...ref(gus), query: {} });
    expect(first).toMatchObject({ total: 120 });
    expect(first.records).toHaveLength(50);
    const second = await findMaintenance(deps, { ...ref(gus), query: {}, cursor: [first.next?.value, first.next?.id] });
    const third = await findMaintenance(deps, { ...ref(gus), query: {}, cursor: [second.next?.value, second.next?.id] });
    expect(third).toMatchObject({ next: null, total: null });
    const all = [...first.records, ...second.records, ...third.records];
    expect(new Set(all.map((record) => record.id)).size).toBe(120);
    // Newest first throughout.
    const days = all.map((record) => record.completedOn ?? record.date ?? '');
    expect(all.map((record) => record.title)).toHaveLength(120);
    expect(days.filter((value) => value !== '')).toEqual([...days.filter((value) => value !== '')].sort().reverse());
    await expect(findMaintenance(deps, { ...ref(gus), query: {}, cursor: 'nonsense' })).rejects.toThrow(InvalidCursorError);
    // The board shows at most fifty cards a column and says how many there are.
    const columns = await maintenanceBoard(deps, ref(gus));
    expect(columns.map((column) => [column.status, column.records.length, column.total])).toEqual([
      ['PLANNED', 50, 50],
      ['IN_PROGRESS', 0, 0],
      ['COMPLETED', 50, 70],
      ['CANCELLED', 0, 0],
    ]);
  });

  it('lets a GUEST see everything — costs included — and change nothing; keeps Workspaces apart; and does not exist where it is switched off', async () => {
    const record = await add({ title: 'Boiler service', cost: { amount: '120.00', currency: 'EUR' } });
    const theirs = await add({ title: 'Payroll audit' }, otto, office);
    const trashed = await add({ title: 'In Trash' });
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: trashed.id });
    const content = { title: 'Changed' };
    const fakeLink = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    type Call = (actor: User, workspace?: Workspace, recordId?: string) => Promise<unknown>;
    const writes: [string, Call][] = [
      ['create', (actor, workspace) => createMaintenanceRecord(deps, { ...ref(actor, workspace), content })],
      ['update', (actor, workspace, recordId = record.id) => updateMaintenanceRecord(deps, { ...ref(actor, workspace), recordId, expectedRevision: 1, content })],
      ['status', (actor, workspace, recordId = record.id) => setMaintenanceStatus(deps, { ...ref(actor, workspace), recordId, status: 'COMPLETED', expectedRevision: 1 })],
      ['delete', (actor, workspace, recordId = record.id) => deleteMaintenanceRecord(deps, { ...ref(actor, workspace), recordId })],
      ['restore', (actor, workspace, recordId = trashed.id) => restoreMaintenanceRecord(deps, { ...ref(actor, workspace), recordId })],
      ['trash', (actor, workspace) => listMaintenanceTrash(deps, ref(actor, workspace))],
      ['purge', (actor, workspace) => purgeMaintenanceTrash(deps, { ...ref(actor, workspace), recordIds: 'all' })],
      ['link', (actor, workspace, recordId = record.id) => addMaintenanceLink(deps, { ...ref(actor, workspace), recordId, target: { type: 'procedure', id: workspace === office ? theirProcedure : boiler } })],
      ['unlink', (actor, workspace) => removeMaintenanceLink(deps, { ...ref(actor, workspace), linkId: fakeLink })],
    ];
    const reads: [string, Call][] = [
      ['board', (actor, workspace) => maintenanceBoard(deps, ref(actor, workspace))],
      ['list', (actor, workspace) => findMaintenance(deps, { ...ref(actor, workspace), query: {} })],
      ['filters', (actor, workspace) => maintenanceFilterValues(deps, ref(actor, workspace))],
      ['get', (actor, workspace, recordId = record.id) => getMaintenanceRecord(deps, { ...ref(actor, workspace), recordId })],
      ['links', (actor, workspace, recordId = record.id) => listMaintenanceLinks(deps, { ...ref(actor, workspace), recordId })],
    ];
    // A guest: every read — the cost as well (P3, decided 2026-10-02) — and no write.
    for (const [name, call] of reads) expect({ name, refused: await code(call(gus)) }).toEqual({ name, refused: undefined });
    expect((await getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).cost).toEqual({ amount: '120.00', currency: 'EUR' });
    for (const [name, call] of writes) expect({ name, refused: await code(call(gus)) }).toEqual({ name, refused: 'NotAuthorizedError' });
    // A USER does everything but delete for good.
    expect(await code(purgeMaintenanceTrash(deps, { ...ref(uma), recordIds: 'all' }))).toBe('NotAuthorizedError');
    // Someone who is not a member learns nothing.
    for (const [name, call] of [...reads, ...writes]) expect({ name, refused: await code(call(otto)) }).toEqual({ name, refused: 'WorkspaceNotFoundError' });
    // A record of one Workspace asked for under the other does not exist.
    for (const [name, call] of [...reads, ...writes].filter(([each]) => ['get', 'links', 'update', 'status', 'delete', 'restore', 'link'].includes(each))) {
      expect({ name, refused: await code(call(otto, office, name === 'restore' ? trashed.id : record.id)) }).toEqual({ name, refused: 'MaintenanceRecordNotFoundError' });
      expect({ name, refused: await code(call(admin, home, theirs.id)) }).toEqual({ name, refused: 'MaintenanceRecordNotFoundError' });
    }
    await expect(purgeMaintenanceTrash(deps, { ...ref(otto, office), recordIds: [trashed.id] })).rejects.toThrow(MaintenanceRecordNotFoundError);
    expect(await board(otto, office)).toEqual({ PLANNED: ['Payroll audit'], IN_PROGRESS: [], COMPLETED: [], CANCELLED: [] });
    // Nothing changed by any of that.
    expect(await getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).toMatchObject({ title: 'Boiler service', status: 'PLANNED', revision: 1 });
    expect(await listMaintenanceTrash(deps, ref(uma))).toHaveLength(1);
    // A role lost between the check and the write changes nothing.
    const ana = await members.users.create({ email: normalizeEmail('ana@example.org'), displayName: 'Ana', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    await addMember(members, { actor: admin, workspaceId: home.id, email: ana.email, role: 'ADMIN' });
    const demoting = (to: 'GUEST' | 'USER'): MaintenanceDeps => ({
      ...deps,
      maintenance: new Proxy(deps.maintenance, {
        get: (target, property) =>
          typeof property === 'string' && ['create', 'update', 'setStatus', 'delete', 'restore', 'purge', 'addLink', 'removeLink'].includes(property)
            ? async (...args: unknown[]) => {
                await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: to });
                return (target[property as keyof typeof target] as (...given: unknown[]) => unknown)(...args);
              }
            : target[property as keyof typeof target],
      }),
    });
    for (const [name, attempt] of [
      ['create', (given: MaintenanceDeps) => createMaintenanceRecord(given, { ...ref(ana), content })],
      ['update', (given: MaintenanceDeps) => updateMaintenanceRecord(given, { ...ref(ana), recordId: record.id, expectedRevision: 1, content })],
      ['status', (given: MaintenanceDeps) => setMaintenanceStatus(given, { ...ref(ana), recordId: record.id, status: 'COMPLETED', expectedRevision: 1 })],
      ['delete', (given: MaintenanceDeps) => deleteMaintenanceRecord(given, { ...ref(ana), recordId: record.id })],
      ['restore', (given: MaintenanceDeps) => restoreMaintenanceRecord(given, { ...ref(ana), recordId: trashed.id })],
      ['link', (given: MaintenanceDeps) => addMaintenanceLink(given, { ...ref(ana), recordId: record.id, target: { type: 'procedure', id: boiler } })],
    ] as const) {
      await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'ADMIN' });
      expect({ name, refused: await code(attempt(demoting('GUEST'))) }).toEqual({ name, refused: 'NotAuthorizedError' });
    }
    await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'ADMIN' });
    await expect(purgeMaintenanceTrash(demoting('USER'), { ...ref(ana), recordIds: 'all' })).rejects.toThrow(NotAuthorizedError);
    expect(await getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).toMatchObject({ title: 'Boiler service', status: 'PLANNED', revision: 1 });
    expect(await listMaintenanceTrash(deps, ref(uma))).toHaveLength(1);
    // Being able to read Documents and Contacts grants nothing here: switched off, Maintenance is unknown to every role.
    const count = (database.sqlite.prepare('SELECT count(*) AS n FROM maintenance_records').get() as { n: number }).n;
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: false });
    for (const actor of [admin, uma, gus]) for (const [name, call] of [...reads, ...writes]) expect({ name, actor: actor.displayName, refused: await code(call(actor)) }).toEqual({ name, actor: actor.displayName, refused: 'ToolNotEnabledError' });
    await expect(maintenanceBoard(deps, ref(otto))).rejects.toThrow(WorkspaceNotFoundError);
    expect((database.sqlite.prepare('SELECT count(*) AS n FROM maintenance_records').get() as { n: number }).n).toBe(count);
    // … also when it is switched off between the check and the write.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: true });
    const switching: MaintenanceDeps = { ...deps, maintenance: { ...deps.maintenance, setStatus: async (...args) => (await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: false }), deps.maintenance.setStatus(...args)) } };
    await expect(setMaintenanceStatus(switching, { ...ref(uma), recordId: record.id, status: 'COMPLETED', expectedRevision: 1 })).rejects.toThrow(ToolNotEnabledError);
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: true });
    expect(await getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).toMatchObject({ status: 'PLANNED', revision: 1 });
  });

  it('moves a record to Trash, restores it, and lets only a Workspace admin delete it for good', async () => {
    const record = await add({ title: 'Boiler service', date: '2026-11-03' });
    const stays = await add({ title: 'Stays' });
    await setStatus(record.id, 'COMPLETED', 1, uma, '2026-10-01');
    const bill = await document('Invoice');
    await addMaintenanceLink(deps, { ...ref(uma), recordId: record.id, target: { type: 'document', id: bill.id } });
    const deletedAt = tick();
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: record.id });
    expect(await titles()).toEqual(['Stays']);
    expect(await board()).toMatchObject({ COMPLETED: [] });
    await expect(getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).rejects.toThrow(MaintenanceRecordNotFoundError);
    await expect(setStatus(record.id, 'PLANNED', 3)).rejects.toThrow(MaintenanceRecordNotFoundError);
    expect(await listMaintenanceTrash(deps, ref(uma))).toEqual([{ id: record.id, title: 'Boiler service', status: 'COMPLETED', deletedAt, deletedByName: 'Uma' }]);
    // On the Document it was evidence for: that a record in Trash is linked — not which one.
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: bill.id })).links.map((link) => link.record)).toEqual([{ type: 'maintenance', id: record.id, title: null, state: 'trash' }]);
    // Restored as it was: status, completion date, links.
    expect(await restoreMaintenanceRecord(deps, { ...ref(uma), recordId: record.id })).toMatchObject({ title: 'Boiler service', status: 'COMPLETED', completedOn: '2026-10-01' });
    expect(await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).toHaveLength(1);
    await expect(restoreMaintenanceRecord(deps, { ...ref(uma), recordId: record.id })).rejects.toThrow(MaintenanceRecordNotFoundError);
    // Permanent deletion: only from Trash, only by a Workspace admin.
    await expect(purgeMaintenanceTrash(deps, { ...ref(admin), recordIds: [record.id] })).rejects.toThrow(MaintenanceRecordNotFoundError);
    expect(() => database.sqlite.prepare('DELETE FROM maintenance_records WHERE id = ?').run(stays.id)).toThrow('only from trash');
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: record.id });
    expect(() => database.sqlite.prepare('DELETE FROM maintenance_records WHERE id = ?').run(record.id)).toThrow('links of the maintenance record must be marked first');
    await expect(purgeMaintenanceTrash(deps, { ...ref(uma), recordIds: [record.id] })).rejects.toThrow(NotAuthorizedError);
    await expect(purgeMaintenanceTrash(deps, { ...ref(admin), recordIds: [record.id, stays.id] })).rejects.toThrow(MaintenanceRecordNotFoundError);
    expect(await code(purgeMaintenanceTrash(deps, { ...ref(admin), recordIds: [] }))).toBe('invalid_trash_selection');
    expect(await listMaintenanceTrash(deps, ref(uma))).toHaveLength(1);
    const purgedAt = tick();
    expect(await purgeMaintenanceTrash(deps, { ...ref(admin), recordIds: [record.id] })).toBe(1);
    expect(await listMaintenanceTrash(deps, ref(uma))).toEqual([]);
    expect(row(record.id)).toBeUndefined();
    // The Document stays, and says that something linked to it was deleted — when and by whom.
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: bill.id })).links.map((link) => link.record)).toEqual([{ type: 'maintenance', id: record.id, title: null, state: 'gone', goneAt: purgedAt, goneByName: 'Ada' }]);
    expect(audit('MAINTENANCE_PURGED')).toEqual([{ type: 'MAINTENANCE_PURGED', actor: 'Ada', id: record.id, metadata: { title: 'Boiler service' } }]);
    // Nothing leaves Trash by itself.
    const old = await add({ title: 'Old' });
    await deleteMaintenanceRecord(deps, { ...ref(uma), recordId: old.id });
    now = new Date(now.getTime() + 400 * 24 * 3600 * 1000);
    expect(await listMaintenanceTrash(deps, ref(uma))).toHaveLength(1);
  });

  it('links evidence, Procedures, Runs and Reminders as references that reveal nothing and grant nothing', async () => {
    const record = await add({ title: 'Boiler service' });
    const invoice = await document('Invoice 2026');
    const theirDocument = await document('Payslip', otto, office);
    const theirRecord = await add({ title: 'Payroll audit' }, otto, office);
    const reminder = await createSchedule(work, { actor: uma, workspaceId: home.id, title: 'Service the boiler', date: '2026-11-03', timeZone: 'Europe/Berlin', reminders: [] });
    const runId = await run('complete');
    const theirRun = await run('complete', theirProcedure, otto, office);
    const link = (target: { type: string; id: string }, actor = uma, workspace = home, recordId = record.id) => {
      tick();
      return addMaintenanceLink(deps, { ...ref(actor, workspace), recordId, target });
    };
    const evidence = await link({ type: 'document', id: invoice.id });
    expect(evidence).toMatchObject({ record: { type: 'document', id: invoice.id, title: 'Invoice 2026', state: 'ok' }, createdByName: 'Uma' });
    await link({ type: 'procedure', id: boiler });
    await link({ type: 'run', id: runId });
    await link({ type: 'schedule', id: reminder.id });
    expect((await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).map((each) => `${each.record.type}: ${each.record.title}`)).toEqual(['document: Invoice 2026', 'procedure: Boiler service', 'run: Boiler service', 'schedule: Service the boiler']);
    // From the Document's side: the record it is evidence for.
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: invoice.id })).links.map((each) => each.record)).toEqual([{ type: 'maintenance', id: record.id, title: 'Boiler service', state: 'ok' }]);
    await expect(link({ type: 'document', id: invoice.id })).rejects.toThrow(AlreadyLinkedError);
    // Never across Workspaces — by the use-case and by the database.
    for (const target of [{ type: 'document', id: theirDocument.id }, { type: 'procedure', id: theirProcedure }, { type: 'run', id: theirRun }]) await expect(link(target)).rejects.toThrow(LinkTargetNotFoundError);
    await expect(link({ type: 'procedure', id: theirProcedure }, otto, office, record.id)).rejects.toThrow(MaintenanceRecordNotFoundError);
    await expect(removeMaintenanceLink(deps, { ...ref(otto, office), linkId: evidence.id })).rejects.toThrow(LinkNotFoundError);
    const insert = (fromId: string, toType: string, toId: string) =>
      database.sqlite.prepare("INSERT INTO links (id, workspace_id, from_type, from_id, to_type, to_id, created_by_user_id, created_by_display_name, created_at) VALUES (lower(hex(randomblob(18))), ?, 'maintenance', ?, ?, ?, ?, 'A', 1)").run(home.id, fromId, toType, toId, admin.id);
    for (const [fromId, toType, toId] of [
      [record.id, 'document', theirDocument.id],
      [record.id, 'run', theirRun],
      [record.id, 'procedure', theirProcedure],
      [theirRecord.id, 'procedure', boiler],
      [record.id, 'contact', boiler],
      [record.id, 'maintenance', record.id],
    ]) {
      expect(() => insert(fromId ?? '', toType ?? '', toId ?? '')).toThrow('its own workspace');
    }
    expect(await code(link({ type: 'contact', id: boiler }))).toBe('invalid_link_target');
    // Each tool removes its own Links.
    const documentsOwn = await addDocumentLink(links, { ...ref(uma), documentId: invoice.id, target: { type: 'procedure', id: boiler } });
    await expect(removeMaintenanceLink(deps, { ...ref(uma), linkId: documentsOwn.id })).rejects.toThrow(LinkNotFoundError);
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: invoice.id })).links).toHaveLength(2);
    await removeDocumentLink(links, { ...ref(uma), linkId: documentsOwn.id });
    await expect(removeDocumentLink(links, { ...ref(uma), linkId: evidence.id })).rejects.toThrow(LinkNotFoundError);
    await expect(unlinkContactProcedure(contactDeps, { ...ref(uma), linkId: evidence.id })).rejects.toThrow(LinkNotFoundError);
    // A Link never reveals a record the viewer cannot read: with Documents off, the evidence is not listed and cannot be added.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
    expect((await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).map((each) => each.record.type)).toEqual(['procedure', 'run', 'schedule']);
    const second = await document('Second', otto, office);
    await expect(link({ type: 'document', id: second.id })).rejects.toThrow(ToolNotEnabledError);
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
    // … and with Maintenance off, the Document shows nothing of it.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: false });
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: invoice.id })).links).toEqual([]);
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'MAINTENANCE', enabled: true });
    // A Document moved to Trash: unnamed for a guest (who cannot open Trash); removing the Link removes neither record.
    await deleteDocument(docs, { ...ref(uma), documentId: invoice.id });
    const guestEvidence = (await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).find((each) => each.id === evidence.id);
    expect(guestEvidence?.record).toMatchObject({ type: 'document', state: 'trash', title: null, goneByName: null });
    expect((await listMaintenanceLinks(deps, { ...ref(admin), recordId: record.id })).find((each) => each.id === evidence.id)?.record.title).toBe(invoice.title);
    await expect(link({ type: 'document', id: invoice.id }, uma, home, (await add({ title: 'Other' })).id)).rejects.toThrow(LinkTargetNotFoundError);
    tick();
    await removeMaintenanceLink(deps, { ...ref(uma), linkId: evidence.id });
    expect(await listMaintenanceLinks(deps, { ...ref(gus), recordId: record.id })).toHaveLength(3);
    expect(audit('MAINTENANCE_LINK_REMOVED')).toMatchObject([{ actor: 'Uma', id: record.id, metadata: { linkedType: 'document', linkedId: invoice.id } }]);
    expect(MAINTENANCE_STATUSES).toContain((await getMaintenanceRecord(deps, { ...ref(gus), recordId: record.id })).status);
  });
});

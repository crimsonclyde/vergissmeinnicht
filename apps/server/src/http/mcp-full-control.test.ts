import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { connectAssistant, enableTools, inDays } from './mcp-test-client.ts';
import { ORIGIN, startTestApp } from './test-harness.ts';

/** 48.4: AI assistants reach Home, Contacts, Documents, Reminders, Procedures and Runs — as the person, within scopes and tools. */
describe('MCP full control', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => {
    await t?.close();
  });

  it('manages Equipment and Maintenance under the Home scopes, with Trash as the undo', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enableTools(t, workspaceId, ['EQUIPMENT', 'MAINTENANCE']);
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'home.read', 'home.write']);
    const tools = await assistant.tools();
    expect(tools.find((tool) => tool.name === 'delete_equipment')?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(tools.map((tool) => tool.name)).not.toContain('search_contacts');

    const { equipment: boiler } = await assistant.body('create_equipment', { workspaceId, name: 'Boiler', manufacturer: 'Vaillant', purchaseDate: '2020-05-01' });
    expect(boiler).toMatchObject({ name: 'Boiler', manufacturer: 'Vaillant', revision: 1 });
    expect((await assistant.body('search_equipment', { workspaceId, query: 'boil' })).equipment.map((item: { id: string }) => item.id)).toEqual([boiler.id]);
    const updated = await assistant.body('update_equipment', { workspaceId, equipmentId: boiler.id, expectedRevision: 1, location: 'Basement' });
    expect(updated.equipment).toMatchObject({ name: 'Boiler', manufacturer: 'Vaillant', location: 'Basement', purchaseDate: '2020-05-01', revision: 2 });
    expect(await assistant.error('update_equipment', { workspaceId, equipmentId: boiler.id, expectedRevision: 1, location: 'Attic' })).toMatchObject({ code: 'stale_revision' });

    const { record } = await assistant.body('create_maintenance', { workspaceId, title: 'Annual service', date: inDays(-2), cost: { amount: '120.50', currency: 'eur' }, equipmentId: boiler.id });
    expect(record).toMatchObject({ title: 'Annual service', status: 'PLANNED', cost: { amount: '120.50', currency: 'EUR' } });
    expect((await assistant.body('get_maintenance', { workspaceId, recordId: record.id })).links).toEqual([expect.objectContaining({ record: expect.objectContaining({ title: 'Boiler' }) })]);
    const done = await assistant.body('set_maintenance_status', { workspaceId, recordId: record.id, expectedRevision: record.revision, status: 'COMPLETED', completedOn: inDays(-1) });
    expect(done.record).toMatchObject({ status: 'COMPLETED', completedOn: inDays(-1) });
    expect((await assistant.body('search_maintenance', { workspaceId, equipmentId: boiler.id })).records).toHaveLength(1);

    await assistant.body('delete_equipment', { workspaceId, equipmentId: boiler.id });
    expect((await assistant.body('search_equipment', { workspaceId })).equipment).toEqual([]);
    expect((await assistant.body('list_deleted_equipment', { workspaceId })).trash).toEqual([expect.objectContaining({ id: boiler.id })]);
    expect((await assistant.body('restore_equipment', { workspaceId, equipmentId: boiler.id })).equipment).toMatchObject({ name: 'Boiler' });

    // The web app sees the assistant's records; one safety backup covered all these changes (48.1).
    const listed = await t.get(`/api/workspaces/${workspaceId}/equipment`, t.admin);
    expect(listed.json().records).toEqual([expect.objectContaining({ name: 'Boiler', location: 'Basement' })]);
    expect(readdirSync(t.paths.aiBackups).filter((name) => name.endsWith('.sqlite'))).toHaveLength(1);
  });

  it('runs with the person’s role: a GUEST’s assistant reads but cannot change, and a switched-off tool refuses', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enableTools(t, workspaceId, ['EQUIPMENT', 'CONTACTS']);
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'home.read', 'home.write', 'contacts.read', 'contacts.write']);
    // Only server admins may connect an assistant; the role in this Workspace still decides what it may do.
    const actorId = (await t.get('/api/auth/session', t.admin)).json().user.id as string;
    t.database.sqlite.prepare("UPDATE memberships SET role='GUEST' WHERE workspace_id=? AND user_id=?").run(workspaceId, actorId);
    expect((await assistant.body('search_equipment', { workspaceId })).equipment).toEqual([]);
    expect(await assistant.error('create_equipment', { workspaceId, name: 'Drill' })).toMatchObject({ code: 'permission_denied' });
    expect(await assistant.error('create_contact', { workspaceId, name: 'Rossi' })).toMatchObject({ code: 'permission_denied' });
    t.database.sqlite.prepare("UPDATE memberships SET role='ADMIN' WHERE workspace_id=? AND user_id=?").run(workspaceId, actorId);
    t.database.sqlite.prepare("UPDATE workspace_tools SET enabled=0 WHERE workspace_id=? AND tool='EQUIPMENT'").run(workspaceId);
    expect(await assistant.error('search_equipment', { workspaceId })).toMatchObject({ code: 'tool_disabled' });
  });

  it('manages Contacts, reporting possible duplicates instead of merging', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enableTools(t, workspaceId, ['CONTACTS']);
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'contacts.read', 'contacts.write']);
    const { contact } = await assistant.body('create_contact', { workspaceId, name: 'Idraulico Rossi', category: 'Plumber', phones: [{ value: '+39 06 1234567', label: 'Office' }] });
    const second = await assistant.body('create_contact', { workspaceId, name: 'Rossi Mario', phones: [{ value: '+39 06 1234567' }] });
    expect(second.possibleDuplicates).toEqual([expect.objectContaining({ id: contact.id, reasons: ['phone'] })]);
    const updated = await assistant.body('update_contact', { workspaceId, contactId: contact.id, expectedRevision: contact.revision, emails: [{ value: 'rossi@example.org' }] });
    expect(updated.contact).toMatchObject({ name: 'Idraulico Rossi', category: 'Plumber', phones: [{ value: '+39 06 1234567', label: 'Office' }], emails: [{ value: 'rossi@example.org', label: '' }] });
    await assistant.body('delete_contact', { workspaceId, contactId: second.contact.id });
    expect((await assistant.body('search_contacts', { workspaceId, query: 'rossi' })).contacts.map((row: { id: string }) => row.id)).toEqual([contact.id]);
    await assistant.body('restore_contact', { workspaceId, contactId: second.contact.id });
    expect((await assistant.body('get_contact', { workspaceId, contactId: contact.id })).possibleDuplicates).toHaveLength(1);
  });

  it('reads and files Documents without ever sending their files', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    await enableTools(t, workspaceId, ['DOCUMENTS']);
    const bytes = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 10, g: 90, b: 160 } } }).jpeg().toBuffer();
    const file = (await t.app.inject({ method: 'POST', url: `/api/workspaces/${workspaceId}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'bill.jpg', origin: ORIGIN, cookie: t.admin }, payload: bytes })).json().file.id as string;
    const created = await t.post(`/api/workspaces/${workspaceId}/documents`, { title: 'Water bill March', folderId: null, fileIds: [file] }, t.admin);
    expect(created.statusCode, created.body).toBe(201);
    const documentId = created.json().document.id as string;

    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'documents.read', 'documents.write']);
    expect((await assistant.body('search_documents', { workspaceId, query: 'water' })).documents).toEqual([expect.objectContaining({ id: documentId, title: 'Water bill March', files: 1 })]);
    const read = await assistant.body('get_document', { workspaceId, documentId, includeText: true });
    expect(read).toMatchObject({ id: documentId, pages: [{ fileId: file, format: expect.any(String) }], texts: [expect.objectContaining({ fileId: file })] });
    expect(JSON.stringify(read)).not.toContain('base64');
    const updated = await assistant.body('update_document', { workspaceId, documentId, expectedRevision: read.revision, type: { builtIn: 'bill' }, tags: ['water'], year: 2026 });
    expect(updated.document).toMatchObject({ title: 'Water bill March', type: { builtIn: 'bill' }, tags: ['water'], year: 2026 });
    const { folder } = await assistant.body('create_document_folder', { workspaceId, name: 'Utilities' });
    expect(await assistant.body('move_documents', { workspaceId, documentIds: [documentId], folderId: folder.id })).toEqual({ outcome: 'MOVED', moved: 1 });
    expect((await assistant.body('list_document_folders', { workspaceId })).folders).toEqual([{ id: folder.id, parentId: null, name: 'Utilities', documents: 1 }]);
    await assistant.body('delete_document', { workspaceId, documentId });
    expect((await assistant.body('list_deleted_documents', { workspaceId })).trash).toEqual([expect.objectContaining({ kind: 'document', id: documentId })]);
    await assistant.body('restore_document', { workspaceId, documentId });
    expect((await assistant.body('search_documents', { workspaceId })).documents).toHaveLength(1);
  });

  it('adds repeating Reminders, ticks a date off, changes, pauses and ends them', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'calendar.read', 'calendar.write']);
    const added = await assistant.body('add_reminder', { workspaceId, reminderId: randomUUID(), title: 'Water the plants', date: inDays(1), time: null, timeZone: 'Europe/Berlin', recurrence: { kind: 'FIXED', unit: 'DAY', interval: 3 } });
    expect(added.reminder).toMatchObject({ recurrence: { kind: 'FIXED', unit: 'DAY', interval: 3 }, state: 'ACTIVE' });
    const calendar = await assistant.body('get_calendar', { workspaceId, from: inDays(0), to: inDays(10) });
    const first = calendar.entries.find((entry: { occurrenceId?: string }) => entry.occurrenceId !== undefined);
    expect(first).toMatchObject({ title: 'Water the plants', date: inDays(1), state: 'OPEN' });
    expect((await assistant.body('complete_reminder', { workspaceId, occurrenceId: first.occurrenceId })).occurrence).toMatchObject({ state: 'COMPLETED' });
    expect((await assistant.body('reopen_reminder', { workspaceId, occurrenceId: first.occurrenceId })).occurrence).toMatchObject({ state: 'OPEN' });
    expect((await assistant.body('move_reminder_date', { workspaceId, occurrenceId: first.occurrenceId, date: inDays(2) })).occurrence).toMatchObject({ date: inDays(2) });

    const [listed] = (await assistant.body('list_reminders', { workspaceId })).reminders;
    const renamed = await assistant.body('update_reminder', { workspaceId, reminderId: listed.id, expectedRevision: listed.revision, title: 'Water the balcony plants' });
    expect(renamed.reminder).toMatchObject({ title: 'Water the balcony plants', recurrence: { kind: 'FIXED', interval: 3 } });
    const paused = await assistant.body('set_reminder_state', { workspaceId, reminderId: listed.id, expectedRevision: renamed.reminder.revision, state: 'PAUSED' });
    expect(paused.reminder.state).toBe('PAUSED');
    const ended = await assistant.body('set_reminder_state', { workspaceId, reminderId: listed.id, expectedRevision: paused.reminder.revision, state: 'ENDED' });
    expect(ended.reminder.state).toBe('ENDED');
    expect((await assistant.body('list_reminders', { workspaceId })).reminders).toEqual([]);
  });

  it('creates, rewrites, schedules, runs and deletes Procedures', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'procedures.read', 'procedures.write', 'runs.read', 'runs.write']);
    const { procedure } = await assistant.body('create_procedure', { workspaceId, title: 'Leaving for holidays', sections: [{ title: 'House', steps: [{ title: 'Close windows', required: true }, { title: 'Water plants' }] }] });
    expect(procedure.sections[0].steps.map((step: { title: string }) => step.title)).toEqual(['Close windows', 'Water plants']);
    const [section] = procedure.sections;
    const saved = await assistant.body('save_procedure', { workspaceId, procedureId: procedure.id, expectedRevision: procedure.revision, sections: [{ id: section.id, title: 'House', steps: [{ id: section.steps[0].id, title: 'Close all windows', required: true }, { title: 'Turn off the water', required: true }] }] });
    expect(saved.procedure.sections[0].steps).toEqual([expect.objectContaining({ id: section.steps[0].id, title: 'Close all windows' }), expect.objectContaining({ title: 'Turn off the water', required: true })]);
    expect((await assistant.body('schedule_procedure', { workspaceId, procedureId: procedure.id, date: inDays(5), timeZone: 'Europe/Berlin', recurrence: { kind: 'FIXED', unit: 'MONTH', interval: 6 } })).schedule).toMatchObject({ kind: 'PROCEDURE', title: 'Leaving for holidays' });

    const { run } = await assistant.body('start_run', { workspaceId, procedureId: procedure.id });
    expect(await assistant.error('complete_run', { workspaceId, runId: run.id })).toMatchObject({ code: expect.any(String) });
    for (const step of run.sections[0].steps) await assistant.body('set_run_step_state', { workspaceId, runId: run.id, stepId: step.id, expectedState: 'PENDING', to: 'DONE', operationId: randomUUID() });
    expect((await assistant.body('complete_run', { workspaceId, runId: run.id })).run).toMatchObject({ state: 'COMPLETED' });
    const second = (await assistant.body('start_run', { workspaceId, procedureId: procedure.id })).run;
    expect((await assistant.body('abort_run', { workspaceId, runId: second.id, reason: 'Trip cancelled' })).run).toMatchObject({ state: 'ABORTED' });
    expect((await assistant.body('list_runs', { workspaceId, state: 'COMPLETED' })).runs.map((item: { id: string }) => item.id)).toEqual([run.id]);

    await assistant.body('delete_procedure', { workspaceId, procedureId: procedure.id });
    expect((await assistant.body('list_procedures', { workspaceId })).procedures).toEqual([]);
    expect((await assistant.body('list_deleted_procedures', { workspaceId })).procedures).toEqual([expect.objectContaining({ id: procedure.id, title: 'Leaving for holidays' })]);
    await assistant.body('restore_procedure', { workspaceId, procedureId: procedure.id });
    expect((await assistant.body('list_procedures', { workspaceId })).procedures).toHaveLength(1);
  });

  it('renames, deletes and restores whole Lists, each kind only through its own scope', async () => {
    t = await startTestApp({ mcpEnabled: true });
    const workspaceId = await t.createWorkspace('Casa Nostra');
    const assistant = await connectAssistant(t, t.admin, [workspaceId], ['workspaces.read', 'lists.read', 'lists.write', 'todos.read', 'todos.write']);
    const listId = randomUUID();
    await assistant.body('create_grocery_list', { workspaceId, listId, operationId: randomUUID(), title: 'Weekend' });
    expect((await assistant.body('rename_grocery_list', { workspaceId, listId, title: 'Saturday market', expectedTitle: 'Weekend' })).list).toMatchObject({ title: 'Saturday market' });
    expect(await assistant.error('delete_todo_list', { workspaceId, listId })).toMatchObject({ code: expect.stringMatching(/permission_denied|not_found/) });
    await assistant.body('delete_grocery_list', { workspaceId, listId });
    expect((await assistant.body('list_grocery_lists', { workspaceId })).lists).toEqual([]);
    await assistant.body('restore_grocery_list', { workspaceId, listId });
    expect((await assistant.body('list_grocery_lists', { workspaceId })).lists).toEqual([expect.objectContaining({ id: listId, title: 'Saturday market' })]);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlreadyLinkedError,
  ContactConflictError,
  ContactImportRefusedError,
  ContactLimitReachedError,
  ContactNotFoundError,
  InvalidCursorError,
  LinkNotFoundError,
  LinkTargetNotFoundError,
  NotAuthorizedError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  addDocumentLink,
  addMember,
  changeMemberRole,
  contactCategories,
  createContact,
  createDocument,
  createPreviewQueue,
  createProcedure,
  createWorkspace,
  deleteContact,
  deleteProcedure,
  exportContacts,
  findContacts,
  getContact,
  importContacts,
  linkContactProcedure,
  listContactProcedures,
  listContactTrash,
  listDocumentLinks,
  listLinkedDocuments,
  listProcedureContacts,
  possibleContactDuplicates,
  previewContactImport,
  purgeContactTrash,
  removeDocumentLink,
  restoreContact,
  setWorkspaceTool,
  unlinkContactProcedure,
  updateContact,
  uploadDocumentFile,
  type ContactDeps,
  type DocumentExportDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type LinkDeps,
  type ProcedureInput,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type ContactInput, type ProcedureId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { contactsToCsv, contactsToVcard, parseContactsCsv, parseContactsVcard } from '@vergissmeinnicht/import-export';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { createContactRepository } from './contact-repository.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createLinkRepository } from './link-repository.ts';
import { fillContactKeys } from './migrate.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

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

describe('Contacts (16.6)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let serial = 0;
  let deps: ContactDeps;
  let links: LinkDeps;
  let docs: DocumentExportDeps;
  let files: DocumentFileDeps;
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
  const add = async (content: ContactInput, actor = uma, workspace = home) => {
    tick();
    return (await createContact(deps, { ...ref(actor, workspace), content })).contact;
  };
  const names = async (query: { q?: string; category?: string } = {}, actor = gus, workspace = home) => (await findContacts(deps, { ...ref(actor, workspace), query })).contacts.map((contact) => contact.name);
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
  const audit = (type?: string) =>
    (database.sqlite.prepare(`SELECT type, actor_display_name AS actor, subject_type AS subject, subject_id AS id, metadata FROM audit_events WHERE type LIKE ? ORDER BY rowid`).all(type ?? 'CONTACT%') as { type: string; actor: string; subject: string; id: string; metadata: string }[]).map((event) => ({
      ...event,
      metadata: JSON.parse(event.metadata) as Record<string, unknown>,
    }));
  const rows = (table: string) => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const code = async (run: Promise<unknown>) =>
    run.then(
      () => undefined,
      (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : caught instanceof ContactImportRefusedError ? caught.code : (caught as Error).name),
    );

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-contacts-'));
    now = new Date('2026-10-02T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const tools = createWorkspaceToolRepository(database);
    const fileRepository = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    members = { users, workspaces, clock };
    deps = { workspaces, tools, contacts: createContactRepository(database), clock };
    docs = { workspaces, tools, documents: createDocumentRepository(database), store, clock };
    files = { workspaces, tools, files: fileRepository, store, processor, clock, previews: createPreviewQueue({ files: fileRepository, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] }) };
    links = { workspaces, tools, links: createLinkRepository(database), clock };
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
    for (const tool of ['CONTACTS', 'DOCUMENTS']) {
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

  it('creates a plumber with only a name, and later gives them two phone numbers', async () => {
    const created = await createContact(deps, { ...ref(uma), content: { name: 'Idraulico Rossi' } });
    expect(created).toMatchObject({ contact: { name: 'Idraulico Rossi', organisation: '', category: '', emails: [], phones: [], address: '', website: '', notes: '', revision: 1, createdByName: 'Uma', updatedByName: 'Uma' }, duplicates: [] });
    const at = tick();
    const updated = await updateContact(deps, {
      ...ref(admin),
      contactId: created.contact.id,
      expectedRevision: 1,
      content: { name: 'Idraulico Rossi', category: 'Plumber', phones: [{ value: '+39 0471 123456', label: 'Office' }, { value: '333 1234567', label: 'Mobile' }], website: 'rossi.example' },
    });
    expect(updated.contact).toMatchObject({ category: 'Plumber', phones: [{ value: '+39 0471 123456', label: 'Office' }, { value: '333 1234567', label: 'Mobile' }], website: 'https://rossi.example/', revision: 2, createdByName: 'Uma', updatedByName: 'Ada', updatedAt: at });
    // A guest reads everything.
    expect((await getContact(deps, { ...ref(gus), contactId: created.contact.id })).contact).toEqual(updated.contact);
    // A stale form does not overwrite; what the domain refuses is not stored.
    await expect(updateContact(deps, { ...ref(uma), contactId: created.contact.id, expectedRevision: 1, content: { name: 'Old form' } })).rejects.toThrow(ContactConflictError);
    expect(await code(updateContact(deps, { ...ref(uma), contactId: created.contact.id, expectedRevision: 2, content: { name: 'x', website: 'javascript:alert(1)' } }))).toBe('invalid_website');
    expect(await code(createContact(deps, { ...ref(uma), content: { name: ' ' } }))).toBe('contact_name_empty');
    expect(await names()).toEqual(['Idraulico Rossi']);
    // Whatever writes the row, the database accepts only an http(s) website and a name.
    const raw = (website: string, name = 'x') =>
      database.sqlite.prepare("INSERT INTO contacts (id, workspace_id, name, website, sort_key, search_text, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', ?, ?, ?, 'x', 'x', ?, 'A', 1, ?, 'A', 1)").run(home.id, name, website, admin.id, admin.id);
    expect(() => raw('javascript:alert(1)')).toThrow('contacts_website_http');
    expect(() => raw('', ' ')).toThrow('contacts_name_present');
    // History: who did what to which Contact — never a name, an address or a number.
    expect(audit()).toEqual([
      { type: 'CONTACT_CREATED', actor: 'Uma', subject: 'contact', id: created.contact.id, metadata: {} },
      { type: 'CONTACT_UPDATED', actor: 'Ada', subject: 'contact', id: created.contact.id, metadata: {} },
    ]);
  });

  it('finds Contacts by name, organisation, category, phone and email, a page at a time', async () => {
    await add({ name: 'Mario Rossi', organisation: 'Rossi Impianti', category: 'Plumber', phones: [{ value: '+39 0471 12-34-56' }], emails: [{ value: 'mario@rossi.example' }] });
    await add({ name: 'Élise Müller', category: 'Electrician', emails: [{ value: 'elise@example.org' }], notes: 'knows Rossi' });
    await add({ name: 'Comune di Bolzano', category: 'plumber', phones: [{ value: '0471 997111' }], address: 'Piazza Rossi' });
    await add({ name: 'Zeta 100%_real' });
    await add({ name: 'Payroll office' }, otto, office);
    expect(await names()).toEqual(['Comune di Bolzano', 'Élise Müller', 'Mario Rossi', 'Zeta 100%_real']); // by name, accents folded
    expect(await names({ q: 'ROSSI' })).toEqual(['Mario Rossi']); // name and organisation — not notes, not the address
    expect(await names({ q: 'muller' })).toEqual(['Élise Müller']);
    expect(await names({ q: 'impianti' })).toEqual(['Mario Rossi']);
    expect(await names({ q: 'electric' })).toEqual(['Élise Müller']);
    expect(await names({ q: '0471' })).toEqual(['Comune di Bolzano', 'Mario Rossi']);
    expect(await names({ q: '0471123456' })).toEqual(['Mario Rossi']); // digits without the formatting
    expect(await names({ q: '0471 mario' })).toEqual(['Mario Rossi']); // every word must match
    expect(await names({ q: 'example.org' })).toEqual(['Élise Müller']);
    expect(await names({ q: '%' })).toEqual(['Zeta 100%_real']); // a wildcard is a character
    expect(await names({ q: '_' })).toEqual(['Zeta 100%_real']);
    expect(await names({ q: 'payroll' })).toEqual([]); // another Workspace
    expect(await names({ category: 'PLUMBER' })).toEqual(['Comune di Bolzano', 'Mario Rossi']);
    expect(await names({ category: 'Plumber', q: 'comune' })).toEqual(['Comune di Bolzano']);
    expect(await contactCategories(deps, ref(gus))).toEqual(['Electrician', 'Plumber']); // one spelling per category
    // Paging: fifty a page, nothing twice, nothing missing; a cursor is only a position.
    for (let n = 0; n < 120; n++) await add({ name: `Bulk ${String(n).padStart(3, '0')}`, category: 'Bulk' });
    const first = await findContacts(deps, { ...ref(gus), query: { category: 'bulk' } });
    expect(first).toMatchObject({ total: 120 });
    expect(first.contacts).toHaveLength(50);
    const second = await findContacts(deps, { ...ref(gus), query: { category: 'bulk' }, cursor: [first.next?.value, first.next?.id] });
    const third = await findContacts(deps, { ...ref(gus), query: { category: 'bulk' }, cursor: [second.next?.value, second.next?.id] });
    expect(third).toMatchObject({ next: null, total: null });
    expect(new Set([...first.contacts, ...second.contacts, ...third.contacts].map((contact) => contact.name)).size).toBe(120);
    await expect(findContacts(deps, { ...ref(gus), query: {}, cursor: 'nonsense' })).rejects.toThrow(InvalidCursorError);
    // A cursor made of another Workspace's Contact still selects only here.
    const theirs = await findContacts(deps, { ...ref(otto, office), query: {}, cursor: ['', first.contacts[0]?.id] });
    expect(theirs.contacts.map((contact) => contact.name)).toEqual(['Payroll office']);
  });

  it('points out possible duplicates — same email, same phone, same name — and never merges or refuses', async () => {
    const mario = await add({ name: 'Mario Rossi', emails: [{ value: 'mario@example.org' }], phones: [{ value: '+39 0471 123456' }] });
    const twin = await createContact(deps, { ...ref(uma), content: { name: 'M. Rossi (work)', emails: [{ value: 'MARIO@example.org' }] } });
    expect(twin.duplicates).toEqual([{ id: mario.id, name: 'Mario Rossi', organisation: '', reasons: ['email'] }]);
    // Both remain, each as it was entered.
    expect(await names()).toEqual(['M. Rossi (work)', 'Mario Rossi']);
    expect((await getContact(deps, { ...ref(gus), contactId: mario.id })).duplicates).toEqual([{ id: twin.contact.id, name: 'M. Rossi (work)', organisation: '', reasons: ['email'] }]);
    const check = (content: ContactInput, exceptId?: string) => possibleContactDuplicates(deps, { ...ref(gus), content, exceptId }).then((found) => found.map((each) => `${each.name}: ${each.reasons.join('+')}`));
    expect(await check({ name: 'Somebody else', phones: [{ value: '0039 (0471) 12 34 56' }] })).toEqual(['Mario Rossi: phone']);
    expect(await check({ name: 'ROSSI, Mario' })).toEqual(['Mario Rossi: name']);
    expect(await check({ name: 'rossi mario', emails: [{ value: 'mario@example.org' }], phones: [{ value: '+390471123456' }] })).toEqual(['M. Rossi (work): email', 'Mario Rossi: email+phone+name']);
    // A national spelling is recognised as the international one (by its last eight digits) …
    expect(await check({ name: 'Maria Rossi', phones: [{ value: '0471 123456' }] })).toEqual(['Mario Rossi: phone']);
    // … another line is not, and neither is a number too short to compare by its end.
    expect(await check({ name: 'Maria Rossi', phones: [{ value: '0471 123457' }] })).toEqual([]);
    expect(await check({ name: 'Maria Rossi', phones: [{ value: '123456' }] })).toEqual([]);
    // Contacts saved before this rule get their keys written again by `migrate`; a second run changes nothing.
    database.sqlite.prepare("DELETE FROM contact_keys WHERE key LIKE 'tail:%'").run();
    expect(await check({ name: 'Maria Rossi', phones: [{ value: '0471 123456' }] })).toEqual([]);
    expect(fillContactKeys(database.sqlite)).toBe(1);
    expect(fillContactKeys(database.sqlite)).toBe(0);
    expect(await check({ name: 'Maria Rossi', phones: [{ value: '0471 123456' }] })).toEqual(['Mario Rossi: phone']);
    expect(await check({ name: 'Mario Rossi' }, mario.id)).toEqual([]); // never itself
    // Not across Workspaces, and not with what is in Trash.
    await add({ name: 'Mario Rossi', emails: [{ value: 'mario@example.org' }] }, otto, office);
    expect((await possibleContactDuplicates(deps, { ...ref(otto, office), content: { name: 'x', emails: [{ value: 'mario@example.org' }] } })).map((each) => each.name)).toEqual(['Mario Rossi']);
    await deleteContact(deps, { ...ref(uma), contactId: mario.id });
    expect(await check({ name: 'Mario Rossi', emails: [{ value: 'mario@example.org' }] })).toEqual(['M. Rossi (work): email']);
    // Changing a Contact changes what it is compared by.
    await updateContact(deps, { ...ref(uma), contactId: twin.contact.id, expectedRevision: 1, content: { name: 'M. Rossi (work)', emails: [{ value: 'new@example.org' }] } });
    expect(await check({ name: 'x', emails: [{ value: 'mario@example.org' }] })).toEqual([]);
    expect(await check({ name: 'x', emails: [{ value: 'new@example.org' }] })).toEqual(['M. Rossi (work): email']);
  });

  it('lets a GUEST only read, keeps Workspaces apart, and answers "not found" where the tool is off', async () => {
    const plumber = await add({ name: 'Idraulico Rossi' });
    const theirs = await add({ name: 'Payroll office' }, otto, office);
    const content = { name: 'Changed' };
    const writes: [string, (actor: User, workspace?: Workspace, contactId?: string) => Promise<unknown>][] = [
      ['create', (actor, workspace) => createContact(deps, { ...ref(actor, workspace), content })],
      ['update', (actor, workspace, contactId = plumber.id) => updateContact(deps, { ...ref(actor, workspace), contactId, expectedRevision: 1, content })],
      ['delete', (actor, workspace, contactId = plumber.id) => deleteContact(deps, { ...ref(actor, workspace), contactId })],
      ['restore', (actor, workspace, contactId = plumber.id) => restoreContact(deps, { ...ref(actor, workspace), contactId })],
      ['trash', (actor, workspace) => listContactTrash(deps, ref(actor, workspace))],
      ['purge', (actor, workspace) => purgeContactTrash(deps, { ...ref(actor, workspace), contactIds: 'all' })],
      ['preview', (actor, workspace) => previewContactImport(deps, { ...ref(actor, workspace), parse: () => ({ drafts: [{ line: 1, input: content }], ignored: [] }) })],
      ['import', (actor, workspace) => importContacts(deps, { ...ref(actor, workspace), contacts: [content], format: 'csv' })],
      ['export', (actor, workspace) => exportContacts(deps, { ...ref(actor, workspace), format: 'csv' })],
      ['link', (actor, workspace, contactId = plumber.id) => linkContactProcedure(deps, { ...ref(actor, workspace), contactId, procedureId: boiler })],
      ['unlink', (actor, workspace) => unlinkContactProcedure(deps, { ...ref(actor, workspace), linkId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' })],
    ];
    const reads: [string, (actor: User, workspace?: Workspace, contactId?: string) => Promise<unknown>][] = [
      ['find', (actor, workspace) => findContacts(deps, { ...ref(actor, workspace), query: {} })],
      ['categories', (actor, workspace) => contactCategories(deps, ref(actor, workspace))],
      ['get', (actor, workspace, contactId = plumber.id) => getContact(deps, { ...ref(actor, workspace), contactId })],
      ['duplicates', (actor, workspace) => possibleContactDuplicates(deps, { ...ref(actor, workspace), content })],
      ['procedures', (actor, workspace, contactId = plumber.id) => listContactProcedures(deps, { ...ref(actor, workspace), contactId })],
      ['of procedure', (actor, workspace) => listProcedureContacts(deps, { ...ref(actor, workspace), procedureId: boiler })],
    ];
    // A guest: every read, no write — an export included.
    for (const [name, run] of reads) expect({ name, refused: await code(run(gus)) }).toEqual({ name, refused: undefined });
    for (const [name, run] of writes) expect({ name, refused: await code(run(gus)) }).toEqual({ name, refused: 'NotAuthorizedError' });
    // A USER does everything but delete for good.
    expect(await code(purgeContactTrash(deps, { ...ref(uma), contactIds: 'all' }))).toBe('NotAuthorizedError');
    // Someone who is not a member learns nothing, whatever they ask for.
    for (const [name, run] of [...reads, ...writes]) expect({ name, refused: await code(run(otto)) }).toEqual({ name, refused: 'WorkspaceNotFoundError' });
    // Home's Contact asked for under another Workspace — and the other way round — does not exist.
    for (const [name, run] of [...reads, ...writes].filter(([each]) => ['get', 'update', 'delete', 'restore', 'procedures', 'link'].includes(each))) {
      expect({ name, refused: await code(run(otto, office, plumber.id)) }).toEqual({ name, refused: 'ContactNotFoundError' });
      expect({ name, refused: await code(run(admin, home, theirs.id)) }).toEqual({ name, refused: 'ContactNotFoundError' });
    }
    await expect(purgeContactTrash(deps, { ...ref(otto, office), contactIds: [plumber.id] })).rejects.toThrow(ContactNotFoundError);
    expect(await names()).toEqual(['Idraulico Rossi']);
    expect((await getContact(deps, { ...ref(gus), contactId: plumber.id })).contact).toMatchObject({ name: 'Idraulico Rossi', revision: 1 });
    // A role lost between the check and the write changes nothing.
    const ana = await members.users.create({ email: normalizeEmail('ana@example.org'), displayName: 'Ana', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    await addMember(members, { actor: admin, workspaceId: home.id, email: ana.email, role: 'USER' });
    const demoting: ContactDeps = {
      ...deps,
      contacts: new Proxy(deps.contacts, {
        get: (target, property) =>
          typeof property === 'string' && ['create', 'update', 'delete', 'importMany', 'exportAll', 'linkProcedure'].includes(property)
            ? async (...args: unknown[]) => {
                await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'GUEST' });
                return (target[property as keyof typeof target] as (...given: unknown[]) => unknown)(...args);
              }
            : target[property as keyof typeof target],
      }),
    };
    for (const [name, run] of [
      ['create', () => createContact(demoting, { ...ref(ana), content })],
      ['update', () => updateContact(demoting, { ...ref(ana), contactId: plumber.id, expectedRevision: 1, content })],
      ['delete', () => deleteContact(demoting, { ...ref(ana), contactId: plumber.id })],
      ['import', () => importContacts(demoting, { ...ref(ana), contacts: [content], format: 'csv' })],
      ['export', () => exportContacts(demoting, { ...ref(ana), format: 'csv' })],
      ['link', () => linkContactProcedure(demoting, { ...ref(ana), contactId: plumber.id, procedureId: boiler })],
    ] as const) {
      await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'USER' });
      expect({ name, refused: await code(run()) }).toEqual({ name, refused: 'NotAuthorizedError' });
    }
    // An admin who stops being one between the check and the deletion deletes nothing for good.
    const doomed = await add({ name: 'In Trash' });
    await deleteContact(deps, { ...ref(uma), contactId: doomed.id });
    await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'ADMIN' });
    const demotingAdmin: ContactDeps = { ...deps, contacts: { ...deps.contacts, purge: async (...args) => (await changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role: 'USER' }), deps.contacts.purge(...args)) } };
    await expect(purgeContactTrash(demotingAdmin, { ...ref(ana), contactIds: 'all' })).rejects.toThrow(NotAuthorizedError);
    expect(await listContactTrash(deps, ref(uma))).toHaveLength(1);
    await restoreContact(deps, { ...ref(uma), contactId: doomed.id });
    await deleteContact(deps, { ...ref(uma), contactId: doomed.id });
    expect(await names()).toEqual(['Idraulico Rossi']);
    // Switched off: every route answers like an unknown resource, for every role; nothing is deleted.
    const before = rows('contacts');
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: false });
    for (const actor of [admin, uma, gus]) for (const [name, run] of [...reads, ...writes]) expect({ name, actor: actor.displayName, refused: await code(run(actor)) }).toEqual({ name, actor: actor.displayName, refused: 'ToolNotEnabledError' });
    await expect(createContact(deps, { ...ref(otto), content })).rejects.toThrow(WorkspaceNotFoundError);
    expect(rows('contacts')).toBe(before);
    // … also when it is switched off between the check and the write.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: true });
    const switching: ContactDeps = { ...deps, contacts: { ...deps.contacts, create: async (...args) => (await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: false }), deps.contacts.create(...args)) } };
    await expect(createContact(switching, { ...ref(uma), content })).rejects.toThrow(ToolNotEnabledError);
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: true });
    expect(await names()).toEqual(['Idraulico Rossi']);
  });

  it('moves a Contact to Trash, restores it, and lets only a Workspace admin delete it for good — leaving nothing of the person', async () => {
    const rossi = await add({ name: 'Segreto Rossi', organisation: 'Rossi Privato', emails: [{ value: 'segreto@example.org' }], phones: [{ value: '+39 333 9999999' }], address: 'Via Nascosta 7', notes: 'private note' });
    const other = await add({ name: 'Stays' });
    const theirs = await add({ name: 'Payroll office' }, otto, office);
    const deletedAt = tick();
    await deleteContact(deps, { ...ref(uma), contactId: rossi.id });
    expect(await names()).toEqual(['Stays']);
    await expect(getContact(deps, { ...ref(gus), contactId: rossi.id })).rejects.toThrow(ContactNotFoundError);
    await expect(deleteContact(deps, { ...ref(uma), contactId: rossi.id })).rejects.toThrow(ContactNotFoundError);
    await expect(updateContact(deps, { ...ref(uma), contactId: rossi.id, expectedRevision: 2, content: { name: 'x' } })).rejects.toThrow(ContactNotFoundError);
    expect(await listContactTrash(deps, ref(uma))).toEqual([{ id: rossi.id, name: 'Segreto Rossi', organisation: 'Rossi Privato', deletedAt, deletedByName: 'Uma' }]);
    // Restore brings it back as it was.
    const restored = await restoreContact(deps, { ...ref(uma), contactId: rossi.id });
    expect(restored).toMatchObject({ name: 'Segreto Rossi', emails: [{ value: 'segreto@example.org', label: '' }], notes: 'private note', revision: 3 });
    await expect(restoreContact(deps, { ...ref(uma), contactId: rossi.id })).rejects.toThrow(ContactNotFoundError);
    expect(await listContactTrash(deps, ref(uma))).toEqual([]);

    // Permanent deletion: only from Trash, only by a Workspace admin, only of this Workspace.
    await expect(purgeContactTrash(deps, { ...ref(admin), contactIds: [rossi.id] })).rejects.toThrow(ContactNotFoundError); // not in Trash
    expect(() => database.sqlite.prepare('DELETE FROM contact_keys WHERE contact_id = ?').run(rossi.id)).not.toThrow();
    expect(() => database.sqlite.prepare('DELETE FROM contacts WHERE id = ?').run(rossi.id)).toThrow('only from trash');
    await updateContact(deps, { ...ref(uma), contactId: rossi.id, expectedRevision: 3, content: { name: 'Segreto Rossi', organisation: 'Rossi Privato', emails: [{ value: 'segreto@example.org' }], phones: [{ value: '+39 333 9999999' }], address: 'Via Nascosta 7', notes: 'private note' } });
    await linkContactProcedure(deps, { ...ref(uma), contactId: rossi.id, procedureId: boiler });
    const bill = await document('Water bill');
    await addDocumentLink(links, { ...ref(uma), documentId: bill.id, target: { type: 'contact', id: rossi.id } });
    await deleteContact(deps, { ...ref(uma), contactId: rossi.id });
    await deleteContact(deps, { ...ref(otto, office), contactId: theirs.id });
    await expect(purgeContactTrash(deps, { ...ref(uma), contactIds: [rossi.id] })).rejects.toThrow(NotAuthorizedError);
    await expect(purgeContactTrash(deps, { ...ref(admin), contactIds: [theirs.id] })).rejects.toThrow(ContactNotFoundError);
    await expect(purgeContactTrash(deps, { ...ref(admin), contactIds: [rossi.id, other.id] })).rejects.toThrow(ContactNotFoundError); // one not in Trash: nothing is deleted
    expect(await code(purgeContactTrash(deps, { ...ref(admin), contactIds: [] }))).toBe('invalid_trash_selection');
    expect(await code(purgeContactTrash(deps, { ...ref(admin), contactIds: [rossi.id, rossi.id] }))).toBe('invalid_trash_selection');
    expect(await listContactTrash(deps, ref(uma))).toHaveLength(1);
    const purgedAt = tick();
    expect(await purgeContactTrash(deps, { ...ref(admin), contactIds: 'all' })).toBe(1);
    expect(await listContactTrash(deps, ref(uma))).toEqual([]);
    expect(await listContactTrash(deps, ref(otto, office))).toHaveLength(1); // "all" is all of this Workspace
    await expect(restoreContact(deps, { ...ref(uma), contactId: rossi.id })).rejects.toThrow(ContactNotFoundError);
    // What it was linked to says that a contact was deleted — when and by whom, not who.
    expect(await listProcedureContacts(deps, { ...ref(gus), procedureId: boiler })).toMatchObject([{ contact: null }]);
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: bill.id })).links).toMatchObject([{ record: { type: 'contact', title: null, state: 'gone', goneAt: purgedAt, goneByName: 'Ada' } }]);
    // Nothing of the person is left anywhere in the database: not in a table, not in the history.
    const everything = JSON.stringify(
      (database.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\'").all() as { name: string }[]).map((table) => database.sqlite.prepare(`SELECT * FROM "${table.name}"`).all()),
    );
    for (const secret of ['Segreto', 'Rossi Privato', 'segreto@example.org', '333 9999999', '3339999999', 'Via Nascosta', 'private note']) expect({ secret, left: everything.includes(secret) }).toEqual({ secret, left: false });
    expect(audit('CONTACT_PURGED')).toEqual([{ type: 'CONTACT_PURGED', actor: 'Ada', subject: 'contact', id: rossi.id, metadata: {} }]);
    expect(await names()).toEqual(['Stays']);
  });

  it('previews an import with its possible duplicates and saves exactly what was confirmed', async () => {
    await add({ name: 'Mario Rossi', emails: [{ value: 'mario@example.org' }] });
    await add({ name: 'Comune di Bolzano', phones: [{ value: '0471 997111' }] });
    await add({ name: 'Élise Müller' });
    const lines = ['Name,Email,Phone,Category,Website'];
    for (let n = 0; n < 196; n++) lines.push(`Person ${String(n).padStart(3, '0')},p${n}@import.example,0471 5${String(n).padStart(4, '0')},Imported,`);
    lines.push('Mario R.,MARIO@example.org,,,'); // an existing email address
    lines.push('Ufficio,,(0471) 99-71-11,,'); // an existing phone number
    lines.push('MÜLLER Elise,,,,'); // an existing name
    lines.push('Person 000 again,p0@import.example,,,'); // the same as an earlier line of this file
    lines.push('Bad website,,,,javascript:alert(1)');
    lines.push(',nobody@example.org,,,');
    const before = rows('contacts');
    for (const [format, parse] of [
      ['csv', () => parseContactsCsv(lines.join('\n'))],
      // The same Contacts as a vCard file (the two entries that cannot be imported come as cards of their own).
      ['vcard', () => parseContactsVcard(`${contactsToVcard(parseContactsCsv(lines.slice(0, 201).join('\n')).drafts.map((draft) => ({ organisation: '', category: '', address: '', website: '', notes: '', emails: [], phones: [], ...JSON.parse(JSON.stringify(draft.input)) }) as never))}BEGIN:VCARD\nFN:Bad website\nURL:javascript:alert(1)\nEND:VCARD\nBEGIN:VCARD\nEMAIL:nobody@example.org\nEND:VCARD\n`)],
    ] as const) {
      const preview = await previewContactImport(deps, { ...ref(uma), parse });
      expect({ format, entries: preview.entries.length }).toEqual({ format, entries: 202 });
      // Nothing was saved by looking.
      expect(rows('contacts')).toBe(before);
      const withDuplicates = preview.entries.filter((entry) => entry.duplicates.length > 0);
      expect(withDuplicates.map((entry) => [entry.name, entry.duplicates.map((each) => `${each.name}: ${each.reasons.join('+')}`)])).toEqual([
        ['Mario R.', ['Mario Rossi: email']],
        ['Ufficio', ['Comune di Bolzano: phone']],
        ['MÜLLER Elise', ['Élise Müller: name']],
      ]);
      expect(preview.entries.filter((entry) => entry.sameAs.length > 0).map((entry) => [entry.name, entry.sameAs])).toEqual([['Person 000 again', [{ entry: 0, reasons: ['email'] }]]]);
      // What cannot be imported is listed with the reason — not dropped, not guessed.
      expect(preview.entries.filter((entry) => entry.contact === null).map((entry) => [entry.name, entry.problem])).toEqual([
        ['Bad website', { code: 'invalid_website', field: 'website' }],
        ['', { code: 'contact_name_empty', field: 'name' }],
      ]);
    }
    // The person leaves two of the three possible duplicates out and imports the third anyway.
    const preview = await previewContactImport(deps, { ...ref(uma), parse: () => parseContactsCsv(lines.join('\n')) });
    const chosen = preview.entries.filter((entry) => entry.contact !== null && entry.name !== 'Mario R.' && entry.name !== 'Ufficio').flatMap((entry) => (entry.contact === null ? [] : [entry.contact]));
    expect(chosen).toHaveLength(198);
    tick();
    expect(await importContacts(deps, { ...ref(uma), contacts: chosen, format: 'csv' })).toBe(198);
    expect(rows('contacts')).toBe(before + 198);
    expect(await names({ q: 'muller' })).toEqual(['Élise Müller', 'MÜLLER Elise']); // both remain: nothing merged
    expect(await names({ q: 'Mario' })).toEqual(['Mario Rossi']);
    expect((await findContacts(deps, { ...ref(gus), query: { category: 'imported' } })).total).toBe(196);
    expect((await getContact(deps, { ...ref(gus), contactId: (await findContacts(deps, { ...ref(gus), query: { q: 'Person 007' } })).contacts[0]?.id ?? '' })).contact).toMatchObject({ emails: [{ value: 'p7@import.example', label: '' }], phones: [{ value: '0471 50007', label: '' }], createdByName: 'Uma' });
    expect(audit('CONTACTS_IMPORTED')).toEqual([{ type: 'CONTACTS_IMPORTED', actor: 'Uma', subject: 'workspace', id: home.id, metadata: { format: 'csv', contacts: 198 } }]);

    // All or nothing: one entry that breaks the rules and none of the import is saved.
    const count = rows('contacts');
    expect(await code(importContacts(deps, { ...ref(uma), contacts: [{ name: 'Fine' }, { name: 'Bad', website: 'javascript:alert(1)' }], format: 'vcard' }))).toBe('invalid_website');
    expect(await code(importContacts(deps, { ...ref(uma), contacts: [], format: 'csv' }))).toBe('invalid_contact_import');
    expect(await code(importContacts(deps, { ...ref(uma), contacts: Array.from({ length: 1001 }, (_, n) => ({ name: `N ${n}` })), format: 'csv' }))).toBe('invalid_contact_import');
    expect(await code(previewContactImport(deps, { ...ref(uma), parse: () => ({ drafts: [], ignored: [] }) }))).toBe('contact_import_empty');
    expect(await code(previewContactImport(deps, { ...ref(uma), parse: () => ({ drafts: Array.from({ length: 1001 }, (_, n) => ({ line: n + 1, input: { name: `N ${n}` } })), ignored: [] }) }))).toBe('contact_import_too_many');
    // The Workspace's limit holds for an import as a whole.
    database.sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${10_000 - count - 1}) INSERT INTO contacts (id, workspace_id, name, sort_key, search_text, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at) SELECT printf('%08d-0000-4000-8000-000000000000', i), '${home.id}', 'Filler ' || i, 'filler', 'filler', '${admin.id}', 'Ada', 1, '${admin.id}', 'Ada', 1 FROM n`);
    await expect(importContacts(deps, { ...ref(uma), contacts: [{ name: 'One' }, { name: 'Two' }], format: 'csv' })).rejects.toThrow(ContactLimitReachedError);
    expect(rows('contacts')).toBe(10_000 - 1 + (rows('contacts') - (10_000 - 1)));
    await createContact(deps, { ...ref(uma), content: { name: 'The last one' } });
    await expect(createContact(deps, { ...ref(uma), content: { name: 'One too many' } })).rejects.toThrow(ContactLimitReachedError);
  });

  it('never parses a file for someone who may not import', async () => {
    let parsed = 0;
    const parse = () => {
      parsed++;
      return { drafts: [{ line: 1, input: { name: 'x' } }], ignored: [] };
    };
    await expect(previewContactImport(deps, { ...ref(gus), parse })).rejects.toThrow(NotAuthorizedError);
    await expect(previewContactImport(deps, { ...ref(otto), parse })).rejects.toThrow(WorkspaceNotFoundError);
    expect(parsed).toBe(0);
  });

  it('exports every Contact that is not in Trash, for USER and above, and re-imports to the same data', async () => {
    await add({ name: 'Mario Rossi', organisation: 'Rossi; Impianti', category: 'Plumber', emails: [{ value: 'mario@example.org', label: 'Office' }], phones: [{ value: '+39 0471 123456', label: 'Mobile' }, { value: '0471 99' }], address: 'Via Roma 1\n39100 Bolzano', website: 'https://example.org/x', notes: '=1+1\nsecond line, with "quotes"' });
    await add({ name: 'Comune di Bolzano' });
    const gone = await add({ name: 'In Trash' });
    await deleteContact(deps, { ...ref(uma), contactId: gone.id });
    await add({ name: 'Payroll office' }, otto, office);
    const fields = (contact: { name: string; organisation: string; category: string; emails: readonly unknown[]; phones: readonly unknown[]; address: string; website: string; notes: string }) => ({ name: contact.name, organisation: contact.organisation, category: contact.category, emails: contact.emails, phones: contact.phones, address: contact.address, website: contact.website, notes: contact.notes });
    const exported = await exportContacts(deps, { ...ref(uma), format: 'csv' });
    expect(exported.map((contact) => contact.name)).toEqual(['Comune di Bolzano', 'Mario Rossi']);
    await expect(exportContacts(deps, { ...ref(gus), format: 'csv' })).rejects.toThrow(NotAuthorizedError);
    expect(audit('CONTACTS_EXPORTED')).toEqual([{ type: 'CONTACTS_EXPORTED', actor: 'Uma', subject: 'workspace', id: home.id, metadata: { format: 'csv', contacts: 2 } }]);
    // Into an empty Workspace: the same Contacts, field by field, from either format.
    for (const [format, text, parse] of [
      ['csv', contactsToCsv(exported), parseContactsCsv],
      ['vcard', contactsToVcard(exported), parseContactsVcard],
    ] as const) {
      const target = await createWorkspace(members, { actor: admin, name: `Copy ${format}` });
      await setWorkspaceTool(docs, { ...ref(admin, target), tool: 'CONTACTS', enabled: true });
      const preview = await previewContactImport(deps, { ...ref(admin, target), parse: () => parse(text.replace(/^\uFEFF/, '')) });
      expect(preview.ignored).toEqual([]);
      await importContacts(deps, { ...ref(admin, target), contacts: preview.entries.flatMap((entry) => (entry.contact === null ? [] : [entry.contact])), format });
      expect({ format, contacts: (await exportContacts(deps, { ...ref(admin, target), format })).map(fields) }).toEqual({ format, contacts: exported.map(fields) });
    }
  });

  it('links a Contact to Procedures and Documents — references that reveal nothing and grant nothing', async () => {
    const plumber = await add({ name: 'Idraulico Rossi', category: 'Plumber', phones: [{ value: '0471 123456' }] });
    const theirs = await add({ name: 'Payroll office' }, otto, office);
    const bill = await document('Water bill');
    const theirBill = await document('Payslip', otto, office);
    tick();
    const link = await linkContactProcedure(deps, { ...ref(uma), contactId: plumber.id, procedureId: boiler });
    expect(link).toMatchObject({ procedureId: boiler, title: 'Boiler service', state: 'ok', createdByName: 'Uma' });
    expect(await listContactProcedures(deps, { ...ref(gus), contactId: plumber.id })).toEqual([link]);
    expect(await listProcedureContacts(deps, { ...ref(gus), procedureId: boiler })).toMatchObject([{ id: link.id, contact: { id: plumber.id, name: 'Idraulico Rossi', phones: [{ value: '0471 123456' }] } }]);
    await expect(linkContactProcedure(deps, { ...ref(uma), contactId: plumber.id, procedureId: boiler })).rejects.toThrow(AlreadyLinkedError);
    // Never across Workspaces, in either direction — refused by the use-case and by the database.
    await expect(linkContactProcedure(deps, { ...ref(uma), contactId: plumber.id, procedureId: theirProcedure })).rejects.toThrow(LinkTargetNotFoundError);
    await expect(linkContactProcedure(deps, { ...ref(otto, office), contactId: plumber.id, procedureId: theirProcedure })).rejects.toThrow(ContactNotFoundError);
    await expect(unlinkContactProcedure(deps, { ...ref(otto, office), linkId: link.id })).rejects.toThrow(LinkNotFoundError);
    expect(await listProcedureContacts(deps, { ...ref(otto, office), procedureId: boiler })).toEqual([]);
    const insert = (workspaceId: string, fromType: string, fromId: string, toType: string, toId: string) =>
      database.sqlite.prepare("INSERT INTO links (id, workspace_id, from_type, from_id, to_type, to_id, created_by_user_id, created_by_display_name, created_at) VALUES (lower(hex(randomblob(18))), ?, ?, ?, ?, ?, ?, 'A', 1)").run(workspaceId, fromType, fromId, toType, toId, admin.id);
    expect(() => insert(home.id, 'contact', plumber.id, 'procedure', theirProcedure)).toThrow('its own workspace');
    expect(() => insert(home.id, 'contact', theirs.id, 'procedure', boiler)).toThrow('its own workspace');
    expect(() => insert(home.id, 'document', bill.id, 'contact', theirs.id)).toThrow('its own workspace');
    expect(() => insert(home.id, 'contact', plumber.id, 'document', bill.id)).toThrow('its own workspace'); // a Contact is the far end of a Document's Link, never the near one
    expect(() => insert(home.id, 'contact', plumber.id, 'schedule', boiler)).toThrow('its own workspace');

    // A Document linked to the Contact, seen from both ends.
    tick();
    const documentLink = await addDocumentLink(links, { ...ref(uma), documentId: bill.id, target: { type: 'contact', id: plumber.id } });
    expect(documentLink.record).toEqual({ type: 'contact', id: plumber.id, title: 'Idraulico Rossi', state: 'ok' });
    expect(await listLinkedDocuments(links, { ...ref(gus), target: { type: 'contact', id: plumber.id } })).toMatchObject([{ id: documentLink.id, record: { type: 'document', id: bill.id, title: 'Water bill', state: 'ok' } }]);
    await expect(addDocumentLink(links, { ...ref(uma), documentId: bill.id, target: { type: 'contact', id: theirs.id } })).rejects.toThrow(LinkTargetNotFoundError);
    await expect(addDocumentLink(links, { ...ref(otto, office), documentId: theirBill.id, target: { type: 'contact', id: plumber.id } })).rejects.toThrow(LinkTargetNotFoundError);
    // Each tool removes its own Links.
    await expect(removeDocumentLink(links, { ...ref(uma), linkId: link.id })).rejects.toThrow(LinkNotFoundError);
    await expect(unlinkContactProcedure(deps, { ...ref(uma), linkId: documentLink.id })).rejects.toThrow(LinkNotFoundError);
    // History names the records by id — never the Contact by name.
    expect(audit('CONTACT_LINK_ADDED')).toEqual([{ type: 'CONTACT_LINK_ADDED', actor: 'Uma', subject: 'contact', id: plumber.id, metadata: { linkedType: 'procedure', linkedId: boiler } }]);
    expect(JSON.stringify(database.sqlite.prepare('SELECT metadata FROM audit_events').all())).not.toContain('Idraulico');

    // In Trash: a "deleted contact" on what it was linked to — not who; and nothing new can be linked to it.
    await deleteContact(deps, { ...ref(uma), contactId: plumber.id });
    expect(await listProcedureContacts(deps, { ...ref(admin), procedureId: boiler })).toEqual([{ id: link.id, contact: null }]);
    expect((await listDocumentLinks(links, { ...ref(admin), documentId: bill.id })).links.map((each) => each.record)).toEqual([{ type: 'contact', id: plumber.id, title: null, state: 'trash' }]);
    await expect(linkContactProcedure(deps, { ...ref(uma), contactId: plumber.id, procedureId: boiler })).rejects.toThrow(ContactNotFoundError);
    const second = await document('Second bill');
    await expect(addDocumentLink(links, { ...ref(uma), documentId: second.id, target: { type: 'contact', id: plumber.id } })).rejects.toThrow(LinkTargetNotFoundError);
    // Restored: the Links are as before.
    await restoreContact(deps, { ...ref(uma), contactId: plumber.id });
    expect(await listProcedureContacts(deps, { ...ref(gus), procedureId: boiler })).toMatchObject([{ contact: { name: 'Idraulico Rossi' } }]);
    // A deleted Procedure stays linked, marked as deleted; a new Link to it is refused.
    await deleteProcedure({ workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock }, { actor: admin, workspaceId: home.id, procedureId: boiler });
    expect(await listContactProcedures(deps, { ...ref(gus), contactId: plumber.id })).toMatchObject([{ title: 'Boiler service', state: 'deleted' }]);
    // With Contacts switched off, a Document shows nothing of them; with Documents off, Contacts work without them.
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: false });
    expect((await listDocumentLinks(links, { ...ref(gus), documentId: bill.id })).links).toEqual([]);
    await expect(listLinkedDocuments(links, { ...ref(gus), target: { type: 'contact', id: plumber.id } })).rejects.toThrow(ToolNotEnabledError);
    await expect(addDocumentLink(links, { ...ref(uma), documentId: second.id, target: { type: 'contact', id: plumber.id } })).rejects.toThrow(ToolNotEnabledError);
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'CONTACTS', enabled: true });
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
    expect((await getContact(deps, { ...ref(gus), contactId: plumber.id })).contact.name).toBe('Idraulico Rossi');
    await expect(listLinkedDocuments(links, { ...ref(gus), target: { type: 'contact', id: plumber.id } })).rejects.toThrow(ToolNotEnabledError);
    // Removing a Link removes neither record.
    tick();
    await unlinkContactProcedure(deps, { ...ref(uma), linkId: link.id });
    expect(await listContactProcedures(deps, { ...ref(gus), contactId: plumber.id })).toEqual([]);
    expect(audit('CONTACT_LINK_REMOVED')).toEqual([{ type: 'CONTACT_LINK_REMOVED', actor: 'Uma', subject: 'contact', id: plumber.id, metadata: { linkedType: 'procedure', linkedId: boiler } }]);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_PENDING_MS,
  DocumentConflictError,
  DocumentFileNotFoundError,
  DocumentNotFoundError,
  DocumentTypeNotFoundError,
  FileInUseError,
  FolderMoveRefusedError,
  FolderNotFoundError,
  NameTakenError,
  NotAuthorizedError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createDocument,
  createDocumentType,
  createFolder,
  createPreviewQueue,
  createWorkspace,
  deleteDocument,
  deleteFolder,
  enabledTools,
  getDocument,
  getDocumentFile,
  listDocumentTrash,
  listDocumentTypes,
  findDocuments,
  listFolders,
  moveDocuments,
  moveFolder,
  openOriginal,
  purgeUnusedDocumentFiles,
  renameDocumentType,
  renameFolder,
  restoreDocument,
  restoreFolder,
  retireDocumentType,
  setDocumentFiles,
  setWorkspaceTool,
  updateDocument,
  uploadDocumentFile,
  type DocumentDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { openDatabase } from './connection.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

/** Every test file is a one-page image with a small preview (the real parsers are tested in `packages/media`). */
const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async (path) => ({ jpeg: new TextEncoder().encode(`preview of ${path}`), width: 1800, height: 2400 }),
  thumbnail: async (preview) => ({ jpeg: new TextEncoder().encode(`thumbnail ${preview.byteLength}`), width: 300, height: 400 }),
};

describe('Folders and Documents (16.2)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let deps: DocumentDeps;
  let fileDeps: DocumentFileDeps;
  let admin: User;
  let eddie: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let counter = 0;
  const clock = { now: () => now };
  const tick = () => (now = new Date(now.getTime() + 60_000));
  const on = (db: Pick<typeof database, 'db'>): DocumentDeps => ({ workspaces: createWorkspaceRepository(db), tools: createWorkspaceToolRepository(db), documents: createDocumentRepository(db), clock });
  const ref = (actor: User, workspace = home) => ({ actor, workspaceId: workspace.id });
  const upload = async (name: string, actor = uma, workspace = home) =>
    (
      await uploadDocumentFile(fileDeps, {
        actor,
        workspaceId: workspace.id,
        name,
        source: (async function* () {
          yield new TextEncoder().encode(`photo ${++counter} ${name}`);
        })(),
      })
    ).file;
  const folder = (name: string, parentId: string | null = null, actor = uma) => createFolder(deps, { ...ref(actor), name, parentId });
  const document = async (title: string, folderId: string | null = null, files = 1, actor = uma) => {
    const fileIds = [];
    for (let i = 0; i < files; i++) fileIds.push((await upload(`${title}-${i + 1}.jpg`, actor)).id);
    return createDocument(deps, { ...ref(actor), folderId, content: { title }, fileIds });
  };
  const events = (type?: string) =>
    (database.sqlite.prepare(`SELECT type, subject_type AS subject, actor_display_name AS actor, metadata FROM audit_events ${type === undefined ? '' : 'WHERE type = ?'} ORDER BY rowid`).all(...(type === undefined ? [] : [type])) as { type: string; subject: string; actor: string; metadata: string }[]).map(
      (event) => ({ ...event, metadata: JSON.parse(event.metadata) as Record<string, unknown> }),
    );
  const names = async (actor = gus) => (await listFolders(deps, ref(actor))).map((each) => each.name).sort();

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-documents-'));
    now = new Date();
    deps = on(database);
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const files = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    fileDeps = { workspaces, tools: deps.tools, files, store, processor, clock, previews: createPreviewQueue({ files, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] }) };
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    eddie = await user('eddie@example.org', 'Eddie');
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    for (const [member, role] of [
      [eddie, 'EDITOR'],
      [uma, 'USER'],
      [gus, 'GUEST'],
    ] as const) {
      await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: member.email, role });
    }
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
    await setWorkspaceTool(deps, { ...ref(otto, office), tool: 'DOCUMENTS', enabled: true });
  });
  afterEach(() => {
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('the Documents tool', () => {
    it('is off until a Workspace admin switches it on; nobody else can; switching off hides everything and keeps the data', async () => {
      const users = createUserRepository(database);
      const fresh = await createWorkspace({ users, workspaces: deps.workspaces, clock }, { actor: admin, name: 'Club' });
      await addMember({ users, workspaces: deps.workspaces, clock }, { actor: admin, workspaceId: fresh.id, email: uma.email, role: 'USER' });
      expect(await enabledTools(deps, ref(uma, fresh))).toEqual([]);
      await expect(listFolders(deps, ref(uma, fresh))).rejects.toThrow(ToolNotEnabledError);
      await expect(createFolder(deps, { ...ref(admin, fresh), name: 'Water', parentId: null })).rejects.toThrow(ToolNotEnabledError);
      for (const actor of [gus, uma, eddie]) await expect(setWorkspaceTool(deps, { ...ref(actor), tool: 'DOCUMENTS', enabled: false })).rejects.toThrow(NotAuthorizedError);
      await expect(setWorkspaceTool(deps, { ...ref(otto), tool: 'DOCUMENTS', enabled: false })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(setWorkspaceTool(deps, { ...ref(admin), tool: 'MAIL', enabled: true })).rejects.toThrow(DomainValidationError);
      // Nothing is created by enabling: no folders, no records.
      expect(await listFolders(deps, ref(gus))).toEqual([]);

      const water = await folder('Water');
      const bill = await document('Water bill', water.id);
      expect(await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: false })).toEqual([]);
      for (const actor of [admin, uma, gus]) {
        await expect(listFolders(deps, ref(actor))).rejects.toThrow(ToolNotEnabledError);
        await expect(getDocument(deps, { ...ref(actor), documentId: bill.id })).rejects.toThrow(ToolNotEnabledError);
      }
      await expect(renameFolder(deps, { ...ref(uma), folderId: water.id, name: 'Acqua', expectedRevision: 1 })).rejects.toThrow(ToolNotEnabledError);
      expect(await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: true })).toEqual(['DOCUMENTS']);
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).title).toBe('Water bill'); // the same data, for every member
      expect(await names()).toEqual(['Water']);
      const switches = events().filter((event) => event.type.startsWith('WORKSPACE_TOOL_'));
      expect(switches.filter((event) => event.metadata.tool === 'DOCUMENTS').map((event) => event.type)).toEqual(['WORKSPACE_TOOL_ENABLED', 'WORKSPACE_TOOL_ENABLED', 'WORKSPACE_TOOL_DISABLED', 'WORKSPACE_TOOL_ENABLED']);
      // Enabling what is already on records nothing.
      await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
      expect(events().filter((event) => event.type.startsWith('WORKSPACE_TOOL_'))).toHaveLength(4);
    });

    it('re-checks the switch inside a write', async () => {
      const water = await folder('Water');
      // Switched off between the use-case's check and the write: the repository refuses.
      const racing: DocumentDeps = {
        ...deps,
        tools: { ...deps.tools, enabled: async () => ['DOCUMENTS'] },
      };
      await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
      await expect(renameFolder(racing, { ...ref(uma), folderId: water.id, name: 'Acqua', expectedRevision: 1 })).rejects.toThrow(ToolNotEnabledError);
      await expect(createFolder(racing, { ...ref(uma), name: 'Gas', parentId: null })).rejects.toThrow(ToolNotEnabledError);
    });
  });

  it("the user's example: a Water folder, three photos as one bill, in order, with its date, each original downloadable", async () => {
    const water = await folder('Water');
    const [p1, p2, p3] = [await upload('IMG_0001.jpg'), await upload('IMG_0002.jpg'), await upload('IMG_0003.jpg')];
    const bill = await createDocument(deps, { ...ref(uma), folderId: water.id, content: { title: 'Water bill March' }, fileIds: [p1.id, p2.id, p3.id] });
    expect(bill).toMatchObject({ title: 'Water bill March', folderId: water.id, files: 3, type: null, documentDate: null, year: null, notes: '', tags: [], uploadedByName: 'Uma', modifiedByName: 'Uma', revision: 1 });
    expect(bill.pages.map((page) => page.originalName)).toEqual(['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg']);
    expect(bill.cover).toEqual({ fileId: p1.id, hasThumbnail: true });
    const ordered = await setDocumentFiles(deps, { ...ref(uma), documentId: bill.id, fileIds: [p2.id, p1.id, p3.id], expectedRevision: 1 });
    const dated = await updateDocument(deps, { ...ref(uma), documentId: bill.id, expectedRevision: ordered.revision, content: { title: 'Water bill March', documentDate: '2026-03-12', year: 2026, type: { builtIn: 'bill' } } });
    // Another member sees the same order, and a guest downloads every original.
    const seen = await getDocument(deps, { ...ref(gus), documentId: bill.id });
    expect(seen.pages.map((page) => page.originalName)).toEqual(['IMG_0002.jpg', 'IMG_0001.jpg', 'IMG_0003.jpg']);
    expect(seen).toMatchObject({ documentDate: '2026-03-12', year: 2026, type: { kind: 'builtin', key: 'bill' }, revision: dated.revision });
    for (const page of seen.pages) expect((await openOriginal(fileDeps, { ...ref(gus), fileId: page.id })).bytes).toBeGreaterThan(0);
    expect((await findDocuments(deps, { ...ref(gus), query: { folder: water.id } })).documents.map((each) => each.title)).toEqual(['Water bill March']);
    expect((await listFolders(deps, ref(gus))).find((each) => each.id === water.id)?.documents).toBe(1);
    expect(events().filter((event) => event.subject === 'document').map((event) => [event.type, event.actor])).toEqual([
      ['DOCUMENT_CREATED', 'Uma'],
      ['DOCUMENT_FILES_CHANGED', 'Uma'],
      ['DOCUMENT_UPDATED', 'Uma'],
    ]);
    expect(events('DOCUMENT_FILES_CHANGED')[0]?.metadata).toMatchObject({ added: 0, removed: 0, reordered: true, files: 3 });
    expect(events('DOCUMENT_UPDATED')[0]?.metadata).toMatchObject({ changed: ['typeKey', 'documentDate', 'year'] });
  });

  describe('Folders', () => {
    it('nests, keeps sibling names unique without case, and renames with a revision', async () => {
      const water = await folder('Water');
      const year = await folder('2026', water.id);
      expect(year).toMatchObject({ parentId: water.id, name: '2026', revision: 1 });
      await expect(folder('water')).rejects.toThrow(NameTakenError);
      await folder('2026'); // the same name elsewhere is fine
      await expect(folder('x', '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).rejects.toThrow(FolderNotFoundError);
      const renamed = await renameFolder(deps, { ...ref(eddie), folderId: water.id, name: 'Acqua', expectedRevision: 1 });
      expect(renamed).toMatchObject({ name: 'Acqua', revision: 2 });
      await expect(renameFolder(deps, { ...ref(uma), folderId: water.id, name: 'H2O', expectedRevision: 1 })).rejects.toThrow(DocumentConflictError);
      await expect(renameFolder(deps, { ...ref(uma), folderId: year.id, name: '2026', expectedRevision: 1 })).resolves.toMatchObject({ revision: 2 }); // its own name is not "taken"
      expect(events('FOLDER_RENAMED')[0]?.metadata).toEqual({ from: 'Water', to: 'Acqua' });
    });

    it('moves a Folder with its subtree, and refuses a move into itself or a descendant — also in the database', async () => {
      const water = await folder('Water');
      const year = await folder('2026', water.id);
      const quarter = await folder('Q1', year.id);
      const insurance = await folder('Insurance');
      for (const target of [water.id, year.id, quarter.id]) {
        const refused = await moveFolder(deps, { ...ref(uma), folderId: water.id, parentId: target, expectedRevision: 1 }).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(FolderMoveRefusedError);
        expect((refused as FolderMoveRefusedError).code).toBe('cycle');
      }
      const moved = await moveFolder(deps, { ...ref(uma), folderId: year.id, parentId: insurance.id, expectedRevision: 1 });
      expect(moved.parentId).toBe(insurance.id);
      expect((await listFolders(deps, ref(gus))).find((each) => each.id === quarter.id)?.parentId).toBe(year.id); // the subtree came along
      await folder('2026', water.id);
      await expect(moveFolder(deps, { ...ref(uma), folderId: year.id, parentId: water.id, expectedRevision: 2 })).rejects.toThrow(NameTakenError);
      await expect(moveFolder(deps, { ...ref(uma), folderId: year.id, parentId: null, expectedRevision: 1 })).rejects.toThrow(DocumentConflictError);
      // The database guard, should application code ever miss it.
      expect(() => database.sqlite.prepare('UPDATE document_folders SET parent_id = ? WHERE id = ?').run(quarter.id, insurance.id)).toThrow('a folder cannot be moved into itself');
      expect(() => database.sqlite.prepare('UPDATE document_folders SET parent_id = id WHERE id = ?').run(water.id)).toThrow();
    });

    it('refuses an eleventh level, counting what moves along', async () => {
      let parent: string | null = null;
      for (let level = 1; level <= 10; level++) parent = (await folder(`L${level}`, parent)).id;
      const tooDeep = await folder('L11', parent).catch((error: unknown) => error);
      expect((tooDeep as FolderMoveRefusedError).code).toBe('too_deep');
      const pair = await folder('Pair');
      await folder('Child', pair.id);
      const levels = await listFolders(deps, ref(gus));
      const ninth = levels.find((each) => each.name === 'L9');
      expect((await moveFolder(deps, { ...ref(uma), folderId: pair.id, parentId: ninth?.id ?? null, expectedRevision: 1 }).catch((error: unknown) => error)) as FolderMoveRefusedError).toMatchObject({ code: 'too_deep' });
    });

    it('lets at most one of two concurrent moves succeed when together they would form a cycle', async () => {
      const a = await folder('A');
      const b = await folder('B');
      const second = openDatabase(database.path);
      try {
        const results = await Promise.allSettled([
          moveFolder(deps, { ...ref(uma), folderId: a.id, parentId: b.id, expectedRevision: 1 }),
          moveFolder(on(second), { ...ref(eddie), folderId: b.id, parentId: a.id, expectedRevision: 1 }),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        const tree = await listFolders(deps, ref(gus));
        expect(tree.filter((each) => each.parentId === null)).toHaveLength(1); // one of them is still at the top
      } finally {
        second.close();
      }
    });
  });

  describe('Trash and restore', () => {
    it('moves a Folder with all its contents to Trash as one unit and restores the same tree', async () => {
      const water = await folder('Water');
      const year = await folder('2026', water.id);
      const bill = await document('March bill', year.id);
      const contract = await document('Contract', water.id);
      const early = await document('Deleted before', year.id);
      await deleteDocument(deps, { ...ref(uma), documentId: early.id });
      tick();
      expect(await deleteFolder(deps, { ...ref(eddie), folderId: water.id })).toEqual({ folders: 1, documents: 2 });
      expect(await names()).toEqual([]);
      await expect(getDocument(deps, { ...ref(gus), documentId: bill.id })).rejects.toThrow(DocumentNotFoundError);
      await expect(findDocuments(deps, { ...ref(gus), query: { folder: water.id } })).rejects.toThrow(FolderNotFoundError);
      await expect(deleteFolder(deps, { ...ref(uma), folderId: water.id })).rejects.toThrow(FolderNotFoundError);
      const trash = await listDocumentTrash(deps, { ...ref(uma), within: null });
      expect(trash.map((entry) => [entry.kind, entry.name, entry.deletedByName, entry.folders, entry.documents])).toEqual([
        ['folder', 'Water', 'Eddie', 1, 2],
        ['document', 'Deleted before', 'Uma', 0, 0],
      ]);
      expect((await listDocumentTrash(deps, { ...ref(uma), within: water.id })).map((entry) => [entry.kind, entry.name, entry.location])).toEqual([
        ['folder', '2026', ['Water']],
        ['document', 'Contract', ['Water']],
      ]);
      // Files of Documents in Trash stay: Trash is not deletion.
      now = new Date(now.getTime() + 3 * DOCUMENT_FILE_PENDING_MS);
      expect((await purgeUnusedDocumentFiles(fileDeps)).files).toBe(0);

      const outcome = await restoreFolder(deps, { ...ref(uma), folderId: water.id });
      expect(outcome).toEqual({ folders: 1, documents: 2 });
      expect(await names()).toEqual(['2026', 'Water']);
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).folderId).toBe(year.id);
      expect((await getDocument(deps, { ...ref(gus), documentId: contract.id })).pages).toHaveLength(1);
      // What was deleted separately before stays in Trash.
      await expect(getDocument(deps, { ...ref(gus), documentId: early.id })).rejects.toThrow(DocumentNotFoundError);
      expect((await listDocumentTrash(deps, { ...ref(uma), within: null })).map((entry) => entry.name)).toEqual(['Deleted before']);
      expect(events('FOLDER_DELETED')[0]?.metadata).toEqual({ name: 'Water', folders: 1, documents: 2 });
      expect(events('FOLDER_RESTORED')[0]?.metadata).toMatchObject({ name: 'Water', folders: 1, documents: 2, moved: false, renamed: false });
    });

    it('renames a restored Folder when its name was taken meanwhile, and merges nothing', async () => {
      const water = await folder('Water');
      await document('Old bill', water.id);
      await deleteFolder(deps, { ...ref(uma), folderId: water.id });
      const replacement = await folder('Water');
      await document('New bill', replacement.id);
      expect(await restoreFolder(deps, { ...ref(uma), folderId: water.id })).toEqual({ folders: 0, documents: 1, renamedTo: 'Water (restored)' });
      expect(await names()).toEqual(['Water', 'Water (restored)']);
      expect((await findDocuments(deps, { ...ref(gus), query: { folder: replacement.id } })).documents.map((each) => each.title)).toEqual(['New bill']);
      expect((await findDocuments(deps, { ...ref(gus), query: { folder: water.id } })).documents.map((each) => each.title)).toEqual(['Old bill']);
    });

    it('restores a sub-folder or a Document out of a trashed Folder into the nearest place that exists, and says so', async () => {
      const water = await folder('Water');
      const year = await folder('2026', water.id);
      const quarter = await folder('Q1', year.id);
      const bill = await document('March bill', quarter.id);
      const other = await document('Meter photo', year.id);
      await deleteFolder(deps, { ...ref(uma), folderId: water.id });
      // Only "2026" — "Water" stays in Trash: it goes to the top level.
      expect(await restoreFolder(deps, { ...ref(uma), folderId: year.id })).toEqual({ folders: 1, documents: 2, movedTo: { id: null, name: null, because: 'Water' } });
      const tree = await listFolders(deps, ref(gus));
      expect(tree.map((each) => [each.name, each.parentId])).toEqual([
        ['2026', null],
        ['Q1', year.id],
      ]);
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).folderId).toBe(quarter.id);
      // Restoring the parent later does not move it again.
      expect(await restoreFolder(deps, { ...ref(uma), folderId: water.id })).toEqual({ folders: 0, documents: 0 });
      expect((await listFolders(deps, ref(gus))).find((each) => each.id === year.id)?.parentId).toBeNull();

      // A single Document out of a trashed Folder: to the nearest Folder that still exists.
      await deleteFolder(deps, { ...ref(uma), folderId: quarter.id });
      expect(await restoreDocument(deps, { ...ref(uma), documentId: bill.id })).toEqual({ folders: 0, documents: 1, movedTo: { id: year.id, name: '2026', because: 'Q1' } });
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).folderId).toBe(year.id);
      await deleteDocument(deps, { ...ref(uma), documentId: other.id });
      expect(await restoreDocument(deps, { ...ref(uma), documentId: other.id })).toEqual({ folders: 0, documents: 1 }); // back where it was
      await expect(restoreDocument(deps, { ...ref(uma), documentId: other.id })).rejects.toThrow(DocumentNotFoundError); // not in Trash
      await expect(restoreFolder(deps, { ...ref(uma), folderId: year.id })).rejects.toThrow(FolderNotFoundError);
      await expect(listDocumentTrash(deps, { ...ref(uma), within: year.id })).rejects.toThrow(FolderNotFoundError);
    });

    it('never deletes by itself: there is no expiry, and the database refuses to delete what is not in Trash', async () => {
      const water = await folder('Water');
      const bill = await document('Bill', water.id);
      const live = await document('Live');
      const kept = await folder('Kept');
      await deleteFolder(deps, { ...ref(uma), folderId: water.id });
      now = new Date(now.getTime() + 400 * 86_400_000); // more than a year later
      await purgeUnusedDocumentFiles(fileDeps);
      expect((await listDocumentTrash(deps, { ...ref(uma), within: null })).map((entry) => entry.name)).toEqual(['Water']);
      expect((await openOriginal(fileDeps, { ...ref(gus), fileId: bill.pages[0]?.id ?? '' })).bytes).toBeGreaterThan(0);
      // Permanent deletion (16.4) is an explicit act of a Workspace admin, out of Trash — see storage-use-cases.test.ts.
      expect(() => database.sqlite.prepare('DELETE FROM documents WHERE id = ?').run(live.id)).toThrow('only from Trash');
      expect(() => database.sqlite.prepare('DELETE FROM document_folders WHERE id = ?').run(kept.id)).toThrow('only from Trash');
    });
  });

  describe('Documents', () => {
    it('keeps "uploaded" for ever and sets "last modified" to whoever edits', async () => {
      const bill = await document('Bill');
      const uploadedAt = bill.uploadedAt.getTime();
      tick();
      const edited = await updateDocument(deps, { ...ref(eddie), documentId: bill.id, expectedRevision: 1, content: { title: 'Water bill', notes: 'paid', tags: ['Water'] } });
      expect(edited).toMatchObject({ title: 'Water bill', notes: 'paid', tags: ['Water'], uploadedByName: 'Uma', modifiedByName: 'Eddie', revision: 2 });
      expect(edited.uploadedAt.getTime()).toBe(uploadedAt);
      expect(edited.modifiedAt.getTime()).toBe(now.getTime());
      tick();
      const extra = await upload('receipt.jpg', eddie);
      const withReceipt = await setDocumentFiles(deps, { ...ref(eddie), documentId: bill.id, fileIds: [bill.pages[0]?.id ?? '', extra.id], expectedRevision: 2 });
      expect(withReceipt.uploadedAt.getTime()).toBe(uploadedAt);
      expect(withReceipt.modifiedAt.getTime()).toBe(now.getTime());
      expect(() => database.sqlite.prepare('UPDATE documents SET created_at = 1 WHERE id = ?').run(bill.id)).toThrow('document upload facts are immutable');
      expect(() => database.sqlite.prepare("UPDATE documents SET created_by_display_name = 'Mallory' WHERE id = ?").run(bill.id)).toThrow('document upload facts are immutable');
      // The audit event names the changed fields, never the notes.
      expect(events('DOCUMENT_UPDATED')[0]?.metadata).toEqual({ title: 'Water bill', changed: ['title', 'notes', 'tags'] });
      expect(JSON.stringify(events())).not.toContain('paid');
    });

    it('refuses a stale edit instead of overwriting', async () => {
      const bill = await document('Bill', null, 2);
      await updateDocument(deps, { ...ref(uma), documentId: bill.id, expectedRevision: 1, content: { title: 'Bill A' } });
      await expect(updateDocument(deps, { ...ref(eddie), documentId: bill.id, expectedRevision: 1, content: { title: 'Bill B' } })).rejects.toThrow(DocumentConflictError);
      await expect(setDocumentFiles(deps, { ...ref(eddie), documentId: bill.id, fileIds: [bill.pages[1]?.id ?? ''], expectedRevision: 1 })).rejects.toThrow(DocumentConflictError);
      expect(await getDocument(deps, { ...ref(gus), documentId: bill.id })).toMatchObject({ title: 'Bill A', files: 2 });
    });

    it('adds, removes and reorders pages; a file belongs to one Document of its own Workspace', async () => {
      const bill = await document('Bill', null, 2);
      const [first, second] = bill.pages.map((page) => page.id) as string[] as [string, string];
      const extra = await upload('page-3.jpg');
      const three = await setDocumentFiles(deps, { ...ref(uma), documentId: bill.id, fileIds: [extra.id, second, first], expectedRevision: 1 });
      expect(three.pages.map((page) => page.id)).toEqual([extra.id, second, first]);
      const two = await setDocumentFiles(deps, { ...ref(uma), documentId: bill.id, fileIds: [first, extra.id], expectedRevision: 2 });
      expect(two.pages.map((page) => page.id)).toEqual([first, extra.id]);
      expect(events('DOCUMENT_FILES_CHANGED').map((event) => event.metadata)).toEqual([
        { title: 'Bill', added: 1, removed: 0, reordered: true, files: 3 },
        { title: 'Bill', added: 0, removed: 1, reordered: true, files: 2 },
      ]);
      await expect(setDocumentFiles(deps, { ...ref(uma), documentId: bill.id, fileIds: [], expectedRevision: 3 })).rejects.toThrow(DomainValidationError);
      // Another Document cannot take a page of this one; a file of another Workspace or an unknown one is "not found".
      await expect(createDocument(deps, { ...ref(uma), folderId: null, content: { title: 'Thief' }, fileIds: [first] })).rejects.toThrow(FileInUseError);
      const foreign = await upload('office.jpg', otto, office);
      await expect(createDocument(deps, { ...ref(uma), folderId: null, content: { title: 'Thief' }, fileIds: [foreign.id] })).rejects.toThrow(DocumentFileNotFoundError);
      await expect(setDocumentFiles(deps, { ...ref(uma), documentId: bill.id, fileIds: [first, foreign.id], expectedRevision: 3 })).rejects.toThrow(DocumentFileNotFoundError);
      expect((await findDocuments(deps, { ...ref(gus), query: { folder: 'top' } })).documents.map((each) => each.title)).toEqual(['Bill']); // nothing half-created
      // A page taken out of its Document is an unused upload again: housekeeping removes it; pages stay.
      now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 60_000);
      expect((await purgeUnusedDocumentFiles(fileDeps)).files).toBeGreaterThan(0);
      await expect(getDocumentFile(fileDeps, { ...ref(gus), fileId: second })).rejects.toThrow(DocumentFileNotFoundError);
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).pages.map((page) => page.id)).toEqual([first, extra.id]);
      expect((await openOriginal(fileDeps, { ...ref(gus), fileId: first })).bytes).toBeGreaterThan(0);
    });

    it('moves Documents between Folders, all or nothing, keeping everything else', async () => {
      const water = await folder('Water');
      const gas = await folder('Gas');
      const [a, b] = [await document('A', water.id), await document('B', water.id)];
      expect(await moveDocuments(deps, { ...ref(uma), documentIds: [a.id, b.id], folderId: gas.id })).toBe(2);
      expect(await moveDocuments(deps, { ...ref(uma), documentIds: [a.id], folderId: gas.id })).toBe(0); // already there
      await expect(moveDocuments(deps, { ...ref(uma), documentIds: [a.id, '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f'], folderId: null })).rejects.toThrow(DocumentNotFoundError);
      expect((await getDocument(deps, { ...ref(gus), documentId: a.id })).folderId).toBe(gas.id); // the first was not moved either
      await expect(moveDocuments(deps, { ...ref(uma), documentIds: [a.id], folderId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' })).rejects.toThrow(FolderNotFoundError);
      await expect(moveDocuments(deps, { ...ref(uma), documentIds: [], folderId: null })).rejects.toThrow(DomainValidationError);
      expect(await moveDocuments(deps, { ...ref(uma), documentIds: [b.id], folderId: null })).toBe(1);
      expect(await getDocument(deps, { ...ref(gus), documentId: b.id })).toMatchObject({ folderId: null, files: 1, uploadedByName: 'Uma' });
      expect(events('DOCUMENT_MOVED')).toHaveLength(3);
    });

    it('has built-in types and custom ones that can be added, used, renamed and retired', async () => {
      expect((await listDocumentTypes(deps, ref(gus))).builtIn).toEqual(['bill', 'receipt', 'contract', 'tax_notice', 'manual', 'warranty', 'inspection_report', 'correspondence']);
      const minutes = await createDocumentType(deps, { ...ref(uma), name: 'Condominium minutes' });
      await expect(createDocumentType(deps, { ...ref(uma), name: 'condominium MINUTES' })).rejects.toThrow(NameTakenError);
      const meeting = await createDocument(deps, { ...ref(uma), folderId: null, content: { title: 'Meeting 2026', type: { customId: minutes.id } }, fileIds: [(await upload('m.jpg')).id] });
      expect(meeting.type).toEqual({ kind: 'custom', id: minutes.id, name: 'Condominium minutes', retired: false });
      await renameDocumentType(deps, { ...ref(eddie), typeId: minutes.id, name: 'Assembly minutes' });
      expect((await getDocument(deps, { ...ref(gus), documentId: meeting.id })).type).toMatchObject({ name: 'Assembly minutes' });
      expect(await retireDocumentType(deps, { ...ref(uma), typeId: minutes.id })).toMatchObject({ retired: true });
      // Retired: stays on the old Document (also through an edit), is not accepted for a new one.
      expect((await updateDocument(deps, { ...ref(uma), documentId: meeting.id, expectedRevision: 1, content: { title: 'Meeting March 2026', type: { customId: minutes.id } } })).type).toMatchObject({ retired: true });
      await expect(createDocument(deps, { ...ref(uma), folderId: null, content: { title: 'New', type: { customId: minutes.id } }, fileIds: [(await upload('n.jpg')).id] })).rejects.toThrow(DocumentTypeNotFoundError);
      await expect(renameDocumentType(deps, { ...ref(uma), typeId: minutes.id, name: 'Again' })).rejects.toThrow(DocumentTypeNotFoundError);
      expect((await listDocumentTypes(deps, ref(gus))).custom).toEqual([{ id: minutes.id, name: 'Assembly minutes', retired: true }]);
      await createDocumentType(deps, { ...ref(uma), name: 'Assembly minutes' }); // the name is free again
      // A type of another Workspace is not a type here.
      const foreign = await createDocumentType(deps, { ...ref(otto, office), name: 'Payroll' });
      await expect(updateDocument(deps, { ...ref(uma), documentId: meeting.id, expectedRevision: 2, content: { title: 'x', type: { customId: foreign.id } } })).rejects.toThrow(DocumentTypeNotFoundError);
      expect(events().filter((event) => event.subject === 'document_type').map((event) => event.type)).toEqual(['DOCUMENT_TYPE_CREATED', 'DOCUMENT_TYPE_RENAMED', 'DOCUMENT_TYPE_RETIRED', 'DOCUMENT_TYPE_CREATED', 'DOCUMENT_TYPE_CREATED']);
    });
  });

  describe('permissions and isolation', () => {
    it('lets a GUEST read everything and write nothing', async () => {
      const water = await folder('Water');
      const bill = await document('Bill', water.id);
      const type = await createDocumentType(deps, { ...ref(uma), name: 'Minutes' });
      expect(await names(gus)).toEqual(['Water']);
      expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).title).toBe('Bill');
      const file = (await upload('spare.jpg')).id;
      const writes: (() => Promise<unknown>)[] = [
        () => createFolder(deps, { ...ref(gus), name: 'Mine', parentId: null }),
        () => renameFolder(deps, { ...ref(gus), folderId: water.id, name: 'Mine', expectedRevision: 1 }),
        () => moveFolder(deps, { ...ref(gus), folderId: water.id, parentId: null, expectedRevision: 1 }),
        () => deleteFolder(deps, { ...ref(gus), folderId: water.id }),
        () => restoreFolder(deps, { ...ref(gus), folderId: water.id }),
        () => createDocument(deps, { ...ref(gus), folderId: null, content: { title: 'Mine' }, fileIds: [file] }),
        () => updateDocument(deps, { ...ref(gus), documentId: bill.id, expectedRevision: 1, content: { title: 'Mine' } }),
        () => setDocumentFiles(deps, { ...ref(gus), documentId: bill.id, fileIds: [file], expectedRevision: 1 }),
        () => moveDocuments(deps, { ...ref(gus), documentIds: [bill.id], folderId: null }),
        () => deleteDocument(deps, { ...ref(gus), documentId: bill.id }),
        () => restoreDocument(deps, { ...ref(gus), documentId: bill.id }),
        () => createDocumentType(deps, { ...ref(gus), name: 'Mine' }),
        () => renameDocumentType(deps, { ...ref(gus), typeId: type.id, name: 'Mine' }),
        () => retireDocumentType(deps, { ...ref(gus), typeId: type.id }),
        () => listDocumentTrash(deps, { ...ref(gus), within: null }),
      ];
      for (const attempt of writes) await expect(attempt()).rejects.toThrow(NotAuthorizedError);
      expect(await getDocument(deps, { ...ref(gus), documentId: bill.id })).toMatchObject({ title: 'Bill', revision: 1, folderId: water.id });
    });

    it('resolves nothing of another Workspace, whichever way the ids are combined', async () => {
      const water = await folder('Water');
      const bill = await document('Bill', water.id);
      const type = await createDocumentType(deps, { ...ref(uma), name: 'Minutes' });
      // Otto is no member of Home …
      await expect(listFolders(deps, ref(otto))).rejects.toThrow(WorkspaceNotFoundError);
      await expect(getDocument(deps, { ...ref(otto), documentId: bill.id })).rejects.toThrow(WorkspaceNotFoundError);
      // … and Home's ids under his own Workspace are nothing.
      const mine = ref(otto, office);
      await expect(getDocument(deps, { ...mine, documentId: bill.id })).rejects.toThrow(DocumentNotFoundError);
      await expect(findDocuments(deps, { ...mine, query: { folder: water.id } })).rejects.toThrow(FolderNotFoundError);
      await expect(createFolder(deps, { ...mine, name: 'Inside', parentId: water.id })).rejects.toThrow(FolderNotFoundError);
      await expect(renameFolder(deps, { ...mine, folderId: water.id, name: 'Taken', expectedRevision: 1 })).rejects.toThrow(FolderNotFoundError);
      await expect(deleteFolder(deps, { ...mine, folderId: water.id })).rejects.toThrow(FolderNotFoundError);
      await expect(updateDocument(deps, { ...mine, documentId: bill.id, expectedRevision: 1, content: { title: 'Taken' } })).rejects.toThrow(DocumentNotFoundError);
      await expect(deleteDocument(deps, { ...mine, documentId: bill.id })).rejects.toThrow(DocumentNotFoundError);
      await expect(moveDocuments(deps, { ...mine, documentIds: [bill.id], folderId: null })).rejects.toThrow(DocumentNotFoundError);
      await expect(retireDocumentType(deps, { ...mine, typeId: type.id })).rejects.toThrow(DocumentTypeNotFoundError);
      const own = await createFolder(deps, { ...mine, name: 'Payroll', parentId: null });
      await expect(moveFolder(deps, { ...mine, folderId: own.id, parentId: water.id, expectedRevision: 1 })).rejects.toThrow(FolderNotFoundError);
      const ownFile = await upload('payroll.jpg', otto, office);
      await expect(createDocument(deps, { ...mine, folderId: water.id, content: { title: 'Smuggled' }, fileIds: [ownFile.id] })).rejects.toThrow(FolderNotFoundError);
      // The database would refuse a cross-Workspace reference even if the application did not.
      expect(() => database.sqlite.prepare('UPDATE document_folders SET parent_id = ? WHERE id = ?').run(water.id, own.id)).toThrow();
      expect(() => database.sqlite.prepare('UPDATE documents SET folder_id = ? WHERE id = ?').run(own.id, bill.id)).toThrow();
      expect(await getDocument(deps, { ...ref(gus), documentId: bill.id })).toMatchObject({ title: 'Bill', revision: 1, folderId: water.id });
      expect((await listDocumentTrash(deps, { ...mine, within: null })).length).toBe(0);
    });

    it('re-checks the role inside the write, and writes nothing without its audit event', async () => {
      const users = createUserRepository(database);
      const water = await folder('Water');
      // Demoted after the use-case's check: the repository reads the membership again.
      const demoting: DocumentDeps = {
        ...deps,
        tools: {
          ...deps.tools,
          enabled: async (workspaceId) => {
            await changeMemberRole({ users, workspaces: deps.workspaces, clock }, { actor: admin, workspaceId: home.id, userId: uma.id, role: 'GUEST' });
            return deps.tools.enabled(workspaceId);
          },
        },
      };
      await expect(renameFolder(demoting, { ...ref(uma), folderId: water.id, name: 'Mine', expectedRevision: 1 })).rejects.toThrow(NotAuthorizedError);
      expect(await names()).toEqual(['Water']);
      // The change and its audit event are one transaction.
      database.sqlite.exec("CREATE TRIGGER audit_fails BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      await expect(renameFolder(deps, { ...ref(eddie), folderId: water.id, name: 'Acqua', expectedRevision: 1 })).rejects.toThrow('audit unavailable');
      await expect(deleteFolder(deps, { ...ref(eddie), folderId: water.id })).rejects.toThrow('audit unavailable');
      await expect(createFolder(deps, { ...ref(eddie), name: 'Gas', parentId: null })).rejects.toThrow('audit unavailable');
      const file = await upload('a.jpg', eddie);
      await expect(createDocument(deps, { ...ref(eddie), folderId: water.id, content: { title: 'Bill' }, fileIds: [file.id] })).rejects.toThrow('audit unavailable');
      expect(await listFolders(deps, ref(gus))).toEqual([{ id: water.id, parentId: null, name: 'Water', revision: 1, documents: 0 }]);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM documents').get()).toEqual({ n: 0 });
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_pages').get()).toEqual({ n: 0 });
    });
  });
});

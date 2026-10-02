import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_PENDING_MS,
  DocumentFileNotFoundError,
  DocumentNotFoundError,
  ExportRunningError,
  ExportTooLargeError,
  FolderNotFoundError,
  NotAuthorizedError,
  StorageFullError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  checkDocumentExport,
  createDocument,
  createFolder,
  createPreviewQueue,
  createWorkspace,
  deleteDocument,
  deleteFolder,
  exportDocuments,
  findDocuments,
  imageUsage,
  listDocumentTrash,
  listWorkspaceStorage,
  openOriginal,
  purgeDocumentTrash,
  purgeUnusedDocumentFiles,
  removeMember,
  restoreDocument,
  restoreFolder,
  setWorkspaceStorageCeiling,
  setWorkspaceStorageLimit,
  setWorkspaceTool,
  uploadDocumentFile,
  uploadStepImage,
  workspaceStorage,
  type DocumentExport,
  type DocumentExportDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type ImageDeps,
  type StorageDeps,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore, createFileMediaStore } from '@vergissmeinnicht/media';
import { openDatabase } from './connection.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createImageRepository } from './image-repository.ts';
import { createStorageRepository } from './storage-usage.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const PREVIEW = 100;
const THUMBNAIL = 20;
let serial = 0;
/** Distinct bytes of a given size. */
const bytesOf = (size: number, label = 'file') => {
  const data = new Uint8Array(size);
  data.set(new TextEncoder().encode(`${label} ${++serial} `).subarray(0, size));
  return data;
};
/** Every file is a one-page image; its preview and thumbnail are distinct per file and of a fixed size. */
const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async () => ({ jpeg: bytesOf(PREVIEW, 'preview'), width: 1800, height: 2400 }),
  thumbnail: async () => ({ jpeg: bytesOf(THUMBNAIL, 'thumb'), width: 300, height: 400 }),
};
const DERIVED = PREVIEW + THUMBNAIL;

describe('Workspace storage, export and permanent deletion (16.4)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let docs: DocumentExportDeps;
  let files: DocumentFileDeps;
  let images: ImageDeps;
  let storage: StorageDeps;
  let admin: User;
  let eddie: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  const clock = { now: () => now };
  const tick = () => (now = new Date(now.getTime() + 60_000));
  const ref = (actor: User, workspace = home) => ({ actor, workspaceId: workspace.id });
  const depsOn = (db: Pick<typeof database, 'db'>) => {
    const workspaces = createWorkspaceRepository(db);
    const tools = createWorkspaceToolRepository(db);
    const fileRepository = createDocumentFileRepository(db);
    const store = createDocumentFileStore(join(dir, 'documents'));
    return {
      docs: { workspaces, tools, documents: createDocumentRepository(db), store, clock } satisfies DocumentExportDeps,
      files: { workspaces, tools, files: fileRepository, store, processor, clock, previews: createPreviewQueue({ files: fileRepository, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] as const }) } satisfies DocumentFileDeps,
      images: { workspaces, images: createImageRepository(db), store: createFileMediaStore(join(dir, 'media')), processor: { process: async (input: Uint8Array) => ({ jpeg: input, width: 800, height: 600 }) }, clock } satisfies ImageDeps,
      storage: { workspaces, storage: createStorageRepository(db), clock } satisfies StorageDeps,
    };
  };
  const uploadFile = async (size: number, name = 'scan.jpg', actor = uma, workspace = home, on = files) =>
    (
      await uploadDocumentFile(on, {
        actor,
        workspaceId: workspace.id,
        name,
        source: (async function* () {
          yield bytesOf(size);
        })(),
      })
    ).file;
  const document = async (title: string, folderId: string | null = null, sizes: number[] = [1000], actor = uma, workspace = home, names?: string[]) => {
    tick();
    const fileIds = [];
    for (const [index, size] of sizes.entries()) fileIds.push((await uploadFile(size, names?.[index] ?? `${title}-${index + 1}.jpg`, actor, workspace)).id);
    return createDocument(docs, { ...ref(actor, workspace), folderId, content: { title }, fileIds });
  };
  const folder = (name: string, parentId: string | null = null, actor = uma, workspace = home) => createFolder(docs, { ...ref(actor, workspace), name, parentId });
  const image = (size: number, actor = eddie, workspace = home, on = images) => uploadStepImage(on, { actor, workspaceId: workspace.id, bytes: bytesOf(size, 'image') });
  const usage = (workspace = home) => workspaceStorage(storage, { actor: workspace === home ? admin : otto, workspaceId: workspace.id });
  const setCeilingRaw = (bytes: number, workspace = home) => database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = ? WHERE id = ?').run(bytes, workspace.id);
  const trashNames = async (workspace = home, actor = uma) => (await listDocumentTrash(docs, { ...ref(actor, workspace), within: null })).map((entry) => entry.name).sort();
  const liveTitles = async () => (await findDocuments(docs, { ...ref(gus), query: {} })).documents.map((each) => each.title).sort();
  const audit = (type: string) =>
    (database.sqlite.prepare('SELECT actor_display_name AS actor, subject_type AS subject, subject_id AS id, metadata FROM audit_events WHERE type = ? ORDER BY rowid').all(type) as { actor: string; subject: string; id: string; metadata: string }[]).map((event) => ({
      ...event,
      metadata: JSON.parse(event.metadata) as Record<string, unknown>,
    }));
  const rows = (table: string) => (database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  const code = async (run: Promise<unknown>) => run.then(
    () => undefined,
    (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : (caught as Error).name),
  );
  /** Runs an export and returns what the archive would be written from. */
  const exported = async (request: { folder?: string; documents?: string[] }, actor = gus, workspace = home, on = docs): Promise<DocumentExport> => {
    let archive: DocumentExport | undefined;
    await exportDocuments(on, { ...ref(actor, workspace), request }, async (given) => {
      archive = given;
    });
    if (archive === undefined) throw new Error('nothing was delivered');
    return archive;
  };
  const read = async (stream: AsyncIterable<Uint8Array>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-storage-'));
    now = new Date('2026-10-02T08:00:00Z');
    ({ docs, files, images, storage } = depsOn(database));
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const user = (email: string, name: string, serverAdmin = false) => users.create({ email: normalizeEmail(email), displayName: name, emailVerified: true, status: 'ACTIVE', serverAdmin });
    admin = await user('admin@example.org', 'Ada', true);
    eddie = await user('eddie@example.org', 'Eddie');
    uma = await user('uma@example.org', 'Uma');
    gus = await user('gus@example.org', 'Gus');
    otto = await user('otto@example.org', 'Otto');
    home = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Home' });
    // Otto administers the Office; the server admin is no member there.
    office = await createWorkspace({ users, workspaces, clock }, { actor: admin, name: 'Office' });
    for (const [member, role] of [
      [eddie, 'EDITOR'],
      [uma, 'USER'],
      [gus, 'GUEST'],
    ] as const) {
      await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, email: member.email, role });
    }
    await addMember({ users, workspaces, clock }, { actor: admin, workspaceId: office.id, email: otto.email, role: 'ADMIN' });
    await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
    await setWorkspaceTool(docs, { ...ref(otto, office), tool: 'DOCUMENTS', enabled: true });
  });
  afterEach(() => {
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('one combined storage limit', () => {
    it('gives a new Workspace 5 GB without configuration, and sets nothing aside', async () => {
      expect(await usage()).toEqual({ images: 0, originals: 0, previews: 0, trash: 0, retained: 0, used: 0, limit: 5_000_000_000, ceiling: 5_000_000_000, ownLimit: null });
      // A limit is a number, not disk space: creating the Workspace wrote no file anywhere.
      expect(existsSync(join(dir, 'documents'))).toBe(false);
      expect(existsSync(join(dir, 'media'))).toBe(false);
    });

    it('counts instruction images and Documents together, by tool; Trash keeps counting until it is emptied and housekeeping ran', async () => {
      await image(3000);
      const water = await folder('Water');
      const bill = await document('Bill', water.id, [5000, 2000]);
      await document('Contract', null, [4000]);
      const before = await usage();
      expect(before).toMatchObject({ images: 3000, originals: 11_000, previews: 3 * DERIVED, trash: 0, used: 3000 + 11_000 + 3 * DERIVED });
      // An upload that is not (yet) a Document counts as well.
      await uploadFile(700);
      expect(await usage()).toMatchObject({ originals: 11_700, previews: 4 * DERIVED });

      // To Trash: the total does not change; what the Document held is shown under Trash.
      await deleteFolder(docs, { ...ref(uma), folderId: water.id });
      const inTrash = await usage();
      expect(inTrash).toMatchObject({ images: 3000, originals: 4700, previews: 2 * DERIVED, trash: 7000 + 2 * DERIVED });
      expect(inTrash.used).toBe(before.used + 700 + DERIVED);

      // Deleted for good: the records are gone at once, the bytes when housekeeping has removed the files.
      await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' });
      expect(await trashNames()).toEqual([]);
      expect((await usage()).used).toBe(inTrash.used); // still stored
      const original = await openOriginal(files, { ...ref(gus), fileId: bill.pages[0]?.id ?? '' }); // … and still there
      expect(original.bytes).toBe(5000);
      now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 60_000);
      expect((await purgeUnusedDocumentFiles(files)).files).toBe(3 * 3); // two purged files and the stray upload, each with preview and thumbnail
      await expect(openOriginal(files, { ...ref(gus), fileId: bill.pages[0]?.id ?? '' })).rejects.toThrow(DocumentFileNotFoundError);
      // The image is older than a day and used by no Step: it no longer counts either.
      expect(await usage()).toMatchObject({ images: 0, originals: 4000, previews: DERIVED, trash: 0, used: 4000 + DERIVED });
    });

    it('charges content once when a Document and one in Trash share it, and counts it as live', async () => {
      const same = bytesOf(3000);
      const put = async (title: string) => {
        tick();
        const { file } = await uploadDocumentFile(files, { ...ref(uma), name: `${title}.jpg`, source: (async function* () { yield same; })() });
        return createDocument(docs, { ...ref(uma), folderId: null, content: { title }, fileIds: [file.id] });
      };
      const first = await put('First');
      const second = await put('Copy');
      expect((await usage()).originals).toBe(3000);
      await deleteDocument(docs, { ...ref(uma), documentId: first.id });
      expect(await usage()).toMatchObject({ originals: 3000 }); // the copy is live
      await deleteDocument(docs, { ...ref(uma), documentId: second.id });
      const all = await usage();
      expect({ originals: all.originals, trashHoldsTheOriginal: all.trash >= 3000 }).toEqual({ originals: 0, trashHoldsTheOriginal: true });
    });

    it('refuses whatever does not fit — an image because of Documents, a Document because of images — and keeps reading intact', async () => {
      const kept = await document('Kept', null, [6000]);
      setCeilingRaw(6000 + DERIVED + 2500);
      await image(2000);
      const refusedImage = await image(1000).catch((error: unknown) => error);
      expect(refusedImage).toBeInstanceOf(StorageFullError);
      expect((refusedImage as StorageFullError).usage).toMatchObject({ images: 2000, originals: 6000, used: 8000 + DERIVED, limit: 8500 + DERIVED });
      await expect(uploadFile(600)).rejects.toThrow(StorageFullError);
      expect((await uploadFile(300)).bytes).toBe(300); // fits; its preview no longer does, the original is kept
      // Far below what is stored: nothing is deleted, everything is still readable, nothing new is accepted.
      setCeilingRaw(100);
      expect((await usage()).used).toBeGreaterThan(8000);
      expect((await openOriginal(files, { ...ref(gus), fileId: kept.pages[0]?.id ?? '' })).bytes).toBe(6000);
      expect((await findDocuments(docs, { ...ref(gus), query: {} })).documents).toHaveLength(1);
      await expect(image(10)).rejects.toThrow(StorageFullError);
      await expect(uploadFile(10)).rejects.toThrow(StorageFullError);
      expect((await imageUsage(images, ref(gus))).limit).toBe(100);
    });

    it('lets exactly one of two uploads through when each fits alone but not both — an image and a Document file on separate connections', async () => {
      setCeilingRaw(5000);
      const second = openDatabase(database.path);
      try {
        const other = depsOn(second);
        const results = await Promise.allSettled([image(3000), uploadFile(3000, 'scan.jpg', uma, home, other.files)]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(StorageFullError);
        expect((await usage()).used).toBeLessThanOrEqual(5000);
      } finally {
        second.close();
      }
    });

    it('lets a Workspace admin lower the limit below the ceiling, never raise it above; only the server admin sets the ceiling', async () => {
      // The Workspace's own limit: its admins only.
      for (const actor of [eddie, uma, gus]) {
        await expect(setWorkspaceStorageLimit(storage, { ...ref(actor), bytes: 1_000_000_000 })).rejects.toThrow(NotAuthorizedError);
        await expect(workspaceStorage(storage, ref(actor))).rejects.toThrow(NotAuthorizedError);
      }
      await expect(setWorkspaceStorageLimit(storage, { ...ref(otto), bytes: 1_000_000_000 })).rejects.toThrow(WorkspaceNotFoundError);
      await expect(workspaceStorage(storage, ref(otto))).rejects.toThrow(WorkspaceNotFoundError);
      await expect(workspaceStorage(storage, { actor: admin, workspaceId: office.id })).resolves.toMatchObject({ limit: 5_000_000_000 }); // the creator is a member
      expect(await setWorkspaceStorageLimit(storage, { ...ref(admin), bytes: 1_000_000_000 })).toMatchObject({ limit: 1_000_000_000, ceiling: 5_000_000_000, ownLimit: 1_000_000_000 });
      expect(await code(setWorkspaceStorageLimit(storage, { ...ref(admin), bytes: 5_000_000_001 }))).toBe('storage_limit_above_ceiling');
      expect(await code(setWorkspaceStorageLimit(storage, { ...ref(admin), bytes: 99_999_999 }))).toBe('invalid_storage_limit');
      expect(await code(setWorkspaceStorageLimit(storage, { ...ref(admin), bytes: 1.5e9 + 0.5 }))).toBe('invalid_storage_limit');
      expect((await usage()).ownLimit).toBe(1_000_000_000); // refused changes changed nothing

      // The ceiling: the server admin only — a Workspace admin who is not one cannot.
      await expect(setWorkspaceStorageCeiling(storage, { actor: otto, workspaceId: office.id, bytes: 10_000_000_000 })).rejects.toThrow(NotAuthorizedError);
      await expect(listWorkspaceStorage(storage, { actor: otto })).rejects.toThrow(NotAuthorizedError);
      expect(await code(setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 50_000_000 }))).toBe('invalid_storage_ceiling');
      expect(await code(setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 1_000_000_000_001 }))).toBe('invalid_storage_ceiling');
      // Lowered below the Workspace's own limit: the lower of the two applies; raised again, the own limit is back.
      await setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 500_000_000 });
      expect(await usage()).toMatchObject({ limit: 500_000_000, ceiling: 500_000_000, ownLimit: 1_000_000_000 });
      await setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 20_000_000_000 });
      expect(await usage()).toMatchObject({ limit: 1_000_000_000, ceiling: 20_000_000_000 });
      expect(await setWorkspaceStorageLimit(storage, { ...ref(admin), bytes: null })).toMatchObject({ limit: 20_000_000_000, ownLimit: null });
      expect((await listWorkspaceStorage(storage, { actor: admin })).map((entry) => [entry.name, entry.usage.ceiling])).toEqual([
        ['Home', 20_000_000_000],
        ['Office', 5_000_000_000],
      ]);

      // Recorded: the Workspace's limit in its audit trail, the ceiling in the security log.
      expect(audit('WORKSPACE_STORAGE_LIMIT_CHANGED').map((event) => [event.actor, event.metadata])).toEqual([
        ['Ada', { from: 0, to: 1_000_000_000, ceiling: 5_000_000_000 }],
        ['Ada', { from: 1_000_000_000, to: 0, ceiling: 20_000_000_000 }],
      ]);
      const ceilings = database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'WORKSPACE_STORAGE_CEILING_CHANGED' ORDER BY rowid").all() as { metadata: string }[];
      expect(ceilings.map((row) => JSON.parse(row.metadata))).toEqual([
        { from: 5_000_000_000, to: 500_000_000 },
        { from: 500_000_000, to: 20_000_000_000 },
      ]);
      // The database itself refuses an own limit above the ceiling.
      expect(() => database.sqlite.prepare('UPDATE workspaces SET storage_limit_bytes = storage_quota_bytes + 1 WHERE id = ?').run(home.id)).toThrow('invalid storage limit');
    });
  });

  describe('permanent deletion', () => {
    it('is for Workspace admins only, only out of Trash, and tells what it removed', async () => {
      const water = await folder('Water');
      const y2026 = await folder('2026', water.id);
      const bill = await document('Bill', y2026.id, [1000, 1000, 1000]);
      await document('Contract', water.id);
      const loose = await document('Loose');
      const live = await document('Live');
      await deleteFolder(docs, { ...ref(uma), folderId: water.id });
      await deleteDocument(docs, { ...ref(uma), documentId: loose.id });
      expect((await listDocumentTrash(docs, { ...ref(uma), within: null })).map((entry) => [entry.name, entry.folders, entry.documents, entry.files])).toEqual([
        ['Loose', 0, 0, 1],
        ['Water', 1, 2, 4],
      ]);

      // A USER restores but never deletes for good; neither does an Editor or a guest.
      for (const actor of [uma, eddie, gus]) await expect(purgeDocumentTrash(docs, { ...ref(actor), items: [{ kind: 'document', id: loose.id }] })).rejects.toThrow(NotAuthorizedError);
      for (const actor of [uma, eddie, gus]) await expect(purgeDocumentTrash(docs, { ...ref(actor), items: 'all' })).rejects.toThrow(NotAuthorizedError);
      await expect(purgeDocumentTrash(docs, { ...ref(otto), items: 'all' })).rejects.toThrow(WorkspaceNotFoundError);
      // What is not in Trash cannot be named — and nothing of a refused request is deleted.
      await expect(purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'document', id: loose.id }, { kind: 'document', id: live.id }] })).rejects.toThrow(DocumentNotFoundError);
      await expect(purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'folder', id: (await folder('Still here')).id }] })).rejects.toThrow(FolderNotFoundError);
      expect(await code(purgeDocumentTrash(docs, { ...ref(admin), items: [] }))).toBe('invalid_trash_selection');
      expect(await code(purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'document', id: loose.id }, { kind: 'document', id: loose.id }] }))).toBe('invalid_trash_selection');
      expect(await code(purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'page', id: loose.id }] }))).toBe('invalid_trash_selection');
      expect(await trashNames()).toEqual(['Loose', 'Water']);
      expect(() => database.sqlite.prepare('DELETE FROM documents WHERE id = ?').run(live.id)).toThrow('only from Trash');
      expect(() => database.sqlite.prepare("DELETE FROM document_folders WHERE name = 'Still here'").run()).toThrow('only from Trash');

      expect(await purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'document', id: loose.id }] })).toEqual({ folders: 0, documents: 1, files: 1 });
      expect(await purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'folder', id: water.id }] })).toEqual({ folders: 2, documents: 2, files: 4 });
      expect(await trashNames()).toEqual([]);
      expect(await liveTitles()).toEqual(['Live']);
      expect({ documents: rows('documents'), folders: rows('document_folders'), pages: rows('document_pages') }).toEqual({ documents: 1, folders: 1, pages: 1 });
      await expect(restoreDocument(docs, { ...ref(uma), documentId: bill.id })).rejects.toThrow(DocumentNotFoundError);
      await expect(restoreFolder(docs, { ...ref(uma), folderId: water.id })).rejects.toThrow(FolderNotFoundError);
      // Who, what and how much — never content.
      expect(audit('DOCUMENT_PURGED')).toEqual([{ actor: 'Ada', subject: 'document', id: loose.id, metadata: { title: 'Loose', files: 1 } }]);
      expect(audit('FOLDER_PURGED')).toEqual([{ actor: 'Ada', subject: 'folder', id: water.id, metadata: { name: 'Water', folders: 1, documents: 2, files: 4 } }]);
    });

    it('deletes exactly what is named: something else in Trash inside a deleted Folder stays and can still be restored', async () => {
      const water = await folder('Water');
      const y2026 = await folder('2026', water.id);
      const old = await folder('Old', y2026.id);
      const early = await document('Deleted earlier', y2026.id);
      await document('In Old', old.id);
      await document('Goes with Water', y2026.id);
      // Deleted separately, before the Folder above them.
      await deleteDocument(docs, { ...ref(uma), documentId: early.id });
      await deleteFolder(docs, { ...ref(uma), folderId: old.id });
      await deleteFolder(docs, { ...ref(uma), folderId: water.id });
      expect(await trashNames()).toEqual(['Deleted earlier', 'Old', 'Water']);

      expect(await purgeDocumentTrash(docs, { ...ref(admin), items: [{ kind: 'folder', id: water.id }] })).toEqual({ folders: 2, documents: 1, files: 1 });
      expect(await trashNames()).toEqual(['Deleted earlier', 'Old']);
      // Their Folders are gone for good: both come back at the top level, and say so.
      expect(await restoreDocument(docs, { ...ref(uma), documentId: early.id })).toMatchObject({ documents: 1 });
      expect(await restoreFolder(docs, { ...ref(uma), folderId: old.id })).toMatchObject({ folders: 0, documents: 1 });
      expect(await liveTitles()).toEqual(['Deleted earlier', 'In Old']);
      expect((await findDocuments(docs, { ...ref(gus), query: { folder: 'top' } })).documents.map((each) => each.title)).toEqual(['Deleted earlier']);
    });

    it('empties Trash in one action — this Workspace\'s only — and never by itself, however long it waits', async () => {
      const water = await folder('Water');
      await document('Bill', water.id);
      const loose = await document('Loose');
      await document('Live');
      const theirs = await document('Payroll', null, [1000], otto, office);
      await deleteFolder(docs, { ...ref(uma), folderId: water.id });
      await deleteDocument(docs, { ...ref(uma), documentId: loose.id });
      await deleteDocument(docs, { ...ref(otto, office), documentId: theirs.id });

      // No expiry: more than a year of housekeeping later everything is still in Trash, files included.
      now = new Date(now.getTime() + 400 * 86_400_000);
      await purgeUnusedDocumentFiles(files);
      expect(await trashNames()).toEqual(['Loose', 'Water']);
      expect((await usage()).trash).toBe(2 * (1000 + DERIVED));
      expect(await restoreDocument(docs, { ...ref(uma), documentId: loose.id })).toMatchObject({ documents: 1 });
      await deleteDocument(docs, { ...ref(uma), documentId: loose.id });

      // Home's ids under the Office delete nothing.
      await expect(purgeDocumentTrash(docs, { ...ref(otto, office), items: [{ kind: 'folder', id: water.id }] })).rejects.toThrow(FolderNotFoundError);
      await expect(purgeDocumentTrash(docs, { ...ref(otto, office), items: [{ kind: 'document', id: loose.id }] })).rejects.toThrow(DocumentNotFoundError);
      expect(await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' })).toEqual({ folders: 1, documents: 2, files: 2 });
      expect(await trashNames()).toEqual([]);
      expect(await liveTitles()).toEqual(['Live']);
      expect(await trashNames(office, otto)).toEqual(['Payroll']);
      expect(await purgeDocumentTrash(docs, { ...ref(admin), items: 'all' })).toEqual({ folders: 0, documents: 0, files: 0 }); // nothing left: nothing happens
      // With the tool switched off, nothing can be deleted either.
      await setWorkspaceTool(docs, { ...ref(otto, office), tool: 'DOCUMENTS', enabled: false });
      await expect(purgeDocumentTrash(docs, { ...ref(otto, office), items: 'all' })).rejects.toThrow(ToolNotEnabledError);
    });
  });

  it('re-checks who is asking inside the write: a role or admin right lost a moment ago no longer counts', async () => {
    const users = createUserRepository(database);
    const members = { users, workspaces: docs.workspaces, clock };
    const ana = await users.create({ email: normalizeEmail('ana@example.org'), displayName: 'Ana', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    await addMember(members, { actor: admin, workspaceId: home.id, email: ana.email, role: 'ADMIN' });
    const loose = await document('Loose');
    await deleteDocument(docs, { ...ref(uma), documentId: loose.id });
    const demote = (role: 'USER' | 'ADMIN') => changeMemberRole(members, { actor: admin, workspaceId: home.id, userId: ana.id, role });
    // Demoted between the use-case's check and the deleting transaction: nothing is deleted.
    const demotingTools: DocumentExportDeps = {
      ...docs,
      tools: {
        ...docs.tools,
        enabled: async (workspaceId) => {
          await demote('USER');
          return docs.tools.enabled(workspaceId);
        },
      },
    };
    await expect(purgeDocumentTrash(demotingTools, { ...ref(ana), items: 'all' })).rejects.toThrow(NotAuthorizedError);
    expect(await trashNames()).toEqual(['Loose']);
    // The same for the Workspace's own limit …
    await demote('ADMIN');
    const demotingMembership: StorageDeps = {
      ...storage,
      workspaces: {
        ...storage.workspaces,
        findMembership: async (workspaceId, userId) => {
          const membership = await storage.workspaces.findMembership(workspaceId, userId);
          await demote('USER');
          return membership;
        },
      },
    };
    await expect(setWorkspaceStorageLimit(demotingMembership, { ...ref(ana), bytes: 1_000_000_000 })).rejects.toThrow(NotAuthorizedError);
    expect((await usage()).ownLimit).toBeNull();
    // … for an export by someone who was removed meanwhile (nothing is recorded as exported) …
    const removing: DocumentExportDeps = {
      ...docs,
      tools: {
        ...docs.tools,
        enabled: async (workspaceId) => {
          await removeMember(members, { actor: admin, workspaceId: home.id, userId: ana.id });
          return docs.tools.enabled(workspaceId);
        },
      },
    };
    await expect(exported({}, ana, home, removing)).rejects.toThrow(NotAuthorizedError);
    expect(audit('DOCUMENTS_EXPORTED')).toEqual([]);
    // … and for the ceiling, when the server-admin right was taken away after the request was authenticated.
    database.sqlite.prepare('UPDATE users SET server_admin = 0 WHERE id = ?').run(admin.id);
    await expect(setWorkspaceStorageCeiling(storage, { actor: admin, workspaceId: home.id, bytes: 9_000_000_000 })).rejects.toThrow(NotAuthorizedError);
    expect((await storage.storage.usage(home.id, now))?.ceiling).toBe(5_000_000_000);
  });

  describe('export', () => {
    it("exports the user's Water folder: the originals byte-identical under Water/…, in page order, with their details", async () => {
      const water = await folder('Water');
      const y2026 = await folder('2026', water.id);
      const bill = await document('Water bill March', water.id, [3000, 3100, 3200], uma, home, ['IMG_0001.jpg', 'IMG_0002.jpg', 'IMG_0003.jpg']);
      await document('Meter reading', y2026.id, [500]);
      await document('Elsewhere');
      const trashed = await document('Thrown away', water.id);
      await deleteDocument(docs, { ...ref(uma), documentId: trashed.id });
      await document('Payroll', null, [900], otto, office);

      expect(await checkDocumentExport(docs, { ...ref(gus), request: { folder: water.id } })).toEqual({ documents: 2, files: 4, bytes: 9800 });
      const archive = await exported({ folder: water.id });
      expect(archive).toMatchObject({ workspaceName: 'Home', folderName: 'Water', scope: 'folder', exportedByName: 'Gus', size: { documents: 2, files: 4, bytes: 9800 } });
      expect(archive.documents.map((each) => [each.title, each.folderNames.join('/'), each.files.map((file) => file.path.join('/'))])).toEqual([
        ['Meter reading', 'Water/2026', ['Water/2026/Meter reading/01 - Meter reading-1.jpg']],
        ['Water bill March', 'Water', ['Water/Water bill March/01 - IMG_0001.jpg', 'Water/Water bill March/02 - IMG_0002.jpg', 'Water/Water bill March/03 - IMG_0003.jpg']],
      ]);
      // Each file is the original: the same bytes a download gives.
      const billFiles = archive.documents[1]?.files ?? [];
      for (const [index, page] of bill.pages.entries()) {
        const original = await read((await openOriginal(files, { ...ref(gus), fileId: page.id })).stream);
        expect((await read(await (billFiles[index] as (typeof billFiles)[number]).open())).equals(original)).toBe(true);
      }
      // A guest's export is the same as a member's.
      const byUser = await exported({ folder: water.id }, uma);
      expect(byUser.documents.map((each) => each.files.map((file) => [file.path, file.sha256]))).toEqual(archive.documents.map((each) => each.files.map((file) => [file.path, file.sha256])));
      // Everything: Trash and the other Workspace are not in it.
      const all = await exported({});
      expect(all.documents.map((each) => each.title)).toEqual(['Elsewhere', 'Meter reading', 'Water bill March']);
      expect(all.documents.find((each) => each.title === 'Elsewhere')?.directory).toEqual(['Elsewhere']);
      expect((await exported({ documents: [bill.id] })).documents.map((each) => each.directory.join('/'))).toEqual(['Water/Water bill March']);
      // Audited: who took what, in numbers.
      expect(audit('DOCUMENTS_EXPORTED').map((event) => [event.actor, event.subject, event.metadata])).toEqual([
        ['Gus', 'folder', { scope: 'folder', folder: 'Water', documents: 2, files: 4, bytes: 9800 }],
        ['Uma', 'folder', { scope: 'folder', folder: 'Water', documents: 2, files: 4, bytes: 9800 }],
        ['Gus', 'workspace', { scope: 'all', folder: '', documents: 3, files: 5, bytes: 10_800 }],
        ['Gus', 'workspace', { scope: 'selection', folder: '', documents: 1, files: 3, bytes: 9300 }],
      ]);
    });

    it('never exports across Workspaces or out of Trash, and names nothing it refuses', async () => {
      const water = await folder('Water');
      const bill = await document('Bill', water.id);
      const gone = await folder('Gone');
      const goneBill = await document('Gone bill', gone.id);
      await deleteFolder(docs, { ...ref(uma), folderId: gone.id });
      const theirs = await document('Payroll', null, [900], otto, office);

      await expect(exported({}, otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(checkDocumentExport(docs, { ...ref(otto), request: {} })).rejects.toThrow(WorkspaceNotFoundError);
      // Home's Folder and Document under the Office, and the other way round.
      await expect(exported({ folder: water.id }, otto, office)).rejects.toThrow(FolderNotFoundError);
      await expect(exported({ documents: [bill.id] }, otto, office)).rejects.toThrow(DocumentNotFoundError);
      await expect(exported({ documents: [bill.id, theirs.id] })).rejects.toThrow(DocumentNotFoundError);
      await expect(checkDocumentExport(docs, { ...ref(gus), request: { documents: [theirs.id] } })).rejects.toThrow(DocumentNotFoundError);
      // Trash.
      await expect(exported({ folder: gone.id })).rejects.toThrow(FolderNotFoundError);
      await expect(exported({ documents: [goneBill.id] })).rejects.toThrow(DocumentNotFoundError);
      expect((await exported({})).documents.map((each) => each.title)).toEqual(['Bill']);
      expect(await code(exported({ folder: water.id, documents: [bill.id] }))).toBe('invalid_export_scope');
      expect(await code(exported({ documents: [] }))).toBe('invalid_export_selection');
      expect(await code(exported({ documents: [bill.id, bill.id] }))).toBe('invalid_export_selection');
      expect(await code(exported({ folder: 'top' }))).toBe('invalid_folder_id');
      // Only the one export that happened is recorded.
      expect(audit('DOCUMENTS_EXPORTED')).toHaveLength(1);
      await setWorkspaceTool(docs, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
      await expect(exported({})).rejects.toThrow(ToolNotEnabledError);
    });

    it('builds every path itself: hostile titles and file names cannot leave the archive or collide', async () => {
      const evil = await folder('..');
      await document('../../x<script>alert(1)</script>', evil.id, [100, 100], uma, home, ['CON.jpg', '../../etc/passwd']);
      await document('Same', null, [100], uma, home, ['a.jpg']);
      await document('same', null, [100], uma, home, ['a.jpg']);
      await document('index.html', null, [100], uma, home, ['index.html']);
      const paths = (await exported({})).documents.flatMap((each) => each.files.map((file) => file.path.join('/')));
      // "Same" and "same" would be one directory on Windows and macOS: the second one is numbered (which of the two comes first is not fixed).
      expect(paths.map((path) => path.toLowerCase()).sort()).toEqual(['index.html (2)/01 - index.html.jpg', 'same (2)/01 - a.jpg', 'same/01 - a.jpg', 'untitled/_.._x_script_alert(1)__script_/01 - _con.jpg', 'untitled/_.._x_script_alert(1)__script_/02 - passwd.jpg']);
      for (const path of paths) {
        expect(path.split('/').every((segment) => segment !== '..' && segment !== '.' && segment !== '' && !/[\\:*?"<>|]/.test(segment))).toBe(true);
        expect(path.startsWith('/')).toBe(false);
      }
    });

    it('refuses an export that is too large, with its size, and a second one while the first is running', async () => {
      await document('Big', null, [4000, 4000]);
      await document('Small', null, [500]);
      const small: DocumentExportDeps = { ...docs, exportLimits: { files: 2, bytes: 5000 } };
      const tooLarge = await exported({}, gus, home, small).catch((error: unknown) => error);
      expect(tooLarge).toBeInstanceOf(ExportTooLargeError);
      expect((tooLarge as ExportTooLargeError).size).toEqual({ documents: 2, files: 3, bytes: 8500 });
      await expect(checkDocumentExport(small, { ...ref(gus), request: {} })).rejects.toThrow(ExportTooLargeError);
      expect(audit('DOCUMENTS_EXPORTED')).toEqual([]); // a refused export is not recorded as one

      // One at a time per person; another person is not held up; afterwards it works again.
      let finish = () => {};
      const first = exportDocuments(docs, { ...ref(gus), request: {} }, () => new Promise<void>((resolve) => (finish = resolve)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(exported({})).rejects.toThrow(ExportRunningError);
      await expect(checkDocumentExport(docs, { ...ref(gus), request: {} })).rejects.toThrow(ExportRunningError);
      expect((await exported({}, uma)).documents).toHaveLength(2);
      finish();
      await first;
      expect((await exported({})).documents).toHaveLength(2);
      // An export that fails while it is delivered frees the slot as well.
      await expect(exportDocuments(docs, { ...ref(gus), request: {} }, async () => Promise.reject(new Error('connection lost')))).rejects.toThrow('connection lost');
      expect((await exported({})).documents).toHaveLength(2);
    });
  });
});

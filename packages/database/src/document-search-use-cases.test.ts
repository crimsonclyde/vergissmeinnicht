import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FolderNotFoundError,
  InvalidCursorError,
  ToolNotEnabledError,
  WorkspaceNotFoundError,
  addMember,
  createDocument,
  createDocumentType,
  createFolder,
  createPreviewQueue,
  createWorkspace,
  deleteDocument,
  deleteFolder,
  documentFilterValues,
  findDocuments,
  openOriginal,
  restoreDocument,
  setWorkspaceTool,
  updateDocument,
  uploadDocumentFile,
  type DocumentDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type DocumentInput,
} from '@vergissmeinnicht/application';
import {
  DOCUMENTS_PAGE_SIZE,
  DomainValidationError,
  documentSearchText,
  documentTagKeys,
  documentTitleKey,
  normalizeEmail,
  type DocumentCursor,
  type DocumentQueryInput,
  type User,
  type Workspace,
} from '@vergissmeinnicht/domain';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { fillDocumentSearch } from './migrate.ts';
import { documents } from './schema.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const processor: DocumentFileProcessor = {
  inspect: async () => ({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async (path) => ({ jpeg: new TextEncoder().encode(`preview of ${path}`), width: 1800, height: 2400 }),
  thumbnail: async (preview) => ({ jpeg: new TextEncoder().encode(`thumbnail ${preview.byteLength}`), width: 300, height: 400 }),
};

describe('Finding Documents: search, filters, sorting, paging (16.3)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let deps: DocumentDeps;
  let fileDeps: DocumentFileDeps;
  let admin: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let counter = 0;
  const clock = { now: () => now };
  const tick = () => (now = new Date(now.getTime() + 60_000));
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
  /** A Document through the use-cases, a minute after the one before (so "uploaded" orders them). */
  const add = async (content: DocumentInput, folderId: string | null = null, actor = uma, workspace = home) => {
    tick();
    return createDocument(deps, { ...ref(actor, workspace), folderId, content, fileIds: [(await upload(`${content.title}.jpg`, actor, workspace)).id] });
  };
  const find = (query: DocumentQueryInput = {}, actor = gus, cursor?: unknown) => findDocuments(deps, { ...ref(actor), query, cursor });
  const titles = async (query: DocumentQueryInput = {}, actor = gus) => (await find(query, actor)).documents.map((each) => each.title);
  const wire = (cursor: DocumentCursor | null) => (cursor === null ? null : [cursor.value, cursor.id]);
  /** Every page of a listing, following the cursors; `between` runs after each page (someone else at work). */
  const all = async (query: DocumentQueryInput, between: (page: number) => Promise<void> = async () => undefined) => {
    const seen: string[] = [];
    let cursor: unknown;
    for (let page = 0; page < 500; page++) {
      const found = await find(query, gus, cursor);
      expect(found.documents.length).toBeLessThanOrEqual(DOCUMENTS_PAGE_SIZE);
      seen.push(...found.documents.map((each) => each.title));
      if (found.next === null) return seen;
      cursor = wire(found.next);
      await between(page);
    }
    throw new Error('the listing never ended');
  };
  /** Many Documents at once, written directly (through the use-cases, ten thousand uploads would take minutes). */
  const bulk = (count: number, workspace: Workspace, make: (index: number) => { title: string; notes?: string; tags?: string[]; documentDate?: string | null; year?: number | null; at?: Date }) => {
    database.db.transaction((tx) => {
      for (let index = 0; index < count; index++) {
        const made = make(index);
        const content = { title: made.title, notes: made.notes ?? '', tags: made.tags ?? [] };
        const at = made.at ?? new Date(now.getTime() - (count - index) * 1000);
        tx.insert(documents)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            folderId: null,
            ...content,
            documentDate: made.documentDate ?? null,
            year: made.year ?? null,
            titleKey: documentTitleKey(content.title),
            tagKeys: documentTagKeys(content.tags),
            searchText: documentSearchText(content),
            createdByUserId: uma.id,
            createdByDisplayName: uma.displayName,
            createdAt: at,
            updatedByUserId: uma.id,
            updatedByDisplayName: uma.displayName,
            updatedAt: at,
          })
          .run();
      }
    });
  };
  const code = async (run: Promise<unknown>) => run.then(
    () => undefined,
    (caught: unknown) => (caught instanceof DomainValidationError ? caught.code : (caught as Error).name),
  );

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-document-search-'));
    now = new Date('2026-10-02T08:00:00Z');
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const tools = createWorkspaceToolRepository(database);
    deps = { workspaces, tools, documents: createDocumentRepository(database), clock };
    const files = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    fileDeps = { workspaces, tools, files, store, processor, clock, previews: createPreviewQueue({ files, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG'] }) };
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
    await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: true });
    await setWorkspaceTool(deps, { ...ref(otto, office), tool: 'DOCUMENTS', enabled: true });
  });
  afterEach(() => {
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the user's example, continued: the Water bill is found with type = bill and year = 2026, and its file downloads from the result", async () => {
    const water = await createFolder(deps, { ...ref(uma), name: 'Water', parentId: null });
    const bill = await add({ title: 'Water bill March', type: { builtIn: 'bill' }, year: 2026, documentDate: '2026-03-12' }, water.id);
    await add({ title: 'Water contract', type: { builtIn: 'contract' }, year: 2026 }, water.id);
    await add({ title: 'Water bill 2025', type: { builtIn: 'bill' }, year: 2025 }, water.id);

    const found = await find({ type: 'builtin:bill', year: 2026 });
    expect(found.documents.map((each) => each.title)).toEqual(['Water bill March']);
    expect(found).toMatchObject({ total: 1, next: null });
    const cover = found.documents[0]?.cover;
    expect(cover?.fileId).toBe(bill.pages[0]?.id);
    // A guest downloads the original straight from the result.
    const original = await openOriginal(fileDeps, { ...ref(gus), fileId: cover?.fileId ?? '' });
    expect(original.fileName).toBe('Water bill March.jpg');
  });

  it('shows every Document of the Workspace, newest upload first, when nothing is asked for ("Recently added")', async () => {
    const water = await createFolder(deps, { ...ref(uma), name: 'Water', parentId: null });
    const y2026 = await createFolder(deps, { ...ref(uma), name: '2026', parentId: water.id });
    await add({ title: 'At the top' });
    await add({ title: 'In Water' }, water.id);
    await add({ title: 'In 2026' }, y2026.id);
    expect(await titles()).toEqual(['In 2026', 'In Water', 'At the top']);
  });

  describe('search', () => {
    it('finds a word in notes or tags, ignoring case and accents, also inside a longer word', async () => {
      await add({ title: 'Bolletta', notes: "Fornitura dell'acqua, secondo trimestre" });
      await add({ title: 'Contatore', tags: ['Acqua'] });
      await add({ title: 'Stromrechnung Müller', notes: 'Fällig am 3. — Straße 4' });
      await add({ title: 'Perché no' });

      expect((await titles({ q: 'acqua' })).sort()).toEqual(['Bolletta', 'Contatore']);
      expect(await titles({ q: 'ACQUA' })).toHaveLength(2);
      expect(await titles({ q: 'rechnung' })).toEqual(['Stromrechnung Müller']); // inside a compound word
      expect(await titles({ q: 'muller' })).toEqual(['Stromrechnung Müller']);
      expect(await titles({ q: 'MÜLLER' })).toEqual(['Stromrechnung Müller']);
      expect(await titles({ q: 'fallig' })).toEqual(['Stromrechnung Müller']);
      expect(await titles({ q: 'strasse' })).toEqual(['Stromrechnung Müller']); // ß and ss are one
      expect(await titles({ q: 'perche' })).toEqual(['Perché no']);
      expect(await titles({ q: 'am' })).toEqual(['Stromrechnung Müller']); // two letters are enough
      // Every word must occur — anywhere, in any order.
      expect(await titles({ q: 'trimestre bolletta' })).toEqual(['Bolletta']);
      expect(await titles({ q: 'bolletta strom' })).toEqual([]);
      // A term never spans title, tags and notes.
      expect(await titles({ q: 'contatore\nacqua' })).toEqual(['Contatore']);
      expect(await titles({ q: 'bollettafornitura' })).toEqual([]);
      expect(await titles({ q: '   ' })).toHaveLength(4);
    });

    it('follows edits: what a Document was called before is no longer found', async () => {
      const bill = await add({ title: 'Gas', notes: 'caldaia', tags: ['riscaldamento'] });
      await updateDocument(deps, { ...ref(uma), documentId: bill.id, expectedRevision: bill.revision, content: { title: 'Heizung', notes: 'Kessel', tags: ['Wärme'] } });
      for (const old of ['gas', 'caldaia', 'riscaldamento']) expect({ old, found: await titles({ q: old }) }).toEqual({ old, found: [] });
      for (const current of ['heizung', 'kessel', 'warme']) expect({ current, found: await titles({ q: current }) }).toEqual({ current, found: ['Heizung'] });
      expect(await titles({ tags: ['WÄRME'] })).toEqual(['Heizung']);
      expect(await titles({ sort: 'title' })).toEqual(['Heizung']);
    });

    it('never finds what is in Trash or in another Workspace, and counts none of it', async () => {
      const folder = await createFolder(deps, { ...ref(uma), name: 'Old', parentId: null });
      await add({ title: 'Acqua kept' });
      const single = await add({ title: 'Acqua deleted', year: 1999, tags: ['Segreto'] });
      await add({ title: 'Acqua in a deleted folder', year: 1998, tags: ['Nascosto'] }, folder.id, admin);
      await add({ title: 'Acqua of the office', notes: 'acqua', tags: ['acqua'] }, null, otto, office);
      await deleteDocument(deps, { ...ref(uma), documentId: single.id });
      await deleteFolder(deps, { ...ref(uma), folderId: folder.id });

      for (const query of [{ q: 'acqua' }, {}, { sort: 'title' }, { tags: ['acqua'] }, { uploader: 'Otto' }] as DocumentQueryInput[]) {
        const found = await find(query);
        const expected = query.tags !== undefined || query.uploader !== undefined ? [] : ['Acqua kept'];
        expect({ query, titles: found.documents.map((each) => each.title), total: found.total }).toEqual({ query, titles: expected, total: expected.length });
      }
      // The filters offer nothing that only Trash or the Office has: no year, no tag, no uploader.
      expect(await documentFilterValues(deps, ref(gus))).toEqual({ years: [], tags: [], uploaders: ['Uma'] });
      // Back from Trash, it is found again.
      await restoreDocument(deps, { ...ref(uma), documentId: single.id });
      expect((await titles({ q: 'acqua' })).sort()).toEqual(['Acqua deleted', 'Acqua kept']);
      // Otto, in the Office, sees only his own.
      expect((await findDocuments(deps, { ...ref(otto, office), query: { q: 'acqua' } })).documents.map((each) => each.title)).toEqual(['Acqua of the office']);
    });

    it('treats everything typed as text: wildcards and SQL are searched for, not obeyed', async () => {
      await add({ title: '100% Ökostrom', notes: 'a_b' });
      await add({ title: 'Plain', notes: 'axb' });
      expect(await titles({ q: '%' })).toEqual(['100% Ökostrom']);
      expect(await titles({ q: '_' })).toEqual(['100% Ökostrom']);
      expect(await titles({ q: 'a_b' })).toEqual(['100% Ökostrom']);
      expect(await titles({ q: '\\' })).toEqual([]);
      for (const hostile of ["' OR 1=1 --", '%\' OR \'1\'=\'1', '"; DROP TABLE documents; --', "x' UNION SELECT password FROM accounts --"]) {
        expect({ hostile, found: await titles({ q: hostile }) }).toEqual({ hostile, found: [] });
        expect({ hostile, found: await titles({ tags: [hostile] }) }).toEqual({ hostile, found: [] });
        expect({ hostile, found: await titles({ uploader: hostile }) }).toEqual({ hostile, found: [] });
      }
      expect(await titles()).toHaveLength(2); // the table is still there
      // Sort and direction are names from a fixed list.
      expect(await code(find({ sort: 'title; DROP TABLE documents' }))).toBe('invalid_document_sort');
      expect(await code(find({ sort: 'created_at' }))).toBe('invalid_document_sort');
      expect(await code(find({ direction: 'desc, (select 1)' }))).toBe('invalid_document_sort');
      expect(await code(find({ q: 'x'.repeat(101) }))).toBe('search_too_long');
      expect(await code(find({ q: 'a b c d e f g h i' }))).toBe('search_too_many_terms');
      expect(await code(find({ type: 'bill' }))).toBe('invalid_document_type');
      expect(await code(find({ type: 'builtin:secret' }))).toBe('invalid_document_type');
      expect(await code(find({ type: 'custom:1' }))).toBe('invalid_document_type_id');
      expect(await code(find({ year: 1800 }))).toBe('invalid_document_year');
      expect(await code(find({ folder: 'everything' }))).toBe('invalid_folder_id');
      expect(await code(find({ tags: Array.from({ length: 11 }, (_, index) => `t${index}`) }))).toBe('too_many_tags');
      expect(await code(find({ uploader: 'x‮y' }))).toBe('uploader_invalid_characters');
    });
  });

  describe('filters', () => {
    it('combines Folder (with or without sub-folders), type, year, tags and uploader', async () => {
      const water = await createFolder(deps, { ...ref(uma), name: 'Water', parentId: null });
      const y2026 = await createFolder(deps, { ...ref(uma), name: '2026', parentId: water.id });
      const deep = await createFolder(deps, { ...ref(uma), name: 'Q1', parentId: y2026.id });
      const power = await createFolder(deps, { ...ref(uma), name: 'Power', parentId: null });
      const minutes = await createDocumentType(deps, { ...ref(uma), name: 'Condominium minutes' });
      await add({ title: 'Top' });
      await add({ title: 'Water general', type: { builtIn: 'contract' } }, water.id, admin);
      await add({ title: 'Water 2026', type: { builtIn: 'bill' }, year: 2026, tags: ['Paid', 'Acqua'] }, y2026.id);
      await add({ title: 'Water Q1', type: { builtIn: 'bill' }, year: 2026, tags: ['acqua'] }, deep.id);
      await add({ title: 'Power 2026', type: { builtIn: 'bill' }, year: 2026, tags: ['paid'] }, power.id);
      await add({ title: 'Minutes', type: { customId: minutes.id }, year: 2025 }, null, admin);
      const sorted = async (query: DocumentQueryInput) => (await titles(query)).sort();

      expect(await sorted({ folder: water.id })).toEqual(['Water general']);
      expect(await sorted({ folder: water.id, subfolders: true })).toEqual(['Water 2026', 'Water Q1', 'Water general']);
      expect(await sorted({ folder: y2026.id, subfolders: true })).toEqual(['Water 2026', 'Water Q1']);
      expect(await sorted({ folder: 'top' })).toEqual(['Minutes', 'Top']);
      expect(await sorted({ type: 'builtin:bill' })).toEqual(['Power 2026', 'Water 2026', 'Water Q1']);
      expect(await sorted({ type: `custom:${minutes.id}` })).toEqual(['Minutes']);
      expect(await sorted({ year: 2026 })).toEqual(['Power 2026', 'Water 2026', 'Water Q1']);
      expect(await sorted({ tags: ['paid'] })).toEqual(['Power 2026', 'Water 2026']); // without case
      expect(await sorted({ tags: ['PAID', 'acqua'] })).toEqual(['Water 2026']); // all of them
      expect(await sorted({ tags: ['pai'] })).toEqual([]); // a tag, not a part of one
      expect(await sorted({ uploader: 'Ada' })).toEqual(['Minutes', 'Water general']);
      expect(await sorted({ folder: water.id, subfolders: true, type: 'builtin:bill', year: 2026, tags: ['acqua'], uploader: 'Uma', q: 'q1' })).toEqual(['Water Q1']);
      expect(await sorted({ folder: power.id, type: 'builtin:contract' })).toEqual([]);

      expect(await documentFilterValues(deps, ref(gus))).toEqual({ years: [2026, 2025], tags: ['Acqua', 'Paid'], uploaders: ['Ada', 'Uma'] }); // one entry per tag, whatever its spelling
    });

    it('answers "no such folder" for a Folder in Trash, of another Workspace, or unknown', async () => {
      const gone = await createFolder(deps, { ...ref(uma), name: 'Gone', parentId: null });
      await add({ title: 'Inside' }, gone.id);
      await deleteFolder(deps, { ...ref(uma), folderId: gone.id });
      const foreign = await createFolder(deps, { ...ref(otto, office), name: 'Office papers', parentId: null });
      await add({ title: 'Payroll' }, foreign.id, otto, office);
      for (const folder of [gone.id, foreign.id, randomUUID()]) {
        for (const subfolders of [false, true]) await expect(find({ folder, subfolders })).rejects.toThrow(FolderNotFoundError);
      }
    });
  });

  describe('sorting', () => {
    it('sorts by document date, upload, title and last change, either way, and puts Documents without a document date last', async () => {
      const b = await add({ title: 'banana', documentDate: '2026-03-12' });
      await add({ title: 'Äpfel', documentDate: '2024-01-05' });
      await add({ title: 'cherry' });
      await add({ title: 'Apple', documentDate: '2027-01-15' });
      tick();
      await updateDocument(deps, { ...ref(uma), documentId: b.id, expectedRevision: b.revision, content: { title: 'banana', documentDate: '2026-03-12', notes: 'edited last' } });

      expect(await titles({ sort: 'uploaded' })).toEqual(['Apple', 'cherry', 'Äpfel', 'banana']);
      expect(await titles({ sort: 'uploaded', direction: 'asc' })).toEqual(['banana', 'Äpfel', 'cherry', 'Apple']);
      expect(await titles({ sort: 'documentDate' })).toEqual(['Apple', 'banana', 'Äpfel', 'cherry']);
      expect(await titles({ sort: 'documentDate', direction: 'asc' })).toEqual(['Äpfel', 'banana', 'Apple', 'cherry']); // still last
      // By title without case or accents: "Äpfel" sits with the A's, not after "z".
      expect(await titles({ sort: 'title' })).toEqual(['Äpfel', 'Apple', 'banana', 'cherry']);
      expect(await titles({ sort: 'title', direction: 'desc' })).toEqual(['cherry', 'banana', 'Apple', 'Äpfel']);
      expect(await titles({ sort: 'modified' })).toEqual(['banana', 'Apple', 'cherry', 'Äpfel']);
    });
  });

  describe('paging', () => {
    it('pages fifty at a time through every order without repeating or skipping, also among equal values', async () => {
      // 130 Documents; many share a date, an upload time and a title — the id breaks every tie.
      bulk(130, home, (index) => ({ title: `Doc ${String(index % 40).padStart(2, '0')}`, documentDate: index % 3 === 0 ? null : `2026-01-${String((index % 7) + 1).padStart(2, '0')}`, at: new Date(now.getTime() - (index % 9) * 1000) }));
      const expected = (await all({})).length;
      expect(expected).toBe(130);
      for (const sort of ['uploaded', 'documentDate', 'title', 'modified']) {
        for (const direction of ['asc', 'desc']) {
          const first = await find({ sort, direction });
          expect({ sort, direction, total: first.total, shown: first.documents.length }).toEqual({ sort, direction, total: 130, shown: DOCUMENTS_PAGE_SIZE });
          const ids: string[] = [];
          let cursor: unknown;
          for (;;) {
            const page = await find({ sort, direction }, gus, cursor);
            if (cursor !== undefined) expect(page.total).toBeNull(); // counted once
            ids.push(...page.documents.map((each) => each.id));
            if (page.next === null) break;
            cursor = wire(page.next);
          }
          expect({ sort, direction, distinct: new Set(ids).size, all: ids.length }).toEqual({ sort, direction, distinct: 130, all: 130 });
        }
      }
      // Documents without a document date come last, across page borders too.
      const byDate = (await find({ sort: 'documentDate', direction: 'asc' })).documents.map((each) => each.documentDate);
      expect(byDate.every((date) => date !== null)).toBe(true); // 86 dated ones fill the first page
    });

    it('stays stable while others add, delete and restore: nothing twice, nothing that was there left out', async () => {
      bulk(120, home, (index) => ({ title: `Kept ${String(index).padStart(3, '0')}` }));
      const victim = await add({ title: 'Deleted between pages' }); // newest: on the first page
      const seen = await all({ sort: 'uploaded' }, async (page) => {
        if (page === 0) {
          await add({ title: 'Added between pages' }); // newer than everything shown so far
          await deleteDocument(deps, { ...ref(uma), documentId: victim.id });
        }
      });
      expect(new Set(seen).size).toBe(seen.length);
      const kept = seen.filter((title) => title.startsWith('Kept'));
      expect(kept).toHaveLength(120); // every Document that was there all along
      expect(seen).not.toContain('Added between pages'); // it belongs before the first page
      expect(await titles()).toContain('Added between pages'); // and is there on a fresh look
    });

    it('accepts only a cursor of the right shape, and a cursor selects nothing outside the Workspace', async () => {
      bulk(60, home, (index) => ({ title: `Home ${index}` }));
      bulk(60, office, (index) => ({ title: `Office ${index}` }));
      const officeFirst = await findDocuments(deps, { ...ref(otto, office), query: {} });
      expect(officeFirst.next).not.toBeNull();
      // Otto's cursor in Gus's hands is only a position in Home's own list.
      const borrowed = await find({}, gus, wire(officeFirst.next));
      expect(borrowed.documents.every((each) => each.title.startsWith('Home'))).toBe(true);
      const good = wire((await find()).next);
      for (const bad of ['x', 12, {}, [], [1], [1, 2, 3], [good?.[0], 'not-an-id'], ['2026-01-01', good?.[1]], [null, good?.[1]], [-1, good?.[1]], [1.5, good?.[1]], [good?.[0], `${String(good?.[1])}' OR 1=1`]]) {
        await expect(find({}, gus, bad), JSON.stringify(bad)).rejects.toThrow(InvalidCursorError);
      }
      // A cursor made for one order is refused under another.
      await expect(find({ sort: 'title' }, gus, good)).rejects.toThrow(InvalidCursorError);
      await expect(find({ sort: 'documentDate' }, gus, good)).rejects.toThrow(InvalidCursorError);
      await expect(find({ sort: 'documentDate' }, gus, [null, good?.[1]])).resolves.toBeDefined(); // "no document date" is a position too
    });
  });

  describe('permissions', () => {
    it('lets every member search, and nobody else; a switched-off tool finds nothing', async () => {
      await add({ title: 'Bill' });
      for (const member of [admin, uma, gus]) expect(await titles({ q: 'bill' }, member)).toEqual(['Bill']);
      await expect(find({ q: 'bill' }, otto)).rejects.toThrow(WorkspaceNotFoundError);
      await expect(documentFilterValues(deps, ref(otto))).rejects.toThrow(WorkspaceNotFoundError);
      await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
      await expect(find({ q: 'bill' }, admin)).rejects.toThrow(ToolNotEnabledError);
      await expect(documentFilterValues(deps, ref(admin))).rejects.toThrow(ToolNotEnabledError);
    });
  });

  describe('the search columns', () => {
    it('are required for a new Document, and filled by migrate for Documents from before', async () => {
      const bill = await add({ title: 'Müllgebühren', notes: 'Fällig', tags: ['Città'] });
      const stored = () => database.sqlite.prepare('SELECT title_key AS titleKey, tag_keys AS tagKeys, search_text AS searchText FROM documents WHERE id = ?').get(bill.id);
      const filled = { titleKey: 'mullgebuhren', tagKeys: '["citta"]', searchText: 'mullgebuhren\ncitta\nfallig' };
      expect(stored()).toEqual(filled);
      // As a database migrated from 0028 looks: the columns exist and are empty.
      database.sqlite.prepare('UPDATE documents SET title_key = NULL, tag_keys = NULL, search_text = NULL').run();
      expect(await titles({ q: 'mull' })).toEqual([]);
      expect(fillDocumentSearch(database.sqlite)).toBe(1);
      expect(stored()).toEqual(filled);
      expect(await titles({ q: 'mull' })).toEqual(['Müllgebühren']);
      expect(fillDocumentSearch(database.sqlite)).toBe(0); // nothing left to do
      // The database refuses a Document without them.
      expect(() =>
        database.sqlite
          .prepare("INSERT INTO documents (id, workspace_id, title, created_by_user_id, created_by_display_name, created_at, updated_by_user_id, updated_by_display_name, updated_at) VALUES (?, ?, 'x', ?, 'Uma', 1, ?, 'Uma', 1)")
          .run(randomUUID(), home.id, uma.id, uma.id),
      ).toThrow(/search columns/);
    });
  });

  describe('with 10 000 Documents in one Workspace', () => {
    /** The bound of 16.3 for one page. */
    const BOUND_MS = 500;
    const WORDS = ['rechnung', 'strom', 'wasser', 'acqua', 'bolletta', 'luce', 'gas', 'versicherung', 'contratto', 'vertrag', 'garanzia', 'heizung', 'steuer', 'comune', 'müll', 'rifiuti', 'verbale', 'wartung', 'quittung', 'ricevuta'];
    const word = (seed: number) => WORDS[seed % WORDS.length] ?? '';
    const timed = async <T>(run: () => Promise<T>): Promise<{ result: T; ms: number }> => {
      const start = performance.now();
      const result = await run();
      return { result, ms: performance.now() - start };
    };

    it('pages through all of them while another member uploads — no duplicates, nothing skipped — and every page answers in time', async () => {
      bulk(10_000, home, (index) => ({
        title: `${word(index)} ${word(index * 7 + 3)} ${String(index).padStart(5, '0')}`,
        notes: index % 3 === 0 ? `${word(index * 5)} ${word(index * 11)} ${'nota '.repeat(40)}` : '',
        tags: index % 4 === 0 ? [word(index * 13)] : [],
        documentDate: index % 5 === 0 ? null : `20${String(10 + (index % 17)).padStart(2, '0')}-0${(index % 9) + 1}-1${index % 10}`,
        year: 2010 + (index % 17),
      }));
      bulk(2_000, office, (index) => ({ title: `office ${word(index)} ${index}`, notes: 'zzzneedle' }));

      const slowest = { ms: 0, what: '' };
      const note = (what: string, ms: number) => {
        if (ms > slowest.ms) Object.assign(slowest, { ms, what });
        expect({ what, withinBound: ms < BOUND_MS, ms: Math.round(ms) }).toMatchObject({ what, withinBound: true });
      };
      for (const query of [{}, { sort: 'title' }, { sort: 'documentDate', direction: 'asc' }, { sort: 'modified' }] as DocumentQueryInput[]) {
        const ids = new Set<string>();
        let cursor: unknown;
        let pages = 0;
        for (;;) {
          const { result, ms } = await timed(() => find(query, gus, cursor));
          note(`page ${pages} of ${JSON.stringify(query)}`, ms);
          for (const each of result.documents) {
            expect(ids.has(each.id)).toBe(false);
            ids.add(each.id);
          }
          pages++;
          if (result.next === null) break;
          cursor = wire(result.next);
          if (pages % 40 === 0) await add({ title: `uploaded meanwhile ${pages} ${JSON.stringify(query)}` }); // another member, through the real path
        }
        // Everything that was there when the walk began was shown exactly once.
        expect({ query, shownAtLeast: ids.size >= 10_000, pages: pages >= 200 }).toEqual({ query, shownAtLeast: true, pages: true });
      }
      // Searches and filters: a common word, a rare one, one that only the other Workspace has, several filters.
      for (const query of [{ q: 'rechnung' }, { q: 'rechnung acqua' }, { q: '00042' }, { q: 'zzzneedle' }, { q: 'nota', sort: 'title' }, { tags: ['müll'], year: 2014 }, { q: 'gas', year: 2020, sort: 'documentDate' }] as DocumentQueryInput[]) {
        const { result, ms } = await timed(() => find(query));
        note(`search ${JSON.stringify(query)}`, ms);
        if (query.q === 'zzzneedle') expect(result).toMatchObject({ documents: [], total: 0 });
        if (query.q === '00042') expect(result.documents.map((each) => each.title)).toHaveLength(1);
      }
      const values = await timed(() => documentFilterValues(deps, ref(gus)));
      note('filter values', values.ms);
      expect(values.result.years).toHaveLength(17);
      console.info(`16.3 fixture: slowest request ${slowest.ms.toFixed(1)} ms (${slowest.what})`);
    }, 120_000);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NotAuthorizedError,
  TEXT_LEASE_MS,
  TextExtractionError,
  TextRetryNotPossibleError,
  ToolNotEnabledError,
  addMember,
  createDocument,
  createPreviewQueue,
  createTextRecognizer,
  createWorkspace,
  deleteDocument,
  dismissSuggestion,
  documentSuggestions,
  updateDocument,
  findDocuments,
  getDocument,
  purgeDocumentTrash,
  retryTextRecognition,
  setTextRecognition,
  setWorkspaceTool,
  textRecognitionSettings,
  uploadDocumentFile,
  type DocumentDeps,
  type DocumentFileDeps,
  type DocumentFileProcessor,
  type TextExtractor,
  type TextRecognitionUseCaseDeps,
  type TextRecognizer,
} from '@vergissmeinnicht/application';
import { MAX_TEXT_ATTEMPTS, normalizeEmail, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore } from '@vergissmeinnicht/media';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createDocumentRepository, createWorkspaceToolRepository } from './document-repository.ts';
import { createDocumentTextRepository } from './document-text-repository.ts';
import { createStorageRepository } from './storage-usage.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository, createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';

/** What the next uploads are: photos, or two-page PDFs. */
let uploading: 'JPEG' | 'PDF' = 'JPEG';
/** Each upload says what is printed on it: the fake engine "reads" the bytes. */
const processor: DocumentFileProcessor = {
  inspect: async () => (uploading === 'PDF' ? { format: 'PDF', pageCount: 2, width: null, height: null, encrypted: false, activeContent: false } : { format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false }),
  renderPage: async (path) => ({ jpeg: new TextEncoder().encode(`preview of ${path}`), width: 1800, height: 2400 }),
  thumbnail: async (preview) => ({ jpeg: new TextEncoder().encode(`thumbnail ${preview.byteLength}`), width: 300, height: 400 }),
};

describe('Text recognition of Documents (16.9)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let now: Date;
  let deps: DocumentDeps;
  let fileDeps: DocumentFileDeps;
  let textDeps: TextRecognitionUseCaseDeps;
  let recognizer: TextRecognizer;
  let texts: ReturnType<typeof createDocumentTextRepository>;
  let admin: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  /** What the fake engine does with the next files: read their bytes as text, or fail. */
  let behaviour: 'read' | 'fail' | 'unavailable' = 'read';
  const read: string[] = [];
  const clock = { now: () => now };
  const ref = (actor: User, workspace = home) => ({ actor, workspaceId: workspace.id });
  const ocrPages: number[] = [];
  const extractor: TextExtractor = {
    // Page 1 of a PDF carries its own text; page 2 is a scan.
    pdfPageText: async (_path, page) => (page === 0 ? 'Allianz Versicherungs-AG\nVersicherungsschein Hausratversicherung' : ''),
    recognizePdfPage: async (_path, page) => {
      ocrPages.push(page);
      return 'Unterschrift Seite zwei';
    },
    recognizeImage: async (path) => {
      if (behaviour === 'fail') throw new TextExtractionError('unreadable');
      if (behaviour === 'unavailable') throw new TextExtractionError('unavailable');
      const { readFileSync } = await import('node:fs');
      const text = readFileSync(path, 'utf8');
      read.push(text);
      return text;
    },
  };
  const upload = async (printed: string, actor = uma, workspace = home) =>
    (
      await uploadDocumentFile(fileDeps, {
        actor,
        workspaceId: workspace.id,
        name: 'scan.jpg',
        source: (async function* () {
          yield new TextEncoder().encode(printed);
        })(),
      })
    ).file;
  const add = async (title: string, printed: string, actor = uma, workspace = home) =>
    createDocument(deps, { ...ref(actor, workspace), folderId: null, content: { title }, fileIds: [(await upload(printed, actor, workspace)).id] });
  const find = async (q: string, actor = gus, workspace = home) => (await findDocuments(deps, { ...ref(actor, workspace), query: { q } })).documents;
  const stateOf = (fileId: string) => database.sqlite.prepare('SELECT state, attempts, error_code AS code FROM document_file_texts WHERE file_id = ?').get(fileId) as { state: string; attempts: number; code: string | null };
  const reason = (run: Promise<unknown>) => run.then(() => undefined, (caught: unknown) => (caught as Error).name);

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-document-text-'));
    now = new Date('2026-10-06T08:00:00Z');
    behaviour = 'read';
    uploading = 'JPEG';
    read.length = 0;
    ocrPages.length = 0;
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    const tools = createWorkspaceToolRepository(database);
    deps = { workspaces, tools, documents: createDocumentRepository(database), clock };
    const files = createDocumentFileRepository(database);
    const store = createDocumentFileStore(join(dir, 'documents'));
    texts = createDocumentTextRepository(database);
    recognizer = createTextRecognizer({ texts, store, extractor, clock });
    fileDeps = { workspaces, tools, files, store, processor, clock, recognizer, previews: createPreviewQueue({ files, store, processor, clock }), policy: async () => ({ maxFileBytes: 50_000_000, formats: ['JPEG', 'PDF'] }) };
    textDeps = { workspaces, tools, texts, recognizer, clock };
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
  afterEach(async () => {
    await recognizer.stop();
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads a new upload in the background and makes its Document findable by a printed word, with a snippet', async () => {
    const bill = await add('Water', 'ACQUEDOTTO PUGLIESE\nBolletta acqua n. 4512\nTotale da pagare: EUR 87,40');
    await recognizer.idle();
    const [found] = await find('bolletta');
    expect(found?.id).toBe(bill.id);
    expect(found?.textMatch).toEqual({ file: 1, page: 1, snippet: 'ACQUEDOTTO PUGLIESE Bolletta acqua n. 4512 Totale da pagare: EUR 87,40' });
    // Folded like titles: accents, case and ß do not matter.
    expect((await find('BOLLETTA acqua')).map((each) => each.id)).toEqual([bill.id]);
    expect((await getDocument(deps, { ...ref(gus), documentId: bill.id })).pages[0]?.textState).toBe('DONE');
    // A search by title only has no text match to show.
    expect((await find('water'))[0]?.textMatch).toBeNull();
  });

  it('a PDF with embedded text is indexed without OCR; only its scanned page is recognised', async () => {
    uploading = 'PDF';
    const policy = await add('Policy', '%PDF-1.7 fictional');
    await recognizer.idle();
    expect(ocrPages).toEqual([1]);
    const fileId = (await getDocument(deps, { ...ref(gus), documentId: policy.id })).pages[0]?.id ?? '';
    expect(database.sqlite.prepare('SELECT source, pages FROM document_file_texts WHERE file_id = ?').get(fileId)).toEqual({ source: 'MIXED', pages: 2 });
    expect((await find('hausratversicherung'))[0]).toMatchObject({ id: policy.id, textMatch: { page: 1 } });
    expect((await find('unterschrift'))[0]?.textMatch?.page).toBe(2);
  });

  it('never gives another Workspace a hit, a snippet or a count — and Trash hides the text at once', async () => {
    const bill = await add('Water', 'Bolletta acqua segreta');
    await recognizer.idle();
    expect(await find('segreta', otto, office)).toEqual([]);
    expect((await findDocuments(deps, { ...ref(otto, office), query: { q: 'segreta' } })).total).toBe(0);
    await expect(findDocuments(deps, { ...ref(otto), query: { q: 'segreta' } })).rejects.toThrow();
    await deleteDocument(deps, { ...ref(uma), documentId: bill.id });
    expect(await find('segreta')).toEqual([]);
  });

  it('deletes the text with the Document when it is deleted for good', async () => {
    const bill = await add('Water', 'Bolletta acqua');
    await recognizer.idle();
    const fileId = (await getDocument(deps, { ...ref(gus), documentId: bill.id })).pages[0]?.id ?? '';
    await deleteDocument(deps, { ...ref(uma), documentId: bill.id });
    await purgeDocumentTrash(deps, { ...ref(admin), items: [{ kind: 'document', id: bill.id }] });
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_file_texts WHERE file_id = ?').get(fileId)).toEqual({ n: 0 });
  });

  it('counts recognised text in the Workspace storage', async () => {
    await add('Water', 'Bolletta acqua 87,40');
    await recognizer.idle();
    const usage = await createStorageRepository(database).usage(home.id, now);
    expect(usage?.text).toBe(new TextEncoder().encode('Bolletta acqua 87,40').byteLength);
  });

  it('a file that cannot be read is retried, then FAILED with a Retry; the Document stays fully usable', async () => {
    behaviour = 'fail';
    const bill = await add('Water', 'Bolletta');
    const fileId = (await getDocument(deps, { ...ref(gus), documentId: bill.id })).pages[0]?.id ?? '';
    await recognizer.idle();
    expect(stateOf(fileId)).toEqual({ state: 'QUEUED', attempts: 1, code: 'unreadable' });
    for (let attempt = 2; attempt <= MAX_TEXT_ATTEMPTS; attempt++) {
      now = new Date(now.getTime() + 60 * 60_000);
      recognizer.wake();
      await recognizer.idle();
    }
    expect(stateOf(fileId)).toEqual({ state: 'FAILED', attempts: MAX_TEXT_ATTEMPTS, code: 'unreadable' });
    expect((await find('water')).map((each) => each.id)).toEqual([bill.id]);
    // Retry: someone who may change the Document's files; never a guest, never another Workspace.
    expect(await reason(retryTextRecognition(textDeps, { ...ref(gus), fileId }))).toBe('NotAuthorizedError');
    expect(await reason(retryTextRecognition(textDeps, { ...ref(otto, office), fileId }))).toBe('DocumentFileNotFoundError');
    behaviour = 'read';
    await retryTextRecognition(textDeps, { ...ref(uma), fileId });
    await recognizer.idle();
    expect(stateOf(fileId)).toMatchObject({ state: 'DONE', code: null });
    await expect(retryTextRecognition(textDeps, { ...ref(uma), fileId })).rejects.toThrow(TextRetryNotPossibleError);
  });

  it('missing language data is the server’s problem: the file waits without using up its attempts', async () => {
    behaviour = 'unavailable';
    const bill = await add('Water', 'Bolletta');
    const fileId = (await getDocument(deps, { ...ref(gus), documentId: bill.id })).pages[0]?.id ?? '';
    await recognizer.idle();
    expect(stateOf(fileId)).toEqual({ state: 'QUEUED', attempts: 0, code: 'unavailable' });
  });

  describe('the durable queue (claim, lease, attempts)', () => {
    it('never hands one file to two workers; a crashed worker’s file is taken up after its lease', async () => {
      await recognizer.stop();
      await add('Water', 'Bolletta');
      const first = await texts.claim(now, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS);
      expect(first).toBeDefined();
      expect(await texts.claim(now, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS)).toBeUndefined();
      // The first worker died; after its lease the file is claimed again, as a new attempt.
      const later = new Date(now.getTime() + TEXT_LEASE_MS + 1);
      const second = await texts.claim(later, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS);
      expect(second).toMatchObject({ fileId: first?.fileId, attempt: 2 });
      // The stale worker comes back: its writes are refused, the current claim's are kept.
      if (first === undefined || second === undefined) throw new Error('unreachable');
      const result = { text: 'stale', searchText: 'stale', source: 'OCR' as const, pages: 1, truncated: false };
      expect(await texts.complete(first, result, later)).toBe('lost');
      expect(await texts.extend(first, later, TEXT_LEASE_MS)).toBe(false);
      expect(await texts.complete(second, { ...result, text: 'fresh', searchText: 'fresh' }, later)).toBe('ok');
      expect(database.sqlite.prepare('SELECT text FROM document_file_texts WHERE file_id = ?').get(first.fileId)).toEqual({ text: 'fresh' });
    });

    it('a file whose worker keeps dying stops after the last attempt', async () => {
      await recognizer.stop();
      await add('Water', 'Bolletta');
      let at = now;
      for (let attempt = 1; attempt <= MAX_TEXT_ATTEMPTS; attempt++) {
        expect(await texts.claim(at, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS)).toMatchObject({ attempt });
        at = new Date(at.getTime() + TEXT_LEASE_MS + 1);
      }
      expect(await texts.claim(at, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS)).toBeUndefined();
      expect(database.sqlite.prepare('SELECT state, error_code AS code FROM document_file_texts').get()).toEqual({ state: 'FAILED', code: 'too_complex' });
    });

    it('new uploads come before existing files; identical content in the same Workspace is read once, never across Workspaces', async () => {
      await recognizer.stop();
      const old = await upload('Same words');
      database.sqlite.prepare('UPDATE document_file_texts SET priority = 1 WHERE file_id = ?').run(old.id);
      const fresh = await upload('Other words');
      expect((await texts.claim(now, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS))?.fileId).toBe(fresh.id);
      const local = createTextRecognizer({ texts, store: fileDeps.store, extractor, clock });
      local.wake();
      await local.idle();
      await upload('Same words');
      await upload('Same words', otto, office);
      local.wake();
      await local.idle();
      expect(read.filter((text) => text === 'Same words')).toHaveLength(2); // once in Home, once in Office
      await local.stop();
    });
  });

  describe('the Workspace switch (P5)', () => {
    it('only a Workspace admin switches it, and it is audited; Documents switched off answers as unknown', async () => {
      expect(await reason(setTextRecognition(textDeps, { ...ref(uma), enabled: false }))).toBe('NotAuthorizedError');
      expect(await reason(setTextRecognition(textDeps, { ...ref(gus), enabled: false }))).toBe('NotAuthorizedError');
      expect(await reason(textRecognitionSettings(textDeps, { ...ref(uma) }))).toBe('NotAuthorizedError');
      expect(await reason(setTextRecognition(textDeps, { ...ref(otto), enabled: false }))).toBe('WorkspaceNotFoundError');
      expect((await setTextRecognition(textDeps, { ...ref(admin), enabled: false })).enabled).toBe(false);
      expect(database.sqlite.prepare("SELECT type, actor_display_name AS actor FROM audit_events WHERE type LIKE 'TEXT_RECOGNITION_%'").all()).toEqual([{ type: 'TEXT_RECOGNITION_DISABLED', actor: 'Ada' }]);
      await setWorkspaceTool(deps, { ...ref(admin), tool: 'DOCUMENTS', enabled: false });
      await expect(textRecognitionSettings(textDeps, { ...ref(admin) })).rejects.toThrow(ToolNotEnabledError);
      await expect(setTextRecognition(textDeps, { ...ref(admin), enabled: true })).rejects.toThrow(ToolNotEnabledError);
    });

    it('off: nothing new is read, text already read stays findable; on again: what waited is read', async () => {
      const first = await add('Water', 'Bolletta acqua');
      await recognizer.idle();
      await setTextRecognition(textDeps, { ...ref(admin), enabled: false });
      const second = await add('Gas', 'Fattura gas');
      await recognizer.idle();
      expect(read).toEqual(['Bolletta acqua']);
      expect((await find('bolletta')).map((each) => each.id)).toEqual([first.id]);
      expect(await find('fattura')).toEqual([]);
      expect((await textRecognitionSettings(textDeps, { ...ref(admin) })).counts).toMatchObject({ DONE: 1, QUEUED: 1 });
      await setTextRecognition(textDeps, { ...ref(admin), enabled: true });
      await recognizer.idle();
      expect((await find('fattura')).map((each) => each.id)).toEqual([second.id]);
    });

    it('switching off stops a running file at its next page and gives it back without using an attempt', async () => {
      await recognizer.stop();
      await add('Water', 'Bolletta');
      const job = await texts.claim(now, TEXT_LEASE_MS, MAX_TEXT_ATTEMPTS);
      if (job === undefined) throw new Error('no job');
      await setTextRecognition({ ...textDeps, recognizer: { wake: () => undefined } }, { ...ref(admin), enabled: false });
      expect(await texts.extend(job, now, TEXT_LEASE_MS)).toBe(false);
      expect(await texts.complete(job, { text: 'x', searchText: 'x', source: 'OCR', pages: 1, truncated: false }, now)).toBe('paused');
      await texts.release(job, now);
      expect(database.sqlite.prepare('SELECT state, attempts FROM document_file_texts').get()).toEqual({ state: 'QUEUED', attempts: 0 });
    });
  });

  it('a guest cannot retry, an outsider cannot see the settings', async () => {
    expect(await reason(retryTextRecognition(textDeps, { ...ref(gus), fileId: '00000000-0000-4000-8000-000000000000' }))).toBe(NotAuthorizedError.name);
    expect(await reason(textRecognitionSettings(textDeps, { ...ref(otto) }))).toBe('WorkspaceNotFoundError');
  });

  describe('rule-based suggestions (task 5)', () => {
    const BILL = 'ACQUEDOTTO PUGLIESE S.p.A.\nBolletta acqua n. 4512 del 12/07/2026\nTotale da pagare: EUR 87,40\nScadenza pagamento: 15/08/2026';
    const suggestionDeps = () => ({ workspaces: deps.workspaces, tools: deps.tools, documents: deps.documents, texts, clock });
    const offered = async (documentId: string, actor = uma) => (await documentSuggestions(suggestionDeps(), { ...ref(actor), documentId })).map((each) => `${each.field}=${each.value}`);

    it('offers what the text clearly says, with its source — and changes nothing by itself', async () => {
      const bill = await add('scan', BILL);
      await recognizer.idle();
      const before = database.sqlite.prepare('SELECT * FROM documents').all();
      const audit = database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get();
      const suggestions = await documentSuggestions(suggestionDeps(), { ...ref(uma), documentId: bill.id });
      expect(suggestions.map((each) => each.field).sort()).toEqual(['amount', 'documentDate', 'dueDate', 'supplier', 'title', 'type']);
      expect(suggestions.find((each) => each.field === 'dueDate')).toEqual({ field: 'dueDate', value: '2026-08-15', file: 1, page: 1, excerpt: 'Scadenza pagamento: 15/08/2026' });
      // Asking for suggestions writes nothing: no field, no Reminder, no Contact, no history.
      expect(database.sqlite.prepare('SELECT * FROM documents').all()).toEqual(before);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get()).toEqual(audit);
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM schedules').get()).toEqual({ n: 0 });
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM contacts').get()).toEqual({ n: 0 });
    });

    it('a field the person already set is not suggested; a dismissed suggestion stays dismissed after the text is read again', async () => {
      const bill = await add('scan', BILL);
      await recognizer.idle();
      const current = await getDocument(deps, { ...ref(uma), documentId: bill.id });
      // The person accepted the type and wrote their own date — a correction a rereading never overwrites.
      await updateDocument(deps, { ...ref(uma), documentId: bill.id, expectedRevision: current.revision, content: { title: 'scan', type: { builtIn: 'bill' }, documentDate: '2026-07-13' } });
      await dismissSuggestion(suggestionDeps(), { ...ref(uma), documentId: bill.id, field: 'supplier', value: 'ACQUEDOTTO PUGLIESE S.p.A.' });
      expect(await offered(bill.id)).toEqual(['title=Bolletta ACQUEDOTTO PUGLIESE S.p.A.', 'dueDate=2026-08-15', 'documentDate=2026-07-12', 'amount=87.40 EUR']);
      const fileId = (await getDocument(deps, { ...ref(uma), documentId: bill.id })).pages[0]?.id ?? '';
      database.sqlite.prepare("UPDATE document_file_texts SET state = 'FAILED', source = NULL, text = '', search_text = '' WHERE file_id = ?").run(fileId);
      await retryTextRecognition(textDeps, { ...ref(uma), fileId });
      await recognizer.idle();
      expect(await offered(bill.id)).not.toContain('supplier=ACQUEDOTTO PUGLIESE S.p.A.');
      const after = await getDocument(deps, { ...ref(uma), documentId: bill.id });
      expect([after.documentDate, after.type]).toEqual(['2026-07-13', { kind: 'builtin', key: 'bill' }]);
    });

    it('only for those who may change the Document; never across Workspaces, never for a Document in Trash', async () => {
      const bill = await add('scan', BILL);
      await recognizer.idle();
      expect(await reason(documentSuggestions(suggestionDeps(), { ...ref(gus), documentId: bill.id }))).toBe('NotAuthorizedError');
      expect(await reason(dismissSuggestion(suggestionDeps(), { ...ref(gus), documentId: bill.id, field: 'title', value: 'x' }))).toBe('NotAuthorizedError');
      expect(await reason(documentSuggestions(suggestionDeps(), { ...ref(otto, office), documentId: bill.id }))).toBe('DocumentNotFoundError');
      expect(await reason(dismissSuggestion(suggestionDeps(), { ...ref(otto, office), documentId: bill.id, field: 'title', value: 'x' }))).toBe('DocumentNotFoundError');
      expect(await reason(dismissSuggestion(suggestionDeps(), { ...ref(uma), documentId: bill.id, field: 'password', value: 'x' }))).toBe('InvalidSuggestionError');
      await dismissSuggestion(suggestionDeps(), { ...ref(uma), documentId: bill.id, field: 'title', value: 'x' });
      await deleteDocument(deps, { ...ref(uma), documentId: bill.id });
      expect(await reason(documentSuggestions(suggestionDeps(), { ...ref(uma), documentId: bill.id }))).toBe('DocumentNotFoundError');
      // Deleting for good takes the dismissals along.
      await purgeDocumentTrash(deps, { ...ref(admin), items: [{ kind: 'document', id: bill.id }] });
      expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_suggestion_dismissals').get()).toEqual({ n: 0 });
    });
  });
});

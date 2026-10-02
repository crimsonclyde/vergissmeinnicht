import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_PENDING_MS,
  DocumentFileNotFoundError,
  DocumentFileRejectedError,
  MAX_PARALLEL_UPLOADS_PER_USER,
  NotAuthorizedError,
  StorageFullError,
  TooManyUploadsError,
  WorkspaceNotFoundError,
  addMember,
  changeMemberRole,
  createPreviewQueue,
  createWorkspace,
  documentStorageUsage,
  getDocumentFile,
  openDerivative,
  openOriginal,
  purgeUnusedDocumentFiles,
  setWorkspaceTool,
  ToolNotEnabledError,
  updateInstanceSettings,
  uploadDocumentFile,
  type DocumentFileDeps,
  type DocumentFileProcessor,
} from '@vergissmeinnicht/application';
import { DomainValidationError, normalizeEmail, type DocumentFileFormat, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createDocumentFileStore, documentFilePath } from '@vergissmeinnicht/media';
import { openDatabase } from './connection.ts';
import { createDocumentFileRepository } from './document-file-repository.ts';
import { createWorkspaceToolRepository } from './document-repository.ts';
import { createInstanceSettingsRepository } from './instance-settings-repository.ts';
import { createTestDatabase } from './test-support.ts';
import { createUserRepository } from './user-repository.ts';
import { createWorkspaceRepository } from './workspace-repository.ts';

const text = (value: string) => new TextEncoder().encode(value);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const collect = async (stream: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return new Uint8Array(Buffer.concat(parts));
};
async function* once(bytes: Uint8Array) {
  yield bytes;
}

/**
 * Stands in for the real parsers (tested in `packages/media`). The first line of a test file says what
 * it "is": `PDF 3` (three pages), `PDF locked`, `JPEG`, `PNG`, `HEIC` (never drawn — no decoder is
 * shipped), `PDF broken` (cannot be drawn); anything else is no accepted format. A preview is `preview <page> of <hash>`,
 * padded to `previewBytes`.
 */
function fakeProcessor(options: { previewBytes: () => number; rendered: string[] }): DocumentFileProcessor {
  const head = (path: string) => readFileSync(path).subarray(0, 40).toString('latin1').split('\n')[0] ?? '';
  return {
    async inspect(path) {
      const [format, detail] = head(path).split(' ');
      if (format !== 'PDF' && format !== 'JPEG' && format !== 'PNG' && format !== 'HEIC') throw new DocumentFileRejectedError('unsupported_format');
      if (format === 'PDF') {
        const locked = detail === 'locked';
        return { format, pageCount: locked ? null : detail === 'broken' ? 1 : Number(detail), width: null, height: null, encrypted: locked, activeContent: false };
      }
      return { format: format as DocumentFileFormat, pageCount: 1, width: 4032, height: 3024, encrypted: false, activeContent: false };
    },
    async renderPage(path, _format, page) {
      const line = head(path);
      if (line.startsWith('HEIC') || line.endsWith('broken')) return undefined;
      options.rendered.push(`${line}#${page}`);
      const jpeg = new Uint8Array(options.previewBytes());
      jpeg.set(text(`preview ${page} of ${sha256(readFileSync(path))}`).subarray(0, jpeg.length));
      return { jpeg, width: 1653, height: 2339 };
    },
    async thumbnail(preview) {
      return { jpeg: text(`thumbnail of ${sha256(preview)}`), width: 283, height: 400 };
    },
  };
}

describe('document files (16.1)', () => {
  let database: ReturnType<typeof createTestDatabase>;
  let dir: string;
  let root: string;
  let now: Date;
  let deps: DocumentFileDeps;
  let rendered: string[];
  let previewBytes: number;
  let admin: User;
  let eddie: User;
  let uma: User;
  let gus: User;
  let otto: User;
  let home: Workspace;
  let office: Workspace;
  let counter = 0;
  const clock = { now: () => now };
  /** A file of `bytes` size whose first line names what it is; distinct content each time. */
  const content = (kind: string, bytes = 1000) => {
    const data = new Uint8Array(bytes);
    data.set(text(`${kind}\n${++counter}`));
    return data;
  };
  const upload = (bytes: Uint8Array, actor = uma, workspace = home, name = 'Water bill.pdf') =>
    uploadDocumentFile(deps, { actor, workspaceId: workspace.id, name, source: once(bytes) });
  const setLimit = (workspace: Workspace, bytes: number) => database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = ? WHERE id = ?').run(bytes, workspace.id);
  const settingsDeps = () => ({ settings: createInstanceSettingsRepository(database), clock });
  const depsOn = (db: Pick<typeof database, 'db'>): DocumentFileDeps => {
    const files = createDocumentFileRepository(db);
    const store = createDocumentFileStore(root);
    const processor = fakeProcessor({ previewBytes: () => previewBytes, rendered });
    const settings = createInstanceSettingsRepository(db);
    return {
      workspaces: createWorkspaceRepository(db),
      tools: createWorkspaceToolRepository(db),
      files,
      store,
      processor,
      clock,
      previews: createPreviewQueue({ files, store, processor, clock }),
      policy: async () => {
        const current = await settings.get();
        return { maxFileBytes: current.documentMaxFileBytes, formats: current.documentFormats };
      },
    };
  };

  beforeEach(async () => {
    database = createTestDatabase();
    dir = mkdtempSync(join(tmpdir(), 'vmn-document-files-'));
    root = join(dir, 'documents');
    now = new Date('2026-10-01T08:00:00Z');
    rendered = [];
    previewBytes = 200;
    deps = depsOn(database);
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
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
    for (const [workspace, by] of [
      [home, admin],
      [office, otto],
    ] as const) {
      await setWorkspaceTool({ workspaces, tools: deps.tools, clock }, { actor: by, workspaceId: workspace.id, tool: 'DOCUMENTS', enabled: true });
    }
  });
  afterEach(async () => {
    await deps.previews.idle();
    database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores the original byte for byte and hands it back unchanged, as a download named by the server', async () => {
    const bytes = content('JPEG', 5000);
    const { file, usage } = await upload(bytes, uma, home, 'C:\\photos\\IMG_0042.html');
    expect(file).toMatchObject({ format: 'JPEG', bytes: 5000, originalName: 'IMG_0042.html', pageCount: 1, previewState: 'READY', previewPages: 1, uploadedByName: 'Uma' });
    expect(file.sha256).toBe(sha256(bytes));
    expect(readFileSync(documentFilePath(root, file.sha256))).toEqual(Buffer.from(bytes));
    expect(usage.originals).toBe(5000);
    const original = await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: file.id }); // a GUEST downloads
    expect(original).toMatchObject({ bytes: 5000, contentType: 'image/jpeg', fileName: 'IMG_0042.html.jpg' });
    expect(sha256(await collect(original.stream))).toBe(sha256(bytes));
    // Previews are other files: derived, labelled as JPEG, never the original's bytes.
    const preview = await openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'PREVIEW', page: 0 });
    expect(preview.contentType).toBe('image/jpeg');
    expect(sha256(await collect(preview.stream))).not.toBe(file.sha256);
    expect((await openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'THUMBNAIL', page: 0 })).bytes).toBeGreaterThan(0);
    await expect(openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'PREVIEW', page: 1 })).rejects.toThrow(DocumentFileNotFoundError);
    expect(readdirSync(join(root, '.staging'))).toEqual([]);
  });

  it('lets USER and above upload, every member read, and nobody outside the Workspace do either', async () => {
    const { file } = await upload(content('PNG'), uma);
    await upload(content('PNG'), eddie);
    await upload(content('PNG'), admin);
    await expect(upload(content('PNG'), gus)).rejects.toThrow(NotAuthorizedError);
    await expect(upload(content('PNG'), otto)).rejects.toThrow(WorkspaceNotFoundError);
    for (const member of [gus, uma, eddie, admin]) expect((await getDocumentFile(deps, { actor: member, workspaceId: home.id, fileId: file.id })).id).toBe(file.id);
    const reads = [getDocumentFile, openOriginal, (d: DocumentFileDeps, i: Parameters<typeof openOriginal>[1]) => openDerivative(d, { ...i, kind: 'PREVIEW', page: 0 })] as const;
    for (const read of reads) {
      // Home's id under the outsider's own Workspace: not found. Under Home: the Workspace itself is not found.
      await expect(read(deps, { actor: otto, workspaceId: office.id, fileId: file.id })).rejects.toThrow(DocumentFileNotFoundError);
      await expect(read(deps, { actor: otto, workspaceId: home.id, fileId: file.id })).rejects.toThrow(WorkspaceNotFoundError);
      // The storage name is not an id, and an unknown id looks like a foreign one.
      await expect(read(deps, { actor: uma, workspaceId: home.id, fileId: file.sha256 })).rejects.toThrow(DomainValidationError);
      await expect(read(deps, { actor: uma, workspaceId: home.id, fileId: '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f' })).rejects.toThrow(DocumentFileNotFoundError);
    }
    await expect(documentStorageUsage(deps, { actor: otto, workspaceId: home.id })).rejects.toThrow(WorkspaceNotFoundError);
    // A refused or unauthorised upload never received a byte into the store.
    expect((await deps.store.list()).length).toBe(3 * 3); // three files: original, preview, thumbnail each
  });

  it('does not exist where the Documents tool is switched off — for anyone, and without touching the data', async () => {
    const { file } = await upload(content('PNG'));
    const workspaces = createWorkspaceRepository(database);
    await setWorkspaceTool({ workspaces, tools: deps.tools, clock }, { actor: admin, workspaceId: home.id, tool: 'DOCUMENTS', enabled: false });
    for (const member of [admin, uma, gus]) {
      await expect(getDocumentFile(deps, { actor: member, workspaceId: home.id, fileId: file.id })).rejects.toThrow(ToolNotEnabledError);
      await expect(openOriginal(deps, { actor: member, workspaceId: home.id, fileId: file.id })).rejects.toThrow(ToolNotEnabledError);
      await expect(documentStorageUsage(deps, { actor: member, workspaceId: home.id })).rejects.toThrow(ToolNotEnabledError);
    }
    await expect(upload(content('PNG'), admin)).rejects.toThrow(ToolNotEnabledError);
    await expect(upload(content('PNG'), otto)).rejects.toThrow(WorkspaceNotFoundError); // a non-member learns nothing about tools
    expect((await deps.store.list()).length).toBe(3); // nothing was received, nothing was removed
    await setWorkspaceTool({ workspaces, tools: deps.tools, clock }, { actor: admin, workspaceId: home.id, tool: 'DOCUMENTS', enabled: true });
    expect((await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).id).toBe(file.id);
  });

  it('refuses a disabled actor and re-checks the role inside the write', async () => {
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    // Demoted between the authorization check and the write (the upload is already staged).
    const slow = {
      ...deps,
      processor: {
        ...deps.processor,
        inspect: async (path: string, bytes: number) => {
          await changeMemberRole({ users, workspaces, clock }, { actor: admin, workspaceId: home.id, userId: uma.id, role: 'GUEST' });
          return deps.processor.inspect(path, bytes);
        },
      },
    };
    await expect(uploadDocumentFile(slow, { actor: uma, workspaceId: home.id, name: 'a.png', source: once(content('PNG')) })).rejects.toThrow(NotAuthorizedError);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_files').get()).toEqual({ n: 0 });
    await expect(upload(content('PNG'), { ...eddie, status: 'DISABLED' })).rejects.toThrow(WorkspaceNotFoundError);
  });

  it('refuses what is not an accepted file and keeps nothing of it', async () => {
    await expect(upload(text('MZ this is an executable'), uma, home, 'invoice.pdf')).rejects.toMatchObject({ code: 'unsupported_format' });
    await expect(upload(content('PDF broken'))).rejects.toMatchObject({ code: 'unreadable' });
    await expect(upload(new Uint8Array(0))).rejects.toMatchObject({ code: 'empty' });
    await expect(upload(content('PNG'), uma, home, 'bad\u202Ename.png')).rejects.toThrow(DomainValidationError);
    await expect(upload(content('PNG'), uma, home, '   ')).rejects.toThrow(DomainValidationError);
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_files').get()).toEqual({ n: 0 });
    expect(await deps.store.list()).toEqual([]);
    expect(existsSync(join(root, '.staging')) ? readdirSync(join(root, '.staging')) : []).toEqual([]);
  });

  it('keeps a password-protected PDF and a HEIC as download-only files without a preview', async () => {
    const locked = (await upload(content('PDF locked'))).file;
    expect(locked).toMatchObject({ format: 'PDF', encrypted: true, pageCount: null, previewState: 'NONE', previewPages: 0 });
    const bytes = content('HEIC', 3000);
    const heic = (await upload(bytes, uma, home, 'IMG_1.HEIC')).file;
    expect(heic).toMatchObject({ format: 'HEIC', previewState: 'NONE', previewPages: 0, width: 4032, height: 3024 });
    const original = await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: heic.id });
    expect(original).toMatchObject({ contentType: 'image/heic', fileName: 'IMG_1.HEIC', bytes: 3000 });
    expect(sha256(await collect(original.stream))).toBe(sha256(bytes));
    for (const file of [locked, heic]) {
      await expect(openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'THUMBNAIL', page: 0 })).rejects.toThrow(DocumentFileNotFoundError);
      await expect(openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'PREVIEW', page: 0 })).rejects.toThrow(DocumentFileNotFoundError);
    }
    // Nothing was queued for them, and a restart finds nothing to do.
    expect(await deps.previews.resume()).toBe(0);
    expect((await documentStorageUsage(deps, { actor: gus, workspaceId: home.id })).previews).toBe(0);
  });

  it('applies the instance admin\'s size limit and formats to new uploads only', async () => {
    const big = (await upload(content('PNG', 2_500_000))).file;
    const pdf = (await upload(content('PDF 1'))).file;
    await updateInstanceSettings(settingsDeps(), { actor: admin, settings: { documentMaxFileBytes: 2_000_000, documentFormats: ['JPEG', 'PNG'] } });
    await expect(upload(content('PNG', 2_500_000))).rejects.toMatchObject({ code: 'too_large' });
    await expect(upload(content('PDF 1'))).rejects.toMatchObject({ code: 'format_not_allowed' });
    await upload(content('PNG', 2_000_000)); // exactly the limit
    // Existing larger files and files of a removed format stay readable.
    expect((await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: big.id })).bytes).toBe(2_500_000);
    expect((await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: pdf.id })).contentType).toBe('application/pdf');
    await expect(updateInstanceSettings(settingsDeps(), { actor: eddie, settings: { documentMaxFileBytes: 90_000_000 } })).rejects.toThrow(NotAuthorizedError);
    await expect(updateInstanceSettings(settingsDeps(), { actor: admin, settings: { documentMaxFileBytes: 100_000_001 } })).rejects.toThrow(DomainValidationError);
    await expect(updateInstanceSettings(settingsDeps(), { actor: admin, settings: { documentFormats: ['PDF', 'SVG'] as never } })).rejects.toThrow(DomainValidationError);
    await expect(updateInstanceSettings(settingsDeps(), { actor: admin, settings: { documentFormats: [] } })).rejects.toThrow(DomainValidationError);
    const events = database.sqlite.prepare("SELECT metadata FROM security_events WHERE type = 'INSTANCE_SETTINGS_CHANGED'").all() as { metadata: string }[];
    expect(events.map((event) => JSON.parse(event.metadata) as object)).toEqual([expect.objectContaining({ documentMaxFileBytes: 2_000_000, documentFormats: 'JPEG,PNG' })]);
    // The database refuses values the application would never write.
    expect(() => database.sqlite.prepare('UPDATE instance_settings SET document_max_file_bytes = 500000000').run()).toThrow('invalid document file settings');
    expect(() => database.sqlite.prepare("UPDATE instance_settings SET document_formats = 'PDF,SVG'").run()).toThrow('invalid document file settings');
  });

  describe('storage limit', () => {
    it('starts at 5 GB without configuration and charges identical content once', async () => {
      const bytes = content('PNG', 4000);
      const first = await upload(bytes, uma, home, 'meter.png');
      const again = await upload(bytes, eddie, home, 'meter (copy).png');
      expect(again.file.id).not.toBe(first.file.id); // two files with their own name and uploader …
      expect(again.file).toMatchObject({ originalName: 'meter (copy).png', uploadedByName: 'Eddie', sha256: first.file.sha256 });
      expect(again.usage).toMatchObject({ originals: 4000, limit: 5_000_000_000 }); // … stored and charged once
      expect(again.usage.previews).toBe(first.usage.previews);
      // Another Workspace is charged for its own copy.
      expect((await upload(bytes, otto, office)).usage.originals).toBe(4000);
    });

    it('refuses an upload that does not fit, keeps reading intact, and never deletes when the limit is lowered', async () => {
      const kept = (await upload(content('PNG', 6000))).file;
      const before = await documentStorageUsage(deps, { actor: gus, workspaceId: home.id });
      setLimit(home, before.used + 999);
      const refused = await upload(content('PNG', 1000)).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(StorageFullError);
      expect((refused as StorageFullError).usage).toEqual({ ...before, limit: before.used + 999, ceiling: before.used + 999 });
      setLimit(home, 100); // far below what is stored
      expect(await documentStorageUsage(deps, { actor: gus, workspaceId: home.id })).toEqual({ ...before, limit: 100, ceiling: 100 });
      expect((await collect((await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: kept.id })).stream)).byteLength).toBe(6000);
      expect((await openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: kept.id, kind: 'PREVIEW', page: 0 })).bytes).toBe(200);
      await expect(upload(content('PNG', 10))).rejects.toThrow(StorageFullError);
      expect(() => setLimit(home, -1)).toThrow('invalid storage limit');
    });

    it('lets exactly one of two uploads through when only one fits — on separate database connections', async () => {
      const second = openDatabase(database.path);
      try {
        const other = depsOn(second);
        setLimit(home, 10_000);
        previewBytes = 100;
        const results = await Promise.allSettled([
          uploadDocumentFile(deps, { actor: uma, workspaceId: home.id, name: 'a.png', source: once(content('PNG', 6000)) }),
          uploadDocumentFile(other, { actor: eddie, workspaceId: home.id, name: 'b.png', source: once(content('PNG', 6000)) }),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: expect.any(StorageFullError) });
        expect((await documentStorageUsage(deps, { actor: gus, workspaceId: home.id })).originals).toBe(6000);
      } finally {
        second.close();
      }
    });

    it('keeps the original when its previews no longer fit', async () => {
      previewBytes = 3000;
      setLimit(home, 5000);
      const { file } = await upload(content('PNG', 4000));
      expect(file).toMatchObject({ previewState: 'PARTIAL', previewPages: 0 });
      expect((await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).bytes).toBe(4000);
      expect(await documentStorageUsage(deps, { actor: gus, workspaceId: home.id })).toMatchObject({ originals: 4000, previews: 0, used: 4000, limit: 5000 });
    });
  });

  describe('previews in the background', () => {
    it('draws the first page with the upload and the others afterwards, one page at a time', async () => {
      const { file } = await upload(content('PDF 4'));
      expect(file).toMatchObject({ pageCount: 4, previewState: 'PENDING', previewPages: 1 });
      await deps.previews.idle();
      expect(await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).toMatchObject({ previewState: 'READY', previewPages: 4 });
      expect(rendered).toEqual(['PDF 4#0', 'PDF 4#1', 'PDF 4#2', 'PDF 4#3']);
      for (const page of [0, 1, 2, 3]) expect((await openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'PREVIEW', page })).bytes).toBe(200);
      await expect(openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'PREVIEW', page: 4 })).rejects.toThrow(DocumentFileNotFoundError);
      // Usage counts each derived file once.
      const usage = await documentStorageUsage(deps, { actor: gus, workspaceId: home.id });
      expect(usage.previews).toBe(4 * 200 + (await openDerivative(deps, { actor: gus, workspaceId: home.id, fileId: file.id, kind: 'THUMBNAIL', page: 0 })).bytes);
    });

    it('previews at most 500 pages of a PDF', async () => {
      previewBytes = 60;
      const { file } = await upload(content('PDF 502'));
      await deps.previews.idle();
      expect(await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).toMatchObject({ pageCount: 502, previewState: 'READY', previewPages: 500 });
    });

    it('stops when storage is full, and takes unfinished files up again after a restart', async () => {
      previewBytes = 1000;
      const { file } = await upload(content('PDF 6', 1000));
      const used = await documentStorageUsage(deps, { actor: gus, workspaceId: home.id });
      setLimit(home, used.originals + used.previews + 2500); // room for two more pages
      await deps.previews.idle();
      expect(await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).toMatchObject({ previewState: 'PARTIAL', previewPages: 3 });

      // A second file whose previews were interrupted: a new process finds it by its state.
      setLimit(home, 5_000_000_000);
      const interrupted = (await upload(content('PDF 3'))).file;
      await deps.previews.idle();
      database.sqlite.prepare("DELETE FROM document_file_derivatives WHERE file_id = ? AND page > 0").run(interrupted.id);
      database.sqlite.prepare("UPDATE document_files SET preview_state = 'PENDING' WHERE id = ?").run(interrupted.id);
      const restarted = depsOn(database);
      expect(await restarted.previews.resume()).toBe(1);
      await restarted.previews.idle();
      expect(await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: interrupted.id })).toMatchObject({ previewState: 'READY', previewPages: 3 });
    });

    it('gives up on a file after three failed attempts and leaves the original alone', async () => {
      const { file } = await upload(content('PDF 3'));
      await deps.previews.idle();
      database.sqlite.prepare("DELETE FROM document_file_derivatives WHERE file_id = ? AND page > 0").run(file.id);
      database.sqlite.prepare("UPDATE document_files SET preview_state = 'PENDING', preview_attempts = 0 WHERE id = ?").run(file.id);
      const errors: unknown[] = [];
      const failing = createPreviewQueue({
        files: deps.files,
        store: deps.store,
        clock,
        processor: { ...deps.processor, renderPage: async () => Promise.reject(new Error('parser crashed')) },
        onError: (error) => errors.push(error),
      });
      for (let attempt = 0; attempt < 4; attempt++) {
        await failing.resume();
        await failing.idle();
      }
      expect(errors).toHaveLength(3);
      expect(await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).toMatchObject({ previewState: 'FAILED', previewPages: 1 });
      expect((await openOriginal(deps, { actor: gus, workspaceId: home.id, fileId: file.id })).bytes).toBe(1000);
    });
  });

  it('limits how many uploads one person runs at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waiting = { ...deps, processor: { ...deps.processor, inspect: async (path: string, bytes: number) => (await gate, deps.processor.inspect(path, bytes)) } };
    const running = Array.from({ length: MAX_PARALLEL_UPLOADS_PER_USER }, () => uploadDocumentFile(waiting, { actor: uma, workspaceId: home.id, name: 'a.png', source: once(content('PNG')) }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(upload(content('PNG'), uma)).rejects.toThrow(TooManyUploadsError);
    await upload(content('PNG'), eddie); // someone else is not affected
    release();
    await Promise.all(running);
    await upload(content('PNG'), uma); // slots are free again
  });

  it('removes uploads nothing refers to after a day — files, previews and rows — and nothing earlier', async () => {
    now = new Date(); // files carry real modification times
    const old = (await upload(content('PDF 2'))).file;
    await deps.previews.idle();
    const hashes = (await deps.store.list()).map((entry) => entry.sha256);
    expect(hashes).toHaveLength(4); // original, two pages, thumbnail
    now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS - 60_000);
    expect(await purgeUnusedDocumentFiles(deps)).toEqual({ files: 0 });
    now = new Date(now.getTime() + 120_000);
    const fresh = (await upload(content('PNG'))).file; // uploaded just now: stays
    // An orphan file (a refused upload) and a staged upload a crash left behind, both older than a day.
    const orphan = await deps.store.put(text('orphan'));
    const staged = await deps.store.stage(once(text('left behind')), 100);
    const longAgo = new Date(Date.now() - 2 * DOCUMENT_FILE_PENDING_MS);
    utimesSync(documentFilePath(root, orphan), longAgo, longAgo);
    utimesSync(staged.path, longAgo, longAgo);
    expect((await purgeUnusedDocumentFiles(deps)).files).toBe(4 + 1 + 1);
    await expect(getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: old.id })).rejects.toThrow(DocumentFileNotFoundError);
    expect((await getDocumentFile(deps, { actor: gus, workspaceId: home.id, fileId: fresh.id })).previewPages).toBe(1);
    for (const hash of hashes) expect(await deps.store.locate(hash)).toBeUndefined();
    expect(await deps.store.locate(orphan)).toBeUndefined();
    expect(existsSync(staged.path)).toBe(false);
    expect((await deps.store.list()).length).toBe(3); // the fresh file's original, preview and thumbnail
  });

  it('keeps a stored file that another row still uses when one row is purged', async () => {
    const bytes = content('PNG', 3000);
    await upload(bytes, uma, home);
    now = new Date(now.getTime() + DOCUMENT_FILE_PENDING_MS + 1000);
    const later = (await upload(bytes, otto, office)).file; // same content, another Workspace, uploaded later
    expect((await purgeUnusedDocumentFiles(deps)).files).toBe(0); // Home's row is gone, every file is still used
    expect(database.sqlite.prepare('SELECT count(*) AS n FROM document_files').get()).toEqual({ n: 1 });
    expect((await collect((await openOriginal(deps, { actor: otto, workspaceId: office.id, fileId: later.id })).stream)).byteLength).toBe(3000);
  });

  it('makes stored files immutable at the database level', async () => {
    const { file } = await upload(content('PDF 2'));
    await deps.previews.idle();
    const run = (sql: string) => () => database.sqlite.prepare(sql).run(file.id);
    for (const column of ['sha256', 'bytes', 'format', 'original_name', 'workspace_id', 'page_count', 'uploaded_by_user_id', 'uploaded_by_display_name', 'created_at', 'encrypted']) {
      expect(run(`UPDATE document_files SET ${column} = ${column} WHERE id = ?`)).toThrow('document files are immutable');
    }
    expect(run('UPDATE document_file_derivatives SET bytes = 1 WHERE file_id = ?')).toThrow('derived files are immutable');
    expect(run('DELETE FROM document_files WHERE id = ?')).toThrow('document file still has derived files');
    expect(run("UPDATE document_files SET preview_state = 'READY' WHERE id = ?")).not.toThrow();
    expect(run("UPDATE document_files SET preview_state = 'DONE' WHERE id = ?")).toThrow();
    expect(() => database.sqlite.prepare("UPDATE document_files SET format = 'SVG'").run()).toThrow();
  });
});

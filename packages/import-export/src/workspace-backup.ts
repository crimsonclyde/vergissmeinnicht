// Workspace backup package (section 18): a ZIP (`.vmnbackup`) with a manifest, the Workspace's records as
// NDJSON and its original files, written as a stream with bounded memory. Every entry's SHA-256 is in the
// manifest, plus one hash over the entry list — they detect damage and truncation; they do not prove who
// made a package (anyone can change one and recompute them), so a restore treats every package as hostile.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, fsyncSync, openSync, closeSync, renameSync, statSync } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';

export const WORKSPACE_BACKUP_FORMAT = 'vergissmeinnicht.workspace-backup';
export const WORKSPACE_BACKUP_FORMAT_VERSION = 1;
export const WORKSPACE_BACKUP_EXTENSION = '.vmnbackup';
export const WORKSPACE_BACKUP_MANIFEST = 'manifest.json';

/** What the manifest says about integrity — in the package itself, so nobody mistakes it for a signature. */
export const INTEGRITY_NOTE = 'SHA-256 values detect damaged or incomplete packages. They do not prove who made this package.';

export interface BackupManifestEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface WorkspaceBackupManifest {
  readonly format: typeof WORKSPACE_BACKUP_FORMAT;
  readonly formatVersion: number;
  /** The database level the records were written with (last migration of the source). */
  readonly databaseLevel: string;
  /** The VMN release that wrote it (`development` for a development build). */
  readonly appVersion: string;
  readonly createdAt: string;
  readonly workspace: { readonly name: string };
  readonly counts: Readonly<Record<string, number>>;
  readonly integrity: string;
  readonly entries: readonly BackupManifestEntry[];
  /** SHA-256 over the canonical JSON of `entries`: an added, missing or changed entry changes it. */
  readonly entriesSha256: string;
}

export interface ArchiveSource {
  readonly path: string;
  readonly source: string;
  readonly size: number;
  readonly sha256: string;
  readonly kind: 'data' | 'file';
}

export class WorkspaceBackupWriteError extends Error {
  readonly code: 'hash_mismatch' | 'cancelled';
  constructor(code: 'hash_mismatch' | 'cancelled') {
    super(`Workspace backup: ${code}`);
    this.name = 'WorkspaceBackupWriteError';
    this.code = code;
  }
}

export const entriesSha256 = (entries: readonly BackupManifestEntry[]): string =>
  createHash('sha256')
    .update(JSON.stringify(entries.map((entry) => [entry.path, entry.size, entry.sha256])))
    .digest('hex');

/**
 * Writes the package to `target` (via `<target>.part`, renamed only when complete and flushed to disk).
 * Every entry is hashed again while it is written; a difference from the expected value (a file changed
 * on disk, a broken copy) fails the whole package. `onProgress` gets bytes written so far.
 */
export async function writeWorkspaceBackupArchive(
  input: { readonly entries: readonly ArchiveSource[]; readonly manifest: Omit<WorkspaceBackupManifest, 'entries' | 'entriesSha256' | 'integrity' | 'format' | 'formatVersion'> },
  target: string,
  options: { readonly onProgress?: (done: number) => void; readonly isCancelled?: () => boolean } = {},
): Promise<{ readonly size: number; readonly manifest: WorkspaceBackupManifest }> {
  const part = `${target}.part`;
  const zip = new yazl.ZipFile();
  const output = createWriteStream(part, { flags: 'wx', mode: 0o600 });
  const zipStream = zip.outputStream as unknown as Readable;
  const written = pipeline(zipStream, output);
  // Observed below; a failure before then must not become an unhandled rejection.
  written.catch(() => undefined);
  let done = 0;
  const checks: Promise<void>[] = [];
  const mtime = new Date(input.manifest.createdAt);

  for (const entry of input.entries) {
    const hash = createHash('sha256');
    let failure: WorkspaceBackupWriteError | null = null;
    const check = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        if (options.isCancelled?.() === true) {
          failure = new WorkspaceBackupWriteError('cancelled');
          callback(failure);
          return;
        }
        hash.update(chunk);
        done += chunk.length;
        options.onProgress?.(done);
        callback(null, chunk);
      },
      flush(callback) {
        if (hash.digest('hex') !== entry.sha256) {
          failure = new WorkspaceBackupWriteError('hash_mismatch');
          callback(failure);
          return;
        }
        callback();
      },
    });
    const stream = createReadStream(entry.source).pipe(check);
    checks.push(
      new Promise<void>((resolve, reject) => {
        check.on('end', resolve);
        check.on('error', (error) => reject(failure ?? error));
      }),
    );
    // Originals are stored as they are (already compressed or not worth it); records are compressed.
    zip.addReadStream(stream, entry.path, { mtime, mode: 0o100600, compress: entry.kind === 'data', size: entry.size });
  }

  const entries: BackupManifestEntry[] = input.entries.map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }));
  const manifest: WorkspaceBackupManifest = {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_FORMAT_VERSION,
    ...input.manifest,
    integrity: INTEGRITY_NOTE,
    entries,
    entriesSha256: entriesSha256(entries),
  };
  try {
    await Promise.all(checks);
    // The manifest last: by now every entry has been hashed as written.
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), WORKSPACE_BACKUP_MANIFEST, { mtime, mode: 0o100600 });
    zip.end();
    await written;
  } catch (error) {
    // A failed package is never left looking complete: the stream is stopped and `.part` stays unrenamed (the caller removes the folder).
    zipStream.destroy(error as Error);
    output.destroy();
    throw error;
  }
  const fd = openSync(part, 'r+');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(part, target);
  return { size: statSync(target).size, manifest };
}

/**
 * Opens a package for reading, entry by entry (yauzl on the file — random access, never the whole archive in
 * memory). Names are checked by yauzl's strict mode (no absolute paths, no `..`, no backslashes); 18b adds the
 * full validation (allowed names, limits, hashes, records) on top before anything is restored.
 */
export async function openWorkspaceBackup(path: string): Promise<{
  readonly entries: ReadonlyMap<string, { readonly size: number; readonly compressedSize: number }>;
  read(name: string): Promise<Buffer>;
  close(): void;
}> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, file) => (error === null && file !== undefined ? resolve(file) : reject(error ?? new Error('unreadable')))),
  );
  const entries = new Map<string, yauzl.Entry>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve());
    zip.once('error', reject);
    zip.readEntry();
  });
  return {
    entries: new Map([...entries].map(([name, entry]) => [name, { size: entry.uncompressedSize, compressedSize: entry.compressedSize }])),
    async read(name) {
      const entry = entries.get(name);
      if (entry === undefined) throw new Error('no such entry');
      const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (error, opened) => (error === null && opened !== undefined ? resolve(opened) : reject(error ?? new Error('unreadable')))));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    },
    close() {
      zip.close();
    },
  };
}

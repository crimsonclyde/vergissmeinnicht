// Reading a Workspace backup for a restore (section 18, 18b). Every package is treated as hostile, whatever its
// hashes say: the archive's structure is checked against a strict allowlist and limits before a single byte is
// extracted, every entry is extracted with its size enforced and its SHA-256 compared to the manifest, and the
// manifest's own hash over the entry list must match. Records are checked afterwards by the database layer.
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import yauzl from 'yauzl';
import { z } from 'zod';
import { WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_FORMAT_VERSION, WORKSPACE_BACKUP_MANIFEST, entriesSha256, type WorkspaceBackupManifest } from './workspace-backup.ts';

export type WorkspaceBackupInvalidCode =
  | 'not_a_backup'
  | 'unsupported_format'
  | 'unsupported_version'
  | 'unexpected_entry'
  | 'too_many_entries'
  | 'too_large'
  | 'suspicious_compression'
  | 'manifest_invalid'
  | 'damaged'
  | 'cancelled';

/** The package is refused; `code` is safe to show (never a path or content from the package). */
export class WorkspaceBackupInvalidError extends Error {
  readonly code: WorkspaceBackupInvalidCode;
  constructor(code: WorkspaceBackupInvalidCode) {
    super(`Workspace backup refused: ${code}`);
    this.name = 'WorkspaceBackupInvalidError';
    this.code = code;
  }
}

export interface WorkspaceBackupReadLimits {
  /** Entries in the archive, the manifest included. */
  readonly maxEntries: number;
  /** Sum of the declared uncompressed sizes. */
  readonly maxTotalBytes: number;
  /** Largest single entry (uncompressed). */
  readonly maxEntryBytes: number;
  /** Largest manifest. */
  readonly maxManifestBytes: number;
  /** Highest uncompressed/compressed ratio of a compressed entry above `ratioFloorBytes`. */
  readonly maxRatio: number;
  readonly ratioFloorBytes: number;
}

export const DEFAULT_WORKSPACE_BACKUP_READ_LIMITS: WorkspaceBackupReadLimits = {
  maxEntries: 500_000,
  maxTotalBytes: 64_000_000_000,
  maxEntryBytes: 16_000_000_000,
  maxManifestBytes: 64_000_000,
  maxRatio: 200,
  ratioFloorBytes: 1_000_000,
};

/** The only names a package may contain (no directories, no other files). */
const ENTRY_NAME = /^(?:manifest\.json|data\/[a-z][a-z_]{0,63}\.ndjson|files\/(?:documents|images)\/[0-9a-f]{64})$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** ZIP compression methods: stored and deflate — nothing else is written by VMN. */
const STORED = 0;
const DEFLATE = 8;
/** Unix file type bits in the upper half of the external attributes: 0 (unset) or a regular file. */
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

const manifestSchema = z.strictObject({
  format: z.literal(WORKSPACE_BACKUP_FORMAT),
  formatVersion: z.literal(WORKSPACE_BACKUP_FORMAT_VERSION),
  databaseLevel: z.string().regex(/^\d{4}_[a-z0-9_]{1,64}$/),
  appVersion: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
  createdAt: z.iso.datetime(),
  workspace: z.strictObject({ name: z.string().min(1).max(1000) }),
  counts: z.record(z.string().regex(/^[a-z][a-z_]{0,63}$/), z.number().int().nonnegative()),
  integrity: z.string().max(1000),
  entries: z.array(z.strictObject({ path: z.string().max(200), size: z.number().int().nonnegative(), sha256: z.string().regex(HEX64) })),
  entriesSha256: z.string().regex(HEX64),
});

export interface ExtractedWorkspaceBackup {
  readonly manifest: WorkspaceBackupManifest;
  /** `data/<name>.ndjson` → extracted path, for each data entry. */
  readonly data: ReadonlyMap<string, string>;
  /** Originals by store and SHA-256 → extracted path and size (the content is verified against its name). */
  readonly files: { readonly documents: ReadonlyMap<string, { path: string; size: number }>; readonly images: ReadonlyMap<string, { path: string; size: number }> };
  /** Sum of all entries' sizes (what the extraction occupies). */
  readonly totalBytes: number;
}

export interface WorkspaceBackupReadOptions {
  readonly limits?: WorkspaceBackupReadLimits;
  /** Whether this database level can be restored here (known, and not newer than the server's). */
  readonly supportsLevel: (level: string) => boolean;
  /** Whether `data/<name>.ndjson` is a record type this server knows. */
  readonly knowsData: (name: string) => boolean;
  /** Called with the declared total before anything is extracted; throw to refuse (e.g. disk space). */
  readonly beforeExtract?: (totalBytes: number) => void | Promise<void>;
  readonly onProgress?: (done: number, total: number) => void | Promise<void>;
  readonly isCancelled?: () => boolean;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, strictFileNames: true, validateEntrySizes: true }, (error, file) =>
      error === null && file !== undefined ? resolve(file) : reject(new WorkspaceBackupInvalidError('not_a_backup')),
    ),
  );
}

/** The central directory, checked entry by entry; stops at the first violation or past `maxEntries`. */
function listEntries(zip: yauzl.ZipFile, limits: WorkspaceBackupReadLimits): Promise<Map<string, yauzl.Entry>> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, yauzl.Entry>();
    let total = 0;
    const fail = (code: WorkspaceBackupInvalidCode) => {
      zip.removeAllListeners('entry');
      reject(new WorkspaceBackupInvalidError(code));
    };
    if (zip.entryCount > limits.maxEntries) {
      fail('too_many_entries');
      return;
    }
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      if (!ENTRY_NAME.test(name) || entries.has(name)) return fail('unexpected_entry');
      const type = (entry.externalFileAttributes >>> 16) & S_IFMT;
      if (type !== 0 && type !== S_IFREG) return fail('unexpected_entry');
      if (entry.isEncrypted() || (entry.compressionMethod !== STORED && entry.compressionMethod !== DEFLATE)) return fail('unexpected_entry');
      const size = entry.uncompressedSize;
      if (size > limits.maxEntryBytes || (name === WORKSPACE_BACKUP_MANIFEST && size > limits.maxManifestBytes)) return fail('too_large');
      if (entry.compressionMethod === STORED && entry.compressedSize !== size) return fail('damaged');
      if (entry.compressionMethod === DEFLATE && size > limits.ratioFloorBytes && size > entry.compressedSize * limits.maxRatio) return fail('suspicious_compression');
      total += size;
      if (total > limits.maxTotalBytes) return fail('too_large');
      entries.set(name, entry);
      if (entries.size > limits.maxEntries) return fail('too_many_entries');
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', () => reject(new WorkspaceBackupInvalidError('damaged')));
    zip.readEntry();
  });
}

function openEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) => (error === null && stream !== undefined ? resolve(stream) : reject(new WorkspaceBackupInvalidError('damaged')))),
  );
}

async function readManifest(zip: yauzl.ZipFile, entry: yauzl.Entry | undefined): Promise<WorkspaceBackupManifest> {
  if (entry === undefined) throw new WorkspaceBackupInvalidError('not_a_backup');
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of await openEntry(zip, entry)) chunks.push(chunk as Buffer);
  } catch {
    throw new WorkspaceBackupInvalidError('damaged');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WorkspaceBackupInvalidError('manifest_invalid');
  }
  // Format and version first, so an unknown or newer package gets that answer rather than "invalid".
  const head = z.object({ format: z.unknown(), formatVersion: z.unknown() }).safeParse(raw);
  if (!head.success || head.data.format !== WORKSPACE_BACKUP_FORMAT) throw new WorkspaceBackupInvalidError('not_a_backup');
  if (head.data.formatVersion !== WORKSPACE_BACKUP_FORMAT_VERSION) throw new WorkspaceBackupInvalidError('unsupported_format');
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new WorkspaceBackupInvalidError('manifest_invalid');
  return parsed.data;
}

/** Streams one entry to `target` (created new, 0600), enforcing its size and comparing its SHA-256. */
async function extractEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string, expected: { size: number; sha256: string }, onBytes: (n: number) => Promise<void>, isCancelled: () => boolean): Promise<void> {
  const hash = createHash('sha256');
  let size = 0;
  const handle = await open(target, 'wx', 0o600);
  try {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await openEntry(zip, entry);
    } catch (error) {
      throw error instanceof WorkspaceBackupInvalidError ? error : new WorkspaceBackupInvalidError('damaged');
    }
    try {
      for await (const chunk of stream) {
        if (isCancelled()) throw new WorkspaceBackupInvalidError('cancelled');
        const bytes = chunk as Buffer;
        size += bytes.length;
        if (size > expected.size) throw new WorkspaceBackupInvalidError('damaged');
        hash.update(bytes);
        await handle.write(bytes);
        await onBytes(bytes.length);
      }
    } catch (error) {
      throw error instanceof WorkspaceBackupInvalidError ? error : new WorkspaceBackupInvalidError('damaged');
    }
  } finally {
    await handle.close();
  }
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new WorkspaceBackupInvalidError('damaged');
}

/**
 * Checks a package and extracts it into `stagingDir` (which must be empty and private to this job): the entries
 * must be exactly those the manifest lists — with the declared sizes, the content matching each SHA-256, file
 * names matching their content hash — and the manifest's own hash over that list must match. Throws
 * `WorkspaceBackupInvalidError` on the first problem; the caller removes `stagingDir` then.
 */
export async function extractWorkspaceBackup(path: string, stagingDir: string, options: WorkspaceBackupReadOptions): Promise<ExtractedWorkspaceBackup> {
  const limits = options.limits ?? DEFAULT_WORKSPACE_BACKUP_READ_LIMITS;
  const isCancelled = options.isCancelled ?? (() => false);
  const zip = await openZip(path);
  try {
    const entries = await listEntries(zip, limits);
    const manifest = await readManifest(zip, entries.get(WORKSPACE_BACKUP_MANIFEST));
    if (!options.supportsLevel(manifest.databaseLevel)) throw new WorkspaceBackupInvalidError('unsupported_version');
    if (entriesSha256(manifest.entries) !== manifest.entriesSha256) throw new WorkspaceBackupInvalidError('damaged');

    // The manifest's list and the archive's entries must be the same set — nothing missing, nothing extra.
    const listed = new Map<string, { size: number; sha256: string }>();
    for (const item of manifest.entries) {
      if (item.path === WORKSPACE_BACKUP_MANIFEST || !ENTRY_NAME.test(item.path) || listed.has(item.path)) throw new WorkspaceBackupInvalidError('manifest_invalid');
      listed.set(item.path, { size: item.size, sha256: item.sha256 });
    }
    if (listed.size !== entries.size - 1) throw new WorkspaceBackupInvalidError('unexpected_entry');
    let total = 0;
    for (const [name, item] of listed) {
      const entry = entries.get(name);
      if (entry === undefined) throw new WorkspaceBackupInvalidError('unexpected_entry');
      if (entry.uncompressedSize !== item.size) throw new WorkspaceBackupInvalidError('damaged');
      if (name.startsWith('data/') && !options.knowsData(name.slice('data/'.length, -'.ndjson'.length))) throw new WorkspaceBackupInvalidError('unexpected_entry');
      // A file is named by its content: the name must be the hash the manifest lists for it.
      if (name.startsWith('files/') && name.slice(name.lastIndexOf('/') + 1) !== item.sha256) throw new WorkspaceBackupInvalidError('damaged');
      total += item.size;
    }
    await options.beforeExtract?.(total);

    mkdirSync(join(stagingDir, 'data'), { recursive: true, mode: 0o700 });
    mkdirSync(join(stagingDir, 'files', 'documents'), { recursive: true, mode: 0o700 });
    mkdirSync(join(stagingDir, 'files', 'images'), { recursive: true, mode: 0o700 });
    const data = new Map<string, string>();
    const documents = new Map<string, { path: string; size: number }>();
    const images = new Map<string, { path: string; size: number }>();
    let done = 0;
    const onBytes = async (n: number) => {
      done += n;
      await options.onProgress?.(done, total);
    };
    for (const [name, item] of listed) {
      if (isCancelled()) throw new WorkspaceBackupInvalidError('cancelled');
      const entry = entries.get(name) as yauzl.Entry;
      // Names are allowlisted above (no separators beyond the fixed folders), so these joins stay inside stagingDir.
      const target = join(stagingDir, name);
      await extractEntry(zip, entry, target, item, onBytes, isCancelled);
      if (name.startsWith('data/')) data.set(name.slice('data/'.length, -'.ndjson'.length), target);
      else if (name.startsWith('files/documents/')) documents.set(item.sha256, { path: target, size: item.size });
      else images.set(item.sha256, { path: target, size: item.size });
    }
    return { manifest, data, files: { documents, images }, totalBytes: total };
  } finally {
    zip.close();
  }
}

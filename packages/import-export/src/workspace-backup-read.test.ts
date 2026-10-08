import { createHash } from 'node:crypto';
import { createWriteStream, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { DEFAULT_WORKSPACE_BACKUP_READ_LIMITS, extractWorkspaceBackup, WorkspaceBackupInvalidError, type WorkspaceBackupReadOptions } from './workspace-backup-read.ts';
import { entriesSha256, INTEGRITY_NOTE, WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_FORMAT_VERSION, type BackupManifestEntry } from './workspace-backup.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const ORIGINAL = Buffer.from('%PDF-1.7 original bytes');
const RECORDS = Buffer.from('{"id":"a"}\n{"id":"b"}\n');

interface Entry {
  readonly name: string;
  readonly bytes: Buffer;
  readonly compress?: boolean;
  readonly mode?: number;
  /** Listed in the manifest (default) — false adds it to the archive only. */
  readonly listed?: boolean;
  /** Written to the archive (default) — false lists it in the manifest only. */
  readonly written?: boolean;
}

function standard(): Entry[] {
  return [
    { name: 'data/persons.ndjson', bytes: Buffer.from('{"ref":"person-1","displayName":"Ada","email":null}\n'), compress: true },
    { name: 'data/runs.ndjson', bytes: RECORDS, compress: true },
    { name: `files/documents/${sha(ORIGINAL)}`, bytes: ORIGINAL },
  ];
}

describe('reading a Workspace backup (18b): every package is hostile until checked', () => {
  let dir: string;
  let n = 0;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-backup-read-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const options: WorkspaceBackupReadOptions = { supportsLevel: (level) => level === '0045_imported_identities', knowsData: (name) => ['persons', 'runs'].includes(name) };

  async function archive(entries: readonly Entry[], change: (manifest: Record<string, unknown>) => void = () => undefined, extra: (zip: yazl.ZipFile) => void = () => undefined): Promise<string> {
    const listed: BackupManifestEntry[] = entries.filter((entry) => entry.listed !== false).map((entry) => ({ path: entry.name, size: entry.bytes.length, sha256: sha(entry.bytes) }));
    const manifest: Record<string, unknown> = {
      format: WORKSPACE_BACKUP_FORMAT,
      formatVersion: WORKSPACE_BACKUP_FORMAT_VERSION,
      databaseLevel: '0045_imported_identities',
      appVersion: '0.6.0-beta.3',
      createdAt: '2026-10-08T10:00:00.000Z',
      workspace: { name: 'Home ✨' },
      counts: { runs: 2 },
      integrity: INTEGRITY_NOTE,
      entries: listed,
      entriesSha256: entriesSha256(listed),
    };
    change(manifest);
    const zip = new yazl.ZipFile();
    for (const entry of entries) {
      if (entry.written === false) continue;
      zip.addBuffer(entry.bytes, entry.name, { compress: entry.compress ?? false, mode: entry.mode ?? 0o100600 });
    }
    extra(zip);
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', { compress: true });
    zip.end();
    const path = join(dir, `package-${++n}.vmnbackup`);
    await pipeline(zip.outputStream as unknown as Readable, createWriteStream(path));
    return path;
  }

  async function refused(path: string, readOptions: WorkspaceBackupReadOptions = options): Promise<string> {
    const staging = join(dir, `staging-${++n}`);
    try {
      await extractWorkspaceBackup(path, staging, readOptions);
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceBackupInvalidError);
      return (error as WorkspaceBackupInvalidError).code;
    }
    throw new Error('accepted');
  }

  it('extracts a valid package: records and originals verified, nothing else written', async () => {
    const staging = join(dir, 'staging');
    const result = await extractWorkspaceBackup(await archive(standard()), staging, options);
    expect(result.manifest.workspace.name).toBe('Home ✨');
    expect([...result.data.keys()].sort()).toEqual(['persons', 'runs']);
    expect(readFileSync(result.data.get('runs') as string)).toEqual(RECORDS);
    expect(readFileSync(result.files.documents.get(sha(ORIGINAL))?.path as string)).toEqual(ORIGINAL);
    expect(result.totalBytes).toBe(standard().reduce((sum, entry) => sum + entry.bytes.length, 0));
    expect(readdirSync(join(staging, 'files', 'documents'))).toEqual([sha(ORIGINAL)]);
  });

  it('refuses what is not a backup, a damaged archive, and an unknown or newer format', async () => {
    const text = join(dir, 'text.vmnbackup');
    writeFileSync(text, 'just text');
    expect(await refused(text)).toBe('not_a_backup');
    const good = readFileSync(await archive(standard()));
    const truncated = join(dir, 'truncated.vmnbackup');
    writeFileSync(truncated, good.subarray(0, good.length - 40));
    expect(await refused(truncated)).toBe('not_a_backup');
    expect(await refused(await archive(standard(), (m) => (m.format = 'something.else')))).toBe('not_a_backup');
    expect(await refused(await archive(standard(), (m) => (m.formatVersion = 2)))).toBe('unsupported_format');
    expect(await refused(await archive(standard(), (m) => (m.databaseLevel = '9999_from_the_future')))).toBe('unsupported_version');
    expect(await refused(await archive(standard(), (m) => (m.surprise = true)))).toBe('manifest_invalid');
    expect(await refused(await archive(standard(), (m) => (m.workspace = { name: '' })))).toBe('manifest_invalid');
    const noManifest = new yazl.ZipFile();
    noManifest.addBuffer(RECORDS, 'data/runs.ndjson');
    noManifest.end();
    const path = join(dir, 'no-manifest.vmnbackup');
    await pipeline(noManifest.outputStream as unknown as Readable, createWriteStream(path));
    expect(await refused(path)).toBe('not_a_backup');
  });

  it('refuses unexpected entries: path traversal, directories, links, duplicates, unknown or unlisted names', async () => {
    // Names a writer would refuse are put in as a same-length placeholder and patched in the finished archive.
    const zipWith = async (name: string) => {
      const placeholder = name.replaceAll('.', 'q').replaceAll('/', 'w').replace(/^[a-z]/, 'z');
      const path = await archive([...standard(), { name: placeholder, bytes: Buffer.from('x'), listed: false }]);
      const bytes = readFileSync(path);
      writeFileSync(path, Buffer.from(bytes.toString('latin1').replaceAll(placeholder, name), 'latin1'));
      return path;
    };
    for (const name of ['data/../../etc/passwd.ndjson', 'files/documents/../../x', '/etc/passwd', 'data\\runs.ndjson', 'other.txt', 'data/runs.json', 'files/previews/aa', 'data/', 'DATA/runs.ndjson']) {
      expect(['unexpected_entry', 'not_a_backup', 'damaged'], name).toContain(await refused(await zipWith(name)));
    }
    // A symbolic link (by its mode), listed properly: refused all the same.
    const link: Entry = { name: 'data/runs.ndjson', bytes: Buffer.from('/etc/passwd'), mode: 0o120777 };
    expect(await refused(await archive([standard()[0] as Entry, link, standard()[2] as Entry]))).toBe('unexpected_entry');
    // Duplicate names: the second copy could differ from what was checked.
    expect(await refused(await archive(standard(), undefined, (zip) => zip.addBuffer(Buffer.from('{"id":"evil"}\n'), 'data/runs.ndjson')))).toBe('unexpected_entry');
    // In the archive but not in the manifest, and in the manifest but not in the archive.
    expect(await refused(await archive([...standard(), { name: 'data/runs_extra.ndjson', bytes: RECORDS, listed: false }]))).toBe('unexpected_entry');
    expect(await refused(await archive([...standard(), { name: 'data/lists.ndjson', bytes: RECORDS, written: false }]))).toBe('unexpected_entry');
    // A record type this server does not know.
    expect(await refused(await archive([...standard(), { name: 'data/secrets.ndjson', bytes: RECORDS }]))).toBe('unexpected_entry');
  });

  it('refuses tampering: a changed entry, a size that is not the declared one, a file not named by its content, a changed list', async () => {
    const tampered = standard().map((entry) => (entry.name === 'data/runs.ndjson' ? { ...entry, bytes: Buffer.from('{"id":"a"}\n{"id":"X"}\n') } : entry));
    // The manifest still lists the original hash of the records.
    expect(
      await refused(
        await archive(tampered, (m) => {
          const entries = m.entries as BackupManifestEntry[];
          const runs = entries.find((entry) => entry.path === 'data/runs.ndjson') as { sha256: string };
          runs.sha256 = sha(RECORDS);
          m.entriesSha256 = entriesSha256(entries);
        }),
      ),
    ).toBe('damaged');
    expect(await refused(await archive(standard(), (m) => ((m.entries as { size: number }[])[1] as { size: number }).size++))).toBe('damaged');
    expect(await refused(await archive(standard(), (m) => (m.entriesSha256 = '0'.repeat(64))))).toBe('damaged');
    const misnamed = Buffer.from('%PDF-1.7 other bytes');
    expect(await refused(await archive([...standard().slice(0, 2), { name: `files/documents/${sha(ORIGINAL)}`, bytes: misnamed }]))).toBe('damaged');
  });

  it('refuses archive bombs and oversized packages before extracting anything', async () => {
    const zeros = Buffer.alloc(30_000_000);
    const bomb = await archive([...standard(), { name: 'data/runs_bomb.ndjson', bytes: zeros, compress: true }], undefined);
    expect(await refused(bomb, { ...options, knowsData: () => true })).toBe('suspicious_compression');
    expect(readdirSync(dir).filter((name) => name.startsWith('staging')).flatMap((name) => readdirSync(join(dir, name)))).toEqual([]);
    const limits = DEFAULT_WORKSPACE_BACKUP_READ_LIMITS;
    expect(await refused(await archive(standard()), { ...options, limits: { ...limits, maxEntries: 2 } })).toBe('too_many_entries');
    expect(await refused(await archive(standard()), { ...options, limits: { ...limits, maxTotalBytes: 50 } })).toBe('too_large');
    expect(await refused(await archive(standard()), { ...options, limits: { ...limits, maxEntryBytes: 30 } })).toBe('too_large');
    expect(await refused(await archive(standard()), { ...options, limits: { ...limits, maxManifestBytes: 100 } })).toBe('too_large');
  });

  it('lets the caller refuse before extraction (disk space) and stops when cancelled', async () => {
    const path = await archive(standard());
    const full = await extractWorkspaceBackup(path, join(dir, 'probe'), options).then(
      () => 'accepted',
      () => 'refused',
    );
    expect(full).toBe('accepted');
    await expect(
      extractWorkspaceBackup(path, join(dir, 'space'), {
        ...options,
        beforeExtract: () => {
          throw new Error('insufficient_space');
        },
      }),
    ).rejects.toThrow('insufficient_space');
    expect(await refused(path, { ...options, isCancelled: () => true })).toBe('cancelled');
  });
});

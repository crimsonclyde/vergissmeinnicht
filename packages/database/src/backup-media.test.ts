import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_PENDING_MS, createProcedure, createWorkspace, purgeUnusedImages, startRun, uploadStepImage, type ImageDeps, type ProcedureInput } from '@vergissmeinnicht/application';
import { normalizeEmail, type ProcedureId, type User, type Workspace } from '@vergissmeinnicht/domain';
import { createFileMediaStore, mediaPath as storePath } from '@vergissmeinnicht/media';
import { BackupError, backupDatabase, backupIfDue, backupMediaPath, defaultMediaPath, listAutomaticBackups, mediaFilePath, restoreDatabase, verifyDatabase } from './backup.ts';
import { openDatabase } from './connection.ts';
import { createImageRepository } from './image-repository.ts';
import { runMigrations } from './migrate.ts';
import { createProcedureRepository } from './procedure-repository.ts';
import { createRunRepository } from './run-repository.ts';
import { createUserRepository } from './user-repository.ts';
import { createConfiguredWorkspaceRepository as createWorkspaceRepository } from './test-support.ts';

const passThrough = { process: async (input: Uint8Array) => ({ jpeg: input, width: 10, height: 10 }) };
const STEP = { description: '', icon: null, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' } as const;

describe('backups with instruction images (14.3, T1)', () => {
  let dir: string;
  let live: string;
  let media: string;
  let database: ReturnType<typeof openDatabase>;
  let deps: ImageDeps;
  let now: Date;
  let ada: User;
  let home: Workspace;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-backup-media-'));
    live = join(dir, 'data', 'vergissmeinnicht.sqlite');
    media = defaultMediaPath(live);
    runMigrations(live);
    database = openDatabase(live);
    now = new Date('2026-10-01T08:00:00Z');
    const clock = { now: () => now };
    const users = createUserRepository(database);
    const workspaces = createWorkspaceRepository(database);
    ada = await users.create({ email: normalizeEmail('ada@example.org'), displayName: 'Ada', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    home = await createWorkspace({ users, workspaces, clock }, { actor: ada, name: 'Home' });
    deps = { workspaces, images: createImageRepository(database), store: createFileMediaStore(media), processor: passThrough, clock };
  });
  afterEach(() => {
    database.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const upload = async (text: string) => (await uploadStepImage(deps, { actor: ada, workspaceId: home.id, bytes: new TextEncoder().encode(text) })).image;
  const useIn = async (imageId: string) => {
    const content: ProcedureInput = { title: 'Leave', description: '', icon: 'home', tags: [], sections: [{ title: 'S', description: '', steps: [{ ...STEP, title: 'Valve', image: { id: imageId, caption: 'Valve' } }] }] };
    const procedureDeps = { workspaces: deps.workspaces, procedures: createProcedureRepository(database), clock: deps.clock };
    const created = await createProcedure(procedureDeps, { actor: ada, workspaceId: home.id, content });
    await startRun({ workspaces: deps.workspaces, runs: createRunRepository(database), clock: deps.clock }, { actor: ada, workspaceId: home.id, procedureId: created.procedure.id as ProcedureId });
  };

  it('keeps the file layout of the media store', () => {
    const sha = 'a'.repeat(64);
    expect(mediaFilePath('/data/media', sha)).toBe(storePath('/data/media', sha));
    expect(defaultMediaPath('/data/vergissmeinnicht.sqlite')).toBe('/data/media');
    expect(backupMediaPath('/data/backups/x.sqlite')).toBe('/data/backups/media');
  });

  it('backs up the files next to the backup and restores them onto a fresh volume', async () => {
    const image = await upload('valve photo');
    await useIn(image.id);
    const backup = join(dir, 'data', 'backups', 'manual.sqlite');
    await backupDatabase(live, backup);
    const stored = mediaFilePath(join(dir, 'data', 'backups', 'media'), image.sha256);
    expect(readFileSync(stored, 'utf8')).toBe('valve photo');
    expect(statSync(stored).mode & 0o777).toBe(0o600);
    expect(verifyDatabase(backup).migrationsPending).toBe(false);

    // A fresh volume: the backup directory copied elsewhere, restored into an empty data directory.
    const target = join(dir, 'fresh', 'vergissmeinnicht.sqlite');
    restoreDatabase(backup, target);
    expect(readFileSync(mediaFilePath(defaultMediaPath(target), image.sha256), 'utf8')).toBe('valve photo');
    const restored = new Database(target, { readonly: true });
    try {
      expect(restored.prepare('SELECT count(*) AS n FROM run_steps WHERE image_id = ?').get(image.id)).toEqual({ n: 1 });
    } finally {
      restored.close();
    }
  });

  it('refuses a backup when a used file is missing; drops unused rows whose file is gone', async () => {
    const used = await upload('used');
    await useIn(used.id);
    const unused = await upload('unused');
    rmSync(mediaFilePath(media, unused.sha256));
    const ok = join(dir, 'b', 'ok.sqlite');
    await backupDatabase(live, ok);
    const sqlite = new Database(ok, { readonly: true });
    try {
      expect(sqlite.prepare('SELECT count(*) AS n FROM step_images').get()).toEqual({ n: 1 });
    } finally {
      sqlite.close();
    }
    rmSync(mediaFilePath(media, used.sha256));
    const broken = join(dir, 'c', 'broken.sqlite');
    await expect(backupDatabase(live, broken)).rejects.toThrow(new BackupError('an image file is missing'));
    expect(existsSync(broken)).toBe(false);
  });

  it('verify fails for a missing or altered image file, and restore then changes nothing', async () => {
    const image = await upload('valve photo');
    await useIn(image.id);
    const backup = join(dir, 'b', 'backup.sqlite');
    await backupDatabase(live, backup);
    const stored = mediaFilePath(backupMediaPath(backup), image.sha256);
    writeFileSync(stored, 'tampered');
    expect(() => verifyDatabase(backup)).toThrow(new BackupError('an image file of the backup is damaged'));
    rmSync(stored);
    expect(() => verifyDatabase(backup)).toThrow(new BackupError('an image file of the backup is missing'));
    const target = join(dir, 'fresh', 'x.sqlite');
    expect(() => restoreDatabase(backup, target)).toThrow(BackupError);
    expect(existsSync(target)).toBe(false);
  });

  it('shares files between scheduled backups and prunes them with the last backup that needs them', async () => {
    const temporary = await upload('never saved');
    const at = (hours: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + hours * 3_600_000);
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(0) });
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(1) });
    const stored = mediaFilePath(join(dir, 'data', 'backups', 'media'), temporary.sha256);
    expect(existsSync(stored)).toBe(true);
    // The upload was never used: housekeeping removes it from the live data.
    now = new Date(now.getTime() + IMAGE_PENDING_MS * 2);
    expect(await purgeUnusedImages(deps)).toEqual({ files: 1 });
    // Relative to the injected backup times, not the wall clock: the file was last used at 0:00.
    utimesSync(stored, at(0), at(0));
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(2) });
    expect(existsSync(stored)).toBe(true); // the backup of 1:00 still needs it
    await backupIfDue(live, { intervalMs: 3_600_000, keep: 2, now: at(3) });
    expect(listAutomaticBackups(live)).toHaveLength(2);
    expect(existsSync(stored)).toBe(false);
  });

  it('housekeeping never removes a file a Run still uses', async () => {
    const image = await upload('valve photo');
    await useIn(image.id);
    now = new Date(now.getTime() + IMAGE_PENDING_MS * 5);
    const old = new Date(now.getTime() - IMAGE_PENDING_MS * 2);
    utimesSync(mediaFilePath(media, image.sha256), old, old);
    expect(await purgeUnusedImages(deps)).toEqual({ files: 0 });
    expect(readFileSync(mediaFilePath(media, image.sha256), 'utf8')).toBe('valve photo');
  });
});

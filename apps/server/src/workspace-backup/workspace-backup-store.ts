import { existsSync, mkdirSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceBackupStoreError, type WorkspaceBackupStore } from '@vergissmeinnicht/application';
import { snapshotWorkspace, WorkspaceExportError, type AppDatabase } from '@vergissmeinnicht/database';
import { WorkspaceBackupWriteError, writeWorkspaceBackupArchive } from '@vergissmeinnicht/import-export';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Room kept free beyond the package itself: the volume also holds the live database. */
const SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const PACKAGE = 'package.vmnbackup';

/**
 * Workspace backup packages in the data volume (section 18a): `<root>/<job id>/` — `0700`, never served
 * statically. The package is written from a staging folder (records + hard-linked originals) and the
 * staging folder is removed as soon as the package is complete.
 */
export function createWorkspaceBackupStore(options: {
  readonly database: Pick<AppDatabase, 'sqlite'>;
  readonly root: string;
  readonly documentsPath: string;
  readonly mediaPath: string;
  readonly appVersion: string;
  readonly now?: () => Date;
  /** Free bytes on the volume (replaced in tests). */
  readonly freeBytes?: (path: string) => number;
}): WorkspaceBackupStore {
  const now = options.now ?? (() => new Date());
  const freeBytes =
    options.freeBytes ??
    ((path: string) => {
      const stats = statfsSync(path);
      return stats.bavail * stats.bsize;
    });
  // Created when the first package is written, not at start-up (a server that never makes one needs no folder).
  const folder = (jobId: string) => {
    // Only ever built from a job id the server generated — never from a request value as such.
    if (!JOB_ID.test(jobId)) throw new WorkspaceBackupStoreError('invalid_job');
    return join(options.root, jobId);
  };

  return {
    async writeExport(job, progress) {
      const dir = folder(job.id);
      mkdirSync(options.root, { recursive: true, mode: 0o700 });
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { mode: 0o700 });
      const staging = join(dir, 'staging');
      progress.onProgress('snapshot', 0, 0);
      let snapshot;
      try {
        snapshot = snapshotWorkspace(options.database, { workspaceId: job.workspaceId, stagingDir: staging, documentsPath: options.documentsPath, mediaPath: options.mediaPath, isCancelled: progress.isCancelled });
      } catch (error) {
        if (error instanceof WorkspaceExportError) throw new WorkspaceBackupStoreError(error.code);
        if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
        throw error;
      }
      const total = snapshot.entries.reduce((sum, entry) => sum + entry.size, 0);
      // The originals are only hard-linked so far; the package needs about their size again (stored, not compressed).
      if (freeBytes(options.root) < total + SPACE_MARGIN_BYTES) throw new WorkspaceBackupStoreError('insufficient_space');
      try {
        const written = await writeWorkspaceBackupArchive(
          {
            entries: snapshot.entries,
            manifest: { databaseLevel: snapshot.databaseLevel, appVersion: options.appVersion, createdAt: now().toISOString(), workspace: { name: snapshot.workspaceName }, counts: snapshot.counts },
          },
          join(dir, PACKAGE),
          { onProgress: (done) => progress.onProgress('archive', done, total), isCancelled: progress.isCancelled },
        );
        return { sizeBytes: written.size, counts: snapshot.counts };
      } catch (error) {
        if (error instanceof WorkspaceBackupWriteError) throw new WorkspaceBackupStoreError(error.code);
        throw error;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    },

    packagePath(jobId) {
      const path = join(folder(jobId), PACKAGE);
      return existsSync(path) ? path : undefined;
    },

    remove(jobId) {
      if (!JOB_ID.test(jobId)) return;
      rmSync(join(options.root, jobId), { recursive: true, force: true });
    },
  };
}

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statfsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { BACKUP_KEEP_MS, WorkspaceBackupStoreError, type DocumentFileProcessor, type DocumentFileStore, type MediaStore, type RestorePreview, type WorkspaceBackupStore } from '@vergissmeinnicht/application';
import {
  completeRestoreIn,
  isRestorableLevel,
  RESTORE_DATA_NAMES,
  restoreWorkspace,
  snapshotWorkspace,
  WorkspaceExportError,
  WorkspaceRestoreError,
  type AppDatabase,
  type RestoredDocumentFileFacts,
} from '@vergissmeinnicht/database';
import type { WorkspaceId } from '@vergissmeinnicht/domain';
import { extractWorkspaceBackup, WorkspaceBackupInvalidError, WorkspaceBackupWriteError, writeWorkspaceBackupArchive, type ExtractedWorkspaceBackup } from '@vergissmeinnicht/import-export';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Room kept free beyond the package itself: the volume also holds the live database. */
const SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
const PACKAGE = 'package.vmnbackup';
/** A restore's upload and its extraction, both inside the job's folder. */
const UPLOAD = 'upload.vmnbackup';
const EXTRACTED = 'extracted';

/** A refusal of a restore as the job's error code (stable; never content or a path of the package). */
function restoreFailure(error: unknown): unknown {
  if (error instanceof WorkspaceBackupInvalidError) return new WorkspaceBackupStoreError(error.code);
  if (error instanceof WorkspaceRestoreError) return new WorkspaceBackupStoreError(error.code);
  return error;
}

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
  /** For restores (18b): the 16.1 checks of every original and instruction image, and the content-addressed stores. */
  readonly restore?: {
    readonly database: AppDatabase;
    readonly processor: DocumentFileProcessor;
    readonly documents: DocumentFileStore;
    readonly images: MediaStore;
    /** After a committed restore: previews and text recognition pick up the new Workspace's files. */
    readonly afterRestore?: () => void;
  };
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

    async receiveUpload(jobId, source, upload) {
      const dir = folder(jobId);
      mkdirSync(options.root, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      const handle = await open(join(dir, UPLOAD), 'wx', 0o600);
      let size = 0;
      try {
        for await (const chunk of source) {
          size += chunk.byteLength;
          if (size > upload.maxBytes) throw new WorkspaceBackupStoreError('too_large');
          // Checked as it grows (every 64 MB): the volume keeps its margin for the live database. The extraction checks for its own room.
          if (size % (64 * 1024 * 1024) < chunk.byteLength && freeBytes(options.root) < SPACE_MARGIN_BYTES) throw new WorkspaceBackupStoreError('insufficient_space');
          await handle.write(chunk);
          upload.onProgress(size);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (size === 0) throw new WorkspaceBackupStoreError('not_a_backup');
      return size;
    },

    async validateRestore(job, progress) {
      const restore = requireRestore();
      const dir = folder(job.id);
      const extracted = await extract(dir, progress);
      progress.onProgress('inspect', 0, extracted.files.documents.size + extracted.files.images.size);
      const facts = await inspectFiles(restore.processor, extracted, progress);
      progress.onProgress('check', 0, 0);
      try {
        const outcome = restoreWorkspace(restore.database, { data: extracted.data, files: facts, admin: { userId: job.requestedByUserId }, at: now(), commit: false });
        const manifest = extracted.manifest;
        const preview: RestorePreview = {
          workspaceName: outcome.workspaceName,
          sourceAppVersion: manifest.appVersion,
          databaseLevel: manifest.databaseLevel,
          createdAt: manifest.createdAt,
          packageBytes: statSync(join(dir, UPLOAD)).size,
          contentBytes: extracted.totalBytes,
          counts: outcome.counts,
          persons: outcome.persons,
          previousMembers: outcome.previousMembers,
          warnings: outcome.warnings,
          schedulesPaused: outcome.schedulesPaused,
          assignmentsCleared: outcome.assignmentsCleared,
          storage: outcome.storage,
        };
        return preview;
      } catch (error) {
        throw restoreFailure(error);
      }
    },

    async restore(job, progress) {
      const restore = requireRestore();
      const dir = folder(job.id);
      // Validated before the confirmation; extracted again (into a fresh folder) so the restore depends on nothing
      // left over — the upload is the only input, and it is checked completely once more.
      const extracted = await extract(dir, progress);
      const facts = await inspectFiles(restore.processor, extracted, progress);
      // Originals into the content-addressed stores first, each verified by its hash as it is written. If the
      // transaction below fails they stay unreferenced and housekeeping removes them; nothing is ever deleted
      // here, so a file another Workspace uses is never touched.
      let done = 0;
      const total = extracted.files.documents.size + extracted.files.images.size;
      for (const [sha256, file] of extracted.files.documents) {
        if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
        const staged = await restore.documents.stage(createReadStream(file.path), file.size);
        if (staged.sha256 !== sha256 || staged.bytes !== file.size) {
          await staged.discard();
          throw new WorkspaceBackupStoreError('file_mismatch');
        }
        await staged.commit();
        progress.onProgress('files', ++done, total);
      }
      for (const [sha256, file] of extracted.files.images) {
        if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
        // Instruction images are small (re-encoded on upload, 14.3); the media store takes them whole.
        if ((await restore.images.put(readFileSync(file.path))) !== sha256) throw new WorkspaceBackupStoreError('file_mismatch');
        progress.onProgress('files', ++done, total);
      }
      if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
      progress.onProgress('records', 0, 0);
      let workspaceId: string;
      try {
        const at = now();
        workspaceId = restoreWorkspace(restore.database, {
          data: extracted.data,
          files: facts,
          admin: { userId: job.requestedByUserId },
          at,
          commit: {
            finish: (tx, outcome) =>
              completeRestoreIn(tx, { jobId: job.id, workspaceId: outcome.workspaceId, counts: outcome.counts, persons: outcome.persons, at, expiresAt: new Date(at.getTime() + BACKUP_KEEP_MS) }),
          },
        }).workspaceId;
      } catch (error) {
        throw restoreFailure(error);
      }
      // Committed: previews and recognition of the new files start in the background — never a reason to fail.
      try {
        restore.afterRestore?.();
      } catch {
        // ignored: housekeeping resumes previews at the latest
      }
      return { workspaceId: workspaceId as WorkspaceId };
    },
  };

  function requireRestore() {
    if (options.restore === undefined) throw new WorkspaceBackupStoreError('unsupported');
    return options.restore;
  }

  /** Checks and extracts the job's upload into a fresh, private folder (see `extractWorkspaceBackup`). */
  async function extract(dir: string, progress: { readonly onProgress: (phase: string, done: number, total: number) => void; readonly isCancelled: () => boolean }): Promise<ExtractedWorkspaceBackup> {
    const restore = requireRestore();
    const upload = join(dir, UPLOAD);
    if (!existsSync(upload)) throw new WorkspaceBackupStoreError('interrupted');
    const target = join(dir, EXTRACTED);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { mode: 0o700 });
    try {
      return await extractWorkspaceBackup(upload, target, {
        supportsLevel: (level) => isRestorableLevel(restore.database.sqlite, level),
        knowsData: (name) => RESTORE_DATA_NAMES.has(name),
        // The extraction, then the originals again in the stores: the volume must hold both, plus the margin.
        beforeExtract: (bytes) => {
          if (freeBytes(options.root) < 2 * bytes + SPACE_MARGIN_BYTES) throw new WorkspaceBackupStoreError('insufficient_space');
        },
        onProgress: (done, total) => progress.onProgress('extract', done, total),
        isCancelled: progress.isCancelled,
      });
    } catch (error) {
      throw restoreFailure(error);
    }
  }
}

/**
 * Every original and instruction image goes through the same checks as an upload (16.1, 14.3): signature,
 * no web markup, header and container structure, a PDF opened in the worker. What the bytes are — format,
 * pages, size, encryption, active content — is taken from this inspection, never from the package.
 */
async function inspectFiles(
  processor: DocumentFileProcessor,
  extracted: ExtractedWorkspaceBackup,
  progress: { readonly onProgress: (phase: string, done: number, total: number) => void; readonly isCancelled: () => boolean },
): Promise<{ documents: Map<string, RestoredDocumentFileFacts>; images: Map<string, { bytes: number }> }> {
  const documents = new Map<string, RestoredDocumentFileFacts>();
  const images = new Map<string, { bytes: number }>();
  const total = extracted.files.documents.size + extracted.files.images.size;
  let done = 0;
  for (const [sha256, file] of extracted.files.documents) {
    if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
    try {
      const inspected = await processor.inspect(file.path, file.size);
      documents.set(sha256, { bytes: file.size, ...inspected });
    } catch {
      throw new WorkspaceBackupStoreError('unsupported_file');
    }
    progress.onProgress('inspect', ++done, total);
  }
  for (const [sha256, file] of extracted.files.images) {
    if (progress.isCancelled()) throw new WorkspaceBackupStoreError('cancelled');
    let format: string;
    try {
      format = (await processor.inspect(file.path, file.size)).format;
    } catch {
      throw new WorkspaceBackupStoreError('unsupported_file');
    }
    // Instruction images are stored as JPEG (re-encoded when uploaded): anything else did not come from VMN.
    if (format !== 'JPEG') throw new WorkspaceBackupStoreError('unsupported_file');
    images.set(sha256, { bytes: file.size });
    progress.onProgress('inspect', ++done, total);
  }
  return { documents, images };
}

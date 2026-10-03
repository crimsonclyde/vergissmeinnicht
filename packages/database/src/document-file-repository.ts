import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { IMAGE_PENDING_MS, type DerivativeRecord, type DocumentFileRecord, type DocumentFileRepository, type RegisterDocumentFileResult } from '@vergissmeinnicht/application';
import { fitsStorage, type DocumentFileId, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import type { AppDatabase } from './connection.ts';
import { documentFileDerivatives, documentFiles, documentPages, runDocumentFiles, workspaceTools } from './schema.ts';
import { storageUsageIn } from './storage-usage.ts';

type Reader = Pick<Transaction, 'select'>;
type Row = typeof documentFiles.$inferSelect;

const previewPages = sql<number>`(select count(*) from ${documentFileDerivatives} where ${documentFileDerivatives.fileId} = ${documentFiles.id} and ${documentFileDerivatives.kind} = 'PREVIEW')`;

const toRecord = (row: Row, pages: number): DocumentFileRecord => ({
  id: row.id as DocumentFileId,
  workspaceId: row.workspaceId as WorkspaceId,
  sha256: row.sha256,
  bytes: row.bytes,
  format: row.format,
  originalName: row.originalName,
  pageCount: row.pageCount,
  width: row.width,
  height: row.height,
  encrypted: row.encrypted,
  activeContent: row.activeContent,
  previewState: row.previewState,
  previewPages: Number(pages),
  uploadedByUserId: row.uploadedByUserId,
  uploadedByName: row.uploadedByDisplayName,
  uploadedAt: row.createdAt,
});

/**
 * What nothing refers to: a file that is on no page of a Document and in no Document version retained
 * for a Run (16.5). Documents in Trash keep their pages, so their files stay. This is the one place
 * that decides what housekeeping may delete (the backup applies the same rule to rows whose file is
 * already gone).
 */
const unreferenced: SQL = sql`not exists (select 1 from ${documentPages} where ${documentPages.fileId} = ${documentFiles.id}) and not exists (select 1 from ${runDocumentFiles} where ${runDocumentFiles.fileId} = ${documentFiles.id})`;

/** Instruction images uploaded within this time count towards the combined storage before a Step uses them (14.3). */
const pendingSince = (at: Date) => new Date(at.getTime() - IMAGE_PENDING_MS);

function findIn(tx: Reader, where: SQL | undefined): DocumentFileRecord | undefined {
  const row = tx.select({ file: documentFiles, pages: previewPages }).from(documentFiles).where(where).get();
  return row === undefined ? undefined : toRecord(row.file, row.pages);
}

/** The files with these ids, for the pages of a Document (order is the caller's). */
export function fileRecords(tx: Reader, fileIds: readonly string[]): Map<string, DocumentFileRecord> {
  if (fileIds.length === 0) return new Map();
  const rows = tx
    .select({ file: documentFiles, pages: previewPages })
    .from(documentFiles)
    .where(inArray(documentFiles.id, [...fileIds]))
    .all();
  return new Map(rows.map((row) => [row.file.id, toRecord(row.file, row.pages)]));
}

/** Document file metadata (16.1). See `DocumentFileRepository`. */
export function createDocumentFileRepository({ db }: Pick<AppDatabase, 'db'>): DocumentFileRepository {
  return {
    async register(input, actor, guard) {
      return db.transaction((tx): RegisterDocumentFileResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        if (tx.select({ enabled: workspaceTools.enabled }).from(workspaceTools)
          .where(and(eq(workspaceTools.workspaceId, input.workspaceId), eq(workspaceTools.tool, 'DOCUMENTS'))).get()?.enabled !== true) {
          return { status: 'tool_disabled' };
        }
        const usage = storageUsageIn(tx, input.workspaceId, pendingSince(input.at));
        // Identical content already in this Workspace is the same stored file: charged once.
        const known =
          tx
            .select({ id: documentFiles.id })
            .from(documentFiles)
            .where(and(eq(documentFiles.workspaceId, input.workspaceId), eq(documentFiles.sha256, input.sha256)))
            .get() !== undefined;
        const adding = known ? 0 : input.bytes;
        if (!fitsStorage(usage.used, adding, usage.limit)) return { status: 'storage_full', usage };
        const row = tx
          .insert(documentFiles)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            sha256: input.sha256,
            bytes: input.bytes,
            format: input.inspected.format,
            originalName: input.originalName,
            pageCount: input.inspected.pageCount,
            width: input.inspected.width,
            height: input.inspected.height,
            encrypted: input.inspected.encrypted,
            activeContent: input.inspected.activeContent,
            previewState: input.previewState,
            uploadedByUserId: actor.userId,
            uploadedByDisplayName: actor.displayName,
            createdAt: input.at,
          })
          .returning()
          .get();
        return { status: 'ok', file: toRecord(row, 0), usage: { ...usage, originals: usage.originals + adding, used: usage.used + adding } };
      }, IMMEDIATE);
    },

    async find(workspaceId, fileId) {
      return findIn(db, and(eq(documentFiles.workspaceId, workspaceId), eq(documentFiles.id, fileId)));
    },

    async findById(fileId) {
      return findIn(db, eq(documentFiles.id, fileId));
    },

    async findDerivative(workspaceId, fileId, kind, page) {
      const row = db
        .select({ derivative: documentFileDerivatives })
        .from(documentFileDerivatives)
        .innerJoin(documentFiles, eq(documentFiles.id, documentFileDerivatives.fileId))
        .where(and(eq(documentFiles.workspaceId, workspaceId), eq(documentFileDerivatives.fileId, fileId), eq(documentFileDerivatives.kind, kind), eq(documentFileDerivatives.page, page)))
        .get();
      if (row === undefined) return undefined;
      const { sha256, bytes, width, height } = row.derivative;
      return { kind, page, sha256, bytes, width, height } satisfies DerivativeRecord;
    },

    async usage(workspaceId, now) {
      return storageUsageIn(db, workspaceId, pendingSince(now));
    },

    async addDerivative(fileId, derivative, at) {
      return db.transaction((tx) => {
        const file = tx.select({ workspaceId: documentFiles.workspaceId }).from(documentFiles).where(eq(documentFiles.id, fileId)).get();
        if (file === undefined) return 'gone';
        const key = and(eq(documentFileDerivatives.fileId, fileId), eq(documentFileDerivatives.kind, derivative.kind), eq(documentFileDerivatives.page, derivative.page));
        if (tx.select({ page: documentFileDerivatives.page }).from(documentFileDerivatives).where(key).get() !== undefined) return 'ok';
        const known =
          tx
            .select({ page: documentFileDerivatives.page })
            .from(documentFileDerivatives)
            .innerJoin(documentFiles, eq(documentFiles.id, documentFileDerivatives.fileId))
            .where(and(eq(documentFiles.workspaceId, file.workspaceId), eq(documentFileDerivatives.sha256, derivative.sha256)))
            .get() !== undefined;
        const usage = storageUsageIn(tx, file.workspaceId, pendingSince(at));
        if (!fitsStorage(usage.used, known ? 0 : derivative.bytes, usage.limit)) return 'storage_full';
        tx.insert(documentFileDerivatives)
          .values({ fileId, kind: derivative.kind, page: derivative.page, sha256: derivative.sha256, bytes: derivative.bytes, width: derivative.width, height: derivative.height, createdAt: at })
          .run();
        return 'ok';
      }, IMMEDIATE);
    },

    async setPreviewState(fileId, state, attempted) {
      db.update(documentFiles)
        .set({ previewState: state, ...(attempted ? { previewAttempts: sql`${documentFiles.previewAttempts} + 1` } : {}) })
        .where(eq(documentFiles.id, fileId))
        .run();
    },

    async pendingPreviews(maxAttempts, limit) {
      return db.transaction((tx) => {
        tx.update(documentFiles)
          .set({ previewState: 'FAILED' })
          .where(and(eq(documentFiles.previewState, 'PENDING'), sql`${documentFiles.previewAttempts} >= ${maxAttempts}`))
          .run();
        return tx
          .select({ file: documentFiles, pages: previewPages })
          .from(documentFiles)
          .where(eq(documentFiles.previewState, 'PENDING'))
          .orderBy(asc(documentFiles.createdAt))
          .limit(limit)
          .all()
          .map((row) => toRecord(row.file, row.pages));
      }, IMMEDIATE);
    },

    async purgeUnreferenced(before) {
      return db.transaction((tx) => {
        const stale = tx
          .select({ id: documentFiles.id, sha256: documentFiles.sha256 })
          .from(documentFiles)
          .where(and(lt(documentFiles.createdAt, before), unreferenced))
          .all();
        if (stale.length === 0) return [];
        const ids = stale.map((row) => row.id);
        const derived = tx.select({ sha256: documentFileDerivatives.sha256 }).from(documentFileDerivatives).where(inArray(documentFileDerivatives.fileId, ids)).all();
        tx.delete(documentFileDerivatives).where(inArray(documentFileDerivatives.fileId, ids)).run();
        tx.delete(documentFiles).where(inArray(documentFiles.id, ids)).run();
        const hashes = [...new Set([...stale, ...derived].map((row) => row.sha256))];
        const stillUsed = new Set([
          ...tx.select({ sha256: documentFiles.sha256 }).from(documentFiles).where(inArray(documentFiles.sha256, hashes)).all().map((row) => row.sha256),
          ...tx.select({ sha256: documentFileDerivatives.sha256 }).from(documentFileDerivatives).where(inArray(documentFileDerivatives.sha256, hashes)).all().map((row) => row.sha256),
        ]);
        return hashes.filter((hash) => !stillUsed.has(hash));
      }, IMMEDIATE);
    },

    async usedHashes() {
      return new Set([
        ...db.selectDistinct({ sha256: documentFiles.sha256 }).from(documentFiles).all().map((row) => row.sha256),
        ...db.selectDistinct({ sha256: documentFileDerivatives.sha256 }).from(documentFileDerivatives).all().map((row) => row.sha256),
      ]);
    },
  };
}

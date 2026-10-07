import { and, asc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { CorrectTextResult, DocumentTextRepository, FileText, TextJob } from '@vergissmeinnicht/application';
import { IMAGE_PENDING_MS } from '@vergissmeinnicht/application';
import { TEXT_STATES, fitsStorage, type DocumentFileId, type TextState, type WorkspaceId } from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { documentFileTexts, documentFiles, documentPages, documentSuggestionDismissals, documents, workspaceTools, workspaces } from './schema.ts';
import { storageUsageIn } from './storage-usage.ts';

type Reader = Pick<Transaction, 'select'>;

/** Recognition runs only where the Workspace has Documents **and** recognition switched on (P5). */
const recognitionAllowed: SQL = sql`exists (select 1 from ${workspaces} where ${workspaces.id} = ${documentFileTexts.workspaceId} and ${workspaces.textRecognition} = 1) and exists (select 1 from ${workspaceTools} where ${workspaceTools.workspaceId} = ${documentFileTexts.workspaceId} and ${workspaceTools.tool} = 'DOCUMENTS' and ${workspaceTools.enabled} = 1)`;

/** Waiting, or held by a worker whose lease ran out (a crash or a restart). */
const claimable = (now: Date): SQL =>
  or(
    and(eq(documentFileTexts.state, 'QUEUED'), or(isNull(documentFileTexts.leaseUntil), lte(documentFileTexts.leaseUntil, now))),
    and(eq(documentFileTexts.state, 'PROCESSING'), lte(documentFileTexts.leaseUntil, now)),
  ) as SQL;

/** The claim `job` still holds the file. */
const held = (job: TextJob): SQL => and(eq(documentFileTexts.fileId, job.fileId), eq(documentFileTexts.state, 'PROCESSING'), eq(documentFileTexts.attempts, job.attempt)) as SQL;

const allowedFor = (tx: Reader, fileId: string): boolean =>
  tx.select({ id: documentFileTexts.fileId }).from(documentFileTexts).where(and(eq(documentFileTexts.fileId, fileId), recognitionAllowed)).get() !== undefined;

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

/** The text that counts for search, snippets and suggestions (16.13): a person's correction while there is one, else what was read. */
export const effectiveText = sql<string>`coalesce(${documentFileTexts.correctedText}, ${documentFileTexts.text})`;
export const effectiveSearchText = sql<string>`coalesce(${documentFileTexts.correctedSearchText}, ${documentFileTexts.searchText})`;
/** A file whose text counts: read — or corrected by a person, also where reading failed or is impossible (handwriting, HEIC). */
export const textCounts: SQL = sql`(${documentFileTexts.state} = 'DONE' or ${documentFileTexts.correctedText} is not null)`;

/** The Document (and position) a file is a page of — only a live Document of this Workspace. */
const pageOf = (tx: Reader, workspaceId: string, fileId: string) =>
  tx
    .select({ documentId: documents.id, position: documentPages.position })
    .from(documentPages)
    .innerJoin(documents, eq(documents.id, documentPages.documentId))
    .where(and(eq(documents.workspaceId, workspaceId), eq(documentPages.fileId, fileId), isNull(documents.deletedAt)))
    .get();

const textRow = (tx: Reader, workspaceId: string, fileId: string) =>
  tx
    .select()
    .from(documentFileTexts)
    .where(and(eq(documentFileTexts.workspaceId, workspaceId), eq(documentFileTexts.fileId, fileId)))
    .get();

const toFileText = (row: typeof documentFileTexts.$inferSelect): FileText => ({
  state: row.state,
  source: row.source,
  text: row.text,
  truncated: row.truncated,
  correction:
    row.correctedText === null || row.correctedAt === null || row.correctedByDisplayName === null
      ? null
      : { text: row.correctedText, byName: row.correctedByDisplayName, at: row.correctedAt },
  revision: row.textRevision,
});

/** Text recognition queue and recognised text (16.9). See `DocumentTextRepository`. */
export function createDocumentTextRepository({ db }: Pick<AppDatabase, 'db'>): DocumentTextRepository {
  return {
    async claim(now, leaseMs, maxAttempts) {
      return db.transaction((tx): TextJob | undefined => {
        // A job that kept failing — also one whose worker kept dying (e.g. killed for memory) — stops here.
        tx.update(documentFileTexts)
          .set({ state: 'FAILED', leaseUntil: null, errorCode: sql`coalesce(${documentFileTexts.errorCode}, 'too_complex')`, updatedAt: now })
          .where(and(claimable(now), sql`${documentFileTexts.attempts} >= ${maxAttempts}`))
          .run();
        for (;;) {
          const next = tx
            .select({ text: documentFileTexts, file: { sha256: documentFiles.sha256, format: documentFiles.format, pageCount: documentFiles.pageCount } })
            .from(documentFileTexts)
            .innerJoin(documentFiles, eq(documentFiles.id, documentFileTexts.fileId))
            .where(and(claimable(now), recognitionAllowed))
            .orderBy(asc(documentFileTexts.priority), asc(documentFileTexts.queuedAt), asc(documentFileTexts.fileId))
            .limit(1)
            .get();
          if (next === undefined) return undefined;
          // Identical content already read in this Workspace: the same text, without reading it again.
          const known = tx
            .select({ text: documentFileTexts.text, searchText: documentFileTexts.searchText, source: documentFileTexts.source, bytes: documentFileTexts.bytes, pages: documentFileTexts.pages, truncated: documentFileTexts.truncated })
            .from(documentFileTexts)
            .innerJoin(documentFiles, eq(documentFiles.id, documentFileTexts.fileId))
            .where(and(eq(documentFileTexts.workspaceId, next.text.workspaceId), eq(documentFiles.sha256, next.file.sha256), eq(documentFileTexts.state, 'DONE')))
            .limit(1)
            .get();
          if (known !== undefined) {
            tx.update(documentFileTexts)
              .set({ ...known, state: 'DONE', leaseUntil: null, errorCode: null, updatedAt: now })
              .where(eq(documentFileTexts.fileId, next.text.fileId))
              .run();
            continue;
          }
          const attempt = next.text.attempts + 1;
          tx.update(documentFileTexts)
            .set({ state: 'PROCESSING', attempts: attempt, leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now })
            .where(eq(documentFileTexts.fileId, next.text.fileId))
            .run();
          return {
            fileId: next.text.fileId as DocumentFileId,
            workspaceId: next.text.workspaceId as WorkspaceId,
            sha256: next.file.sha256,
            format: next.file.format,
            pageCount: next.file.pageCount,
            attempt,
          };
        }
      }, IMMEDIATE);
    },

    async extend(job, now, leaseMs) {
      return db.transaction((tx) => {
        if (!allowedFor(tx, job.fileId)) return false;
        return tx.update(documentFileTexts).set({ leaseUntil: new Date(now.getTime() + leaseMs), updatedAt: now }).where(held(job)).returning({ id: documentFileTexts.fileId }).get() !== undefined;
      }, IMMEDIATE);
    },

    async complete(job, result, now) {
      return db.transaction((tx) => {
        if (tx.select({ id: documentFileTexts.fileId }).from(documentFileTexts).where(held(job)).get() === undefined) return 'lost';
        if (!allowedFor(tx, job.fileId)) return 'paused';
        const bytes = byteLength(result.text);
        const usage = storageUsageIn(tx, job.workspaceId, new Date(now.getTime() - IMAGE_PENDING_MS));
        if (!fitsStorage(usage.used, bytes, usage.limit)) {
          tx.update(documentFileTexts).set({ state: 'FAILED', leaseUntil: null, errorCode: 'storage_full', updatedAt: now }).where(held(job)).run();
          return 'storage_full';
        }
        tx.update(documentFileTexts)
          .set({ state: 'DONE', leaseUntil: null, errorCode: null, source: result.source, text: result.text, searchText: result.searchText, bytes, pages: result.pages, truncated: result.truncated, updatedAt: now })
          .where(held(job))
          .run();
        return 'ok';
      }, IMMEDIATE);
    },

    async fail(job, code, now, retryAt) {
      db.update(documentFileTexts)
        .set(retryAt === null ? { state: 'FAILED', leaseUntil: null, errorCode: code.slice(0, 40), updatedAt: now } : { state: 'QUEUED', leaseUntil: retryAt, errorCode: code.slice(0, 40), updatedAt: now })
        .where(held(job))
        .run();
    },

    async release(job, now, wait) {
      db.update(documentFileTexts)
        .set({ state: 'QUEUED', attempts: sql`max(${documentFileTexts.attempts} - 1, 0)`, leaseUntil: wait?.until ?? null, ...(wait === undefined ? {} : { errorCode: wait.code.slice(0, 40) }), updatedAt: now })
        .where(held(job))
        .run();
    },

    async retry(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const row = tx
          .select({ state: documentFileTexts.state })
          .from(documentFileTexts)
          .where(and(eq(documentFileTexts.workspaceId, input.workspaceId), eq(documentFileTexts.fileId, input.fileId)))
          .get();
        if (row === undefined) return 'not_found';
        if (row.state !== 'FAILED') return 'not_failed';
        tx.update(documentFileTexts)
          .set({ state: 'QUEUED', priority: 0, attempts: 0, leaseUntil: null, errorCode: null, queuedAt: input.at, updatedAt: input.at })
          .where(eq(documentFileTexts.fileId, input.fileId))
          .run();
        return 'ok';
      }, IMMEDIATE);
    },

    async suggestionSource(workspaceId, documentId) {
      const row = db
        .select({ position: documentPages.position, text: effectiveText })
        .from(documentPages)
        .innerJoin(documents, eq(documents.id, documentPages.documentId))
        .innerJoin(documentFileTexts, eq(documentFileTexts.fileId, documentPages.fileId))
        .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.deletedAt), textCounts, sql`${effectiveText} <> ''`))
        .orderBy(asc(documentPages.position))
        .limit(1)
        .get();
      return row === undefined ? undefined : { file: row.position + 1, text: row.text };
    },

    async dismissals(workspaceId, documentId) {
      return new Set(
        db
          .select({ key: documentSuggestionDismissals.key })
          .from(documentSuggestionDismissals)
          .where(and(eq(documentSuggestionDismissals.workspaceId, workspaceId), eq(documentSuggestionDismissals.documentId, documentId)))
          .all()
          .map((row) => row.key),
      );
    },

    async dismiss(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const live = tx.select({ id: documents.id }).from(documents).where(and(eq(documents.workspaceId, input.workspaceId), eq(documents.id, input.documentId), isNull(documents.deletedAt))).get();
        if (live === undefined) return 'not_found';
        tx.insert(documentSuggestionDismissals)
          .values({ documentId: input.documentId, workspaceId: input.workspaceId, key: input.key, dismissedByUserId: actor.userId, dismissedAt: input.at })
          .onConflictDoNothing()
          .run();
        return 'ok';
      }, IMMEDIATE);
    },

    async fileText(workspaceId, fileId) {
      return db.transaction((tx) => {
        if (pageOf(tx, workspaceId, fileId) === undefined) return undefined;
        const row = textRow(tx, workspaceId, fileId);
        return row === undefined ? undefined : toFileText(row);
      });
    },

    async correct(input, actor, guard) {
      return db.transaction((tx): CorrectTextResult => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return { status: 'forbidden' };
        const page = pageOf(tx, input.workspaceId, input.fileId);
        const row = page === undefined ? undefined : textRow(tx, input.workspaceId, input.fileId);
        if (page === undefined || row === undefined) return { status: 'not_found' };
        if (row.textRevision !== input.revision) return { status: 'stale' };
        const bytes = byteLength(input.text);
        // A correction replaces the previous one: only growth needs room (shrinking is always possible).
        const usage = storageUsageIn(tx, input.workspaceId, new Date(input.at.getTime() - IMAGE_PENDING_MS));
        if (bytes > row.correctionBytes && !fitsStorage(usage.used - row.correctionBytes, bytes, usage.limit)) return { status: 'storage_full', usage };
        tx.update(documentFileTexts)
          .set({
            correctedText: input.text,
            correctedSearchText: input.searchText,
            correctionBytes: bytes,
            correctedByUserId: actor.userId,
            correctedByDisplayName: actor.displayName,
            correctedAt: input.at,
            textRevision: row.textRevision + 1,
          })
          .where(eq(documentFileTexts.fileId, input.fileId))
          .run();
        // Who, when, which Document and file — never the text.
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_TEXT_CORRECTED',
          actor,
          subjectType: 'document',
          subjectId: page.documentId,
          occurredAt: input.at,
          metadata: { fileId: input.fileId, file: page.position + 1 },
        });
        return { status: 'ok' };
      }, IMMEDIATE);
    },

    async restore(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const page = pageOf(tx, input.workspaceId, input.fileId);
        const row = page === undefined ? undefined : textRow(tx, input.workspaceId, input.fileId);
        if (page === undefined || row === undefined) return 'not_found';
        if (row.textRevision !== input.revision) return 'stale';
        if (row.correctedText === null) return 'ok';
        tx.update(documentFileTexts)
          .set({ correctedText: null, correctedSearchText: null, correctionBytes: 0, correctedByUserId: null, correctedByDisplayName: null, correctedAt: null, textRevision: row.textRevision + 1 })
          .where(eq(documentFileTexts.fileId, input.fileId))
          .run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_TEXT_RESTORED',
          actor,
          subjectType: 'document',
          subjectId: page.documentId,
          occurredAt: input.at,
          metadata: { fileId: input.fileId, file: page.position + 1 },
        });
        return 'ok';
      }, IMMEDIATE);
    },

    async settings(workspaceId) {
      return db.transaction((tx) => {
        const enabled = tx.select({ on: workspaces.textRecognition }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.on ?? false;
        const counts = Object.fromEntries(TEXT_STATES.map((state) => [state, 0])) as Record<TextState, number>;
        for (const row of tx
          .select({ state: documentFileTexts.state, n: sql<number>`count(*)` })
          .from(documentFileTexts)
          .where(eq(documentFileTexts.workspaceId, workspaceId))
          .groupBy(documentFileTexts.state)
          .all()) {
          counts[row.state] = Number(row.n);
        }
        return { enabled, counts };
      });
    },

    async setEnabled(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const current = tx.select({ on: workspaces.textRecognition }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
        if (current === undefined) return 'forbidden';
        if (current.on === input.enabled) return 'ok';
        tx.update(workspaces).set({ textRecognition: input.enabled }).where(eq(workspaces.id, input.workspaceId)).run();
        // Switched off: running work stops at its next page and is given back; text already read stays.
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: input.enabled ? 'TEXT_RECOGNITION_ENABLED' : 'TEXT_RECOGNITION_DISABLED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
        });
        return 'ok';
      }, IMMEDIATE);
    },
  };
}

/** Text rows of files that no Document page and no retained Run version refers to any more — removed at permanent deletion (16.9). */
export function deleteTextsOfFiles(tx: Transaction, fileIds: readonly string[]): void {
  for (let start = 0; start < fileIds.length; start += 500) {
    tx.delete(documentFileTexts).where(inArray(documentFileTexts.fileId, fileIds.slice(start, start + 500))).run();
  }
}

import { randomUUID } from 'node:crypto';
import type { ActorGuard, DocumentTypeView, LinkRefusal, LinkRepository, LinkView, LinkWrite, LinkedRecord, RunDocumentRemoval, RunDocumentView, RunLinkView } from '@vergissmeinnicht/application';
import {
  MAX_DOCUMENTS_PER_RUN,
  MAX_LINKS_PER_DOCUMENT,
  relatedPair,
  type BuiltInDocumentType,
  type DocumentId,
  type DocumentTypeId,
  type LinkId,
  type LinkTarget,
  type LinkTargetType,
  type RunDocumentId,
  type RunDocumentRemovalId,
  type WorkspaceId,
  type WorkspaceTool,
} from '@vergissmeinnicht/domain';
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { fileRecords } from './document-file-repository.ts';
import { contacts, maintenanceRecords, documentFileDerivatives, documentFiles, documentPages, documentTypes, documents, links, occurrences, procedures, runDocumentFiles, runDocumentRemovals, runDocuments, runs, schedules, workspaceTools } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type LinkRow = typeof links.$inferSelect;

class Refusal extends Error {
  readonly status: LinkRefusal;
  constructor(status: LinkRefusal) {
    super(status);
    this.status = status;
  }
}

/** A Document as the other end of a Link: its title and whether it is there, in Trash, or gone. */
function documentRecord(tx: Reader, workspaceId: string, id: string, gone: { at: Date | null; by: string | null }): LinkedRecord {
  if (gone.at !== null) return { type: 'document', id, title: null, state: 'gone', goneAt: gone.at, goneByName: gone.by };
  const row = tx
    .select({ title: documents.title, deletedAt: documents.deletedAt, deletedBy: documents.deletedByDisplayName })
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)))
    .get();
  if (row === undefined) return { type: 'document', id, title: null, state: 'gone', goneAt: null, goneByName: null };
  return row.deletedAt === null ? { type: 'document', id, title: row.title, state: 'ok' } : { type: 'document', id, title: row.title, state: 'trash', goneAt: row.deletedAt, goneByName: row.deletedBy };
}

/**
 * The record at one end of a Link, as far as it may be shown: a title and a state, read within the
 * Workspace. An unknown kind of record is "gone".
 */
export function linkedRecord(tx: Reader, workspaceId: string, kind: string, id: string, gone: { at: Date | null; by: string | null }): LinkedRecord {
  if (kind === 'document') return documentRecord(tx, workspaceId, id, gone);
  if (kind === 'run') {
    const row = tx
      .select({ title: runs.title, state: runs.state })
      .from(runs)
      .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, id)))
      .get();
    return row === undefined ? { type: 'run', id, title: null, state: 'gone' } : { type: 'run', id, title: row.title, state: 'ok', runState: row.state };
  }
  if (kind === 'maintenance') {
    if (gone.at !== null) return { type: 'maintenance', id, title: null, state: 'gone', goneAt: gone.at, goneByName: gone.by };
    const row = tx
      .select({ title: maintenanceRecords.title, deletedAt: maintenanceRecords.deletedAt })
      .from(maintenanceRecords)
      .where(and(eq(maintenanceRecords.workspaceId, workspaceId), eq(maintenanceRecords.id, id)))
      .get();
    if (row === undefined) return { type: 'maintenance', id, title: null, state: 'gone', goneAt: null, goneByName: null };
    // In Trash: that a record is linked, not which one.
    return row.deletedAt === null ? { type: 'maintenance', id, title: row.title, state: 'ok' } : { type: 'maintenance', id, title: null, state: 'trash' };
  }
  if (kind !== 'procedure' && kind !== 'schedule' && kind !== 'contact') return { type: 'procedure', id, title: null, state: 'gone' };
  const type: LinkTargetType = kind;
  if (type === 'contact') {
    // A Contact in Trash or deleted for good is a "deleted contact": never a name.
    if (gone.at !== null) return { type, id, title: null, state: 'gone', goneAt: gone.at, goneByName: gone.by };
    const row = tx
      .select({ name: contacts.name, deletedAt: contacts.deletedAt })
      .from(contacts)
      .where(and(eq(contacts.workspaceId, workspaceId), eq(contacts.id, id)))
      .get();
    if (row === undefined) return { type, id, title: null, state: 'gone', goneAt: null, goneByName: null };
    return row.deletedAt === null ? { type, id, title: row.name, state: 'ok' } : { type, id, title: null, state: 'trash' };
  }
  if (type === 'procedure') {
    const row = tx
      .select({ title: procedures.title, deletedAt: procedures.deletedAt })
      .from(procedures)
      .where(and(eq(procedures.workspaceId, workspaceId), eq(procedures.id, id)))
      .get();
    return row === undefined ? { type, id, title: null, state: 'gone' } : { type, id, title: row.title, state: row.deletedAt === null ? 'ok' : 'deleted' };
  }
  const row = tx
    .select({ kind: schedules.kind, title: schedules.title, state: schedules.state, procedureTitle: procedures.title })
    .from(schedules)
    .leftJoin(procedures, eq(procedures.id, schedules.procedureId))
    .where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.id, id)))
    .get();
  if (row === undefined) return { type, id, title: null, state: 'gone' };
  const next = tx
    .select({ due: occurrences.dueDate })
    .from(occurrences)
    .where(and(eq(occurrences.scheduleId, id), inArray(occurrences.state, ['OPEN', 'IN_PROGRESS'])))
    .orderBy(asc(occurrences.dueDate))
    .limit(1)
    .get();
  return {
    type,
    id,
    title: row.title ?? row.procedureTitle ?? '',
    state: row.state === 'ENDED' ? 'ended' : row.state === 'PAUSED' ? 'paused' : 'ok',
    scheduleKind: row.kind,
    nextDue: next?.due ?? null,
  };
}

/** A Link seen from the Document `from`: the record at the other end. */
function viewFrom(tx: Reader, row: LinkRow, documentId: string): LinkView {
  // The Document is either the near end (it links to something) or the far end — of a related Document,
  // or of a record of another tool that links to it (a MaintenanceRecord's evidence).
  const other =
    row.fromType === 'document' && row.fromId === documentId
      ? linkedRecord(tx, row.workspaceId, row.toType, row.toId, { at: row.toGoneAt, by: row.toGoneByDisplayName })
      : linkedRecord(tx, row.workspaceId, row.fromType, row.fromId, { at: row.fromGoneAt, by: row.fromGoneByDisplayName });
  return { id: row.id as LinkId, record: other, createdAt: row.createdAt, createdByName: row.createdByDisplayName };
}

function toolEnabled(tx: Reader, workspaceId: string, tool: WorkspaceTool = 'DOCUMENTS'): boolean {
  return (
    tx
      .select({ enabled: workspaceTools.enabled })
      .from(workspaceTools)
      .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, tool)))
      .get()?.enabled === true
  );
}

function liveDocument(tx: Reader, workspaceId: string, documentId: string) {
  return tx
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.deletedAt)))
    .get();
}

/** The Links a Document is an end of — as `from` or, for a related Document, as `to`. */
const linksOf = (workspaceId: string, documentId: string) =>
  and(eq(links.workspaceId, workspaceId), or(and(eq(links.fromType, 'document'), eq(links.fromId, documentId), isNull(links.fromGoneAt)), and(eq(links.toType, 'document'), eq(links.toId, documentId), isNull(links.toGoneAt))));

function runDocumentView(tx: Reader, row: typeof runDocuments.$inferSelect): RunDocumentView {
  const fileIds = tx
    .select({ fileId: runDocumentFiles.fileId })
    .from(runDocumentFiles)
    .where(eq(runDocumentFiles.runDocumentId, row.id))
    .orderBy(asc(runDocumentFiles.position))
    .all()
    .map((file) => file.fileId);
  const files = fileRecords(tx, fileIds);
  const source = tx
    .select({ revision: documents.revision, deletedAt: documents.deletedAt })
    .from(documents)
    .where(and(eq(documents.workspaceId, row.workspaceId), eq(documents.id, row.sourceDocumentId)))
    .get();
  const type: DocumentTypeView | null =
    row.typeKey !== null ? { kind: 'builtin', key: row.typeKey as BuiltInDocumentType } : row.typeName !== null ? { kind: 'custom', id: '' as DocumentTypeId, name: row.typeName, retired: false } : null;
  return {
    id: row.id as RunDocumentId,
    sourceDocumentId: row.sourceDocumentId as DocumentId,
    source: source === undefined ? 'gone' : source.deletedAt !== null ? 'trash' : source.revision !== row.sourceRevision ? 'changed' : 'same',
    title: row.title,
    type,
    documentDate: row.documentDate,
    year: row.year,
    notes: row.notes,
    tags: row.tags,
    files: fileIds.flatMap((id) => files.get(id) ?? []),
    linkedAt: row.linkedAt,
    linkedByName: row.linkedByDisplayName,
  };
}

const removalView = (row: typeof runDocumentRemovals.$inferSelect): RunDocumentRemoval => ({
  id: row.id as RunDocumentRemovalId,
  reason: row.reason,
  files: row.files,
  linkedAt: row.linkedAt,
  linkedByName: row.linkedByDisplayName,
  removedAt: row.removedAt,
  removedByName: row.removedByDisplayName,
});

/** Links and Document versions retained for Runs (16.5). See `LinkRepository`. */
export function createLinkRepository({ db }: Pick<AppDatabase, 'db'>): LinkRepository {
  function write<T>(workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard, change: (tx: Transaction) => T): LinkWrite<T> {
    try {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, workspaceId, actor, guard)) throw new Refusal('forbidden');
        if (!toolEnabled(tx, workspaceId)) throw new Refusal('tool_disabled');
        return { status: 'ok' as const, ...change(tx) };
      }, IMMEDIATE);
    } catch (error) {
      if (error instanceof Refusal) return { status: error.status };
      throw error;
    }
  }

  return {
    async listForDocument(workspaceId, documentId) {
      if (liveDocument(db, workspaceId, documentId) === undefined) return undefined;
      const rows = db.select().from(links).where(linksOf(workspaceId, documentId)).orderBy(asc(links.createdAt), asc(links.id)).all();
      const current = liveDocument(db, workspaceId, documentId);
      const retained = db
        .select({ link: runDocuments, title: runs.title, state: runs.state })
        .from(runDocuments)
        .innerJoin(runs, eq(runs.id, runDocuments.runId))
        .where(and(eq(runDocuments.workspaceId, workspaceId), eq(runDocuments.sourceDocumentId, documentId)))
        .orderBy(desc(runDocuments.linkedAt))
        .all();
      return {
        links: rows.map((row) => viewFrom(db, row, documentId)),
        runs: retained.map(
          (row): RunLinkView => ({
            id: row.link.id as RunDocumentId,
            runId: row.link.runId,
            runTitle: row.title,
            runState: row.state,
            linkedAt: row.link.linkedAt,
            linkedByName: row.link.linkedByDisplayName,
            changedSince: current !== undefined && current.revision !== row.link.sourceRevision,
          }),
        ),
      };
    },

    async listForTarget(workspaceId, target) {
      return db
        .select()
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), eq(links.toType, target.type), eq(links.toId, target.id), eq(links.fromType, 'document')))
        .orderBy(asc(links.createdAt), asc(links.id))
        .all()
        .map((row): LinkView => ({ id: row.id as LinkId, record: documentRecord(db, workspaceId, row.fromId, { at: row.fromGoneAt, by: row.fromGoneByDisplayName }), createdAt: row.createdAt, createdByName: row.createdByDisplayName }));
    },

    async add(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const document = liveDocument(tx, input.workspaceId, input.documentId);
        if (document === undefined) throw new Refusal('document_not_found');
        // The other end must be a record of this Workspace that is there: a Document or Contact not in
        // Trash, a Procedure that is not deleted, a Schedule. (The database checks the Workspace once more.)
        // A Contact only where the Contacts tool is on: a tool that is off does not exist.
        if (input.target.type === 'contact' && !toolEnabled(tx, input.workspaceId, 'CONTACTS')) throw new Refusal('target_not_found');
        const target = linkedRecord(tx, input.workspaceId, input.target.type, input.target.id, { at: null, by: null });
        if (target.state === 'gone' || target.state === 'deleted' || target.state === 'trash') throw new Refusal('target_not_found');
        const [fromId, toId] = input.target.type === 'document' ? relatedPair(input.documentId, input.target.id as DocumentId) : [input.documentId, input.target.id];
        const existing = tx
          .select({ id: links.id })
          .from(links)
          .where(and(eq(links.workspaceId, input.workspaceId), eq(links.fromType, 'document'), eq(links.fromId, fromId), eq(links.toType, input.target.type), eq(links.toId, toId)))
          .get();
        if (existing !== undefined) throw new Refusal('already_linked');
        for (const id of input.target.type === 'document' ? [input.documentId, input.target.id] : [input.documentId]) {
          if ((tx.select({ n: count() }).from(links).where(linksOf(input.workspaceId, id)).get()?.n ?? 0) >= MAX_LINKS_PER_DOCUMENT) throw new Refusal('limit_reached');
        }
        const row = tx
          .insert(links)
          .values({ id: randomUUID(), workspaceId: input.workspaceId, fromType: 'document', fromId, toType: input.target.type, toId, createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at })
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_LINK_ADDED',
          actor,
          subjectType: 'document',
          subjectId: input.documentId,
          occurredAt: input.at,
          // A Contact's name is never written to history (it can be deleted for good; history cannot).
          metadata: { title: document.title, linkedType: input.target.type, linkedId: input.target.id, linkedTitle: input.target.type === 'contact' ? '' : (target.title ?? '') },
        });
        return { link: viewFrom(tx, row, input.documentId) };
      });
    },

    async remove(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const row = tx
          .select()
          .from(links)
          // A Document's Link only: a Link between a Contact and a Procedure is the Contacts tool's to remove.
          .where(and(eq(links.workspaceId, input.workspaceId), eq(links.id, input.linkId), eq(links.fromType, 'document')))
          .get();
        if (row === undefined) throw new Refusal('link_not_found');
        tx.delete(links).where(eq(links.id, row.id)).run();
        const from = documentRecord(tx, input.workspaceId, row.fromId, { at: row.fromGoneAt, by: row.fromGoneByDisplayName });
        const to: LinkTarget = { type: row.toType as LinkTargetType, id: row.toId };
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_LINK_REMOVED',
          actor,
          subjectType: 'document',
          subjectId: row.fromId,
          occurredAt: input.at,
          metadata: { title: from.title ?? '', linkedType: to.type, linkedId: to.id, linkedTitle: to.type === 'contact' ? '' : (linkedRecord(tx, input.workspaceId, to.type, to.id, { at: row.toGoneAt, by: row.toGoneByDisplayName }).title ?? '') },
        });
        return {};
      });
    },

    async listForRun(workspaceId, runId) {
      const run = db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)))
        .get();
      if (run === undefined) return undefined;
      const kept = db
        .select()
        .from(runDocuments)
        .where(and(eq(runDocuments.workspaceId, workspaceId), eq(runDocuments.runId, runId)))
        .orderBy(asc(runDocuments.linkedAt), asc(runDocuments.id))
        .all()
        .map((row) => runDocumentView(db, row));
      const removals = db
        .select()
        .from(runDocumentRemovals)
        .where(and(eq(runDocumentRemovals.workspaceId, workspaceId), eq(runDocumentRemovals.runId, runId)))
        .orderBy(asc(runDocumentRemovals.removedAt), asc(runDocumentRemovals.id))
        .all()
        .map(removalView);
      return { documents: kept, removals };
    },

    async removeFromFinishedRun(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const row = tx
          .select({ link: runDocuments, state: runs.state })
          .from(runDocuments)
          .innerJoin(runs, eq(runs.id, runDocuments.runId))
          .where(and(eq(runDocuments.workspaceId, input.workspaceId), eq(runDocuments.runId, input.runId), eq(runDocuments.id, input.runDocumentId)))
          .get();
        if (row === undefined) throw new Refusal('link_not_found');
        if (row.state === 'ACTIVE') throw new Refusal('run_active');
        const fileIds = tx.select({ fileId: runDocumentFiles.fileId }).from(runDocumentFiles).where(eq(runDocumentFiles.runDocumentId, row.link.id)).all().map((file) => file.fileId);
        // The note first: it is what allows the kept rows to be deleted at all (trigger), and it holds
        // nothing of the document — no title, no details, no file reference.
        const note = tx
          .insert(runDocumentRemovals)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            runId: input.runId,
            runDocumentId: row.link.id,
            reason: input.reason,
            files: fileIds.length,
            linkedByDisplayName: row.link.linkedByDisplayName,
            linkedAt: row.link.linkedAt,
            removedByUserId: actor.userId,
            removedByDisplayName: actor.displayName,
            removedAt: input.at,
          })
          .returning()
          .get();
        tx.delete(runDocumentFiles).where(eq(runDocumentFiles.runDocumentId, row.link.id)).run();
        tx.delete(runDocuments).where(eq(runDocuments.id, row.link.id)).run();
        // Files nothing else needs — no Document holds them as a page, no other Run keeps them — lose
        // their rows now: they cannot be opened any more and no longer count. Housekeeping deletes the
        // bytes (unless identical content is still stored under another row).
        let released = 0;
        for (const fileId of fileIds) {
          const needed =
            tx.select({ fileId: documentPages.fileId }).from(documentPages).where(eq(documentPages.fileId, fileId)).get() !== undefined ||
            tx.select({ fileId: runDocumentFiles.fileId }).from(runDocumentFiles).where(eq(runDocumentFiles.fileId, fileId)).get() !== undefined;
          if (needed) continue;
          tx.delete(documentFileDerivatives).where(eq(documentFileDerivatives.fileId, fileId)).run();
          tx.delete(documentFiles).where(and(eq(documentFiles.workspaceId, input.workspaceId), eq(documentFiles.id, fileId))).run();
          released++;
        }
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'RUN_DOCUMENT_REMOVED',
          actor,
          subjectType: 'run',
          subjectId: input.runId,
          runId: input.runId,
          occurredAt: input.at,
          // Why and how much — deliberately not which document.
          metadata: { reason: input.reason, files: fileIds.length },
        });
        return { removal: removalView(note), releasedFiles: released };
      });
    },

    async linkRun(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const run = tx
          .select({ id: runs.id, title: runs.title })
          .from(runs)
          .where(and(eq(runs.workspaceId, input.workspaceId), eq(runs.id, input.runId)))
          .get();
        if (run === undefined) throw new Refusal('run_not_found');
        const document = liveDocument(tx, input.workspaceId, input.documentId);
        if (document === undefined) throw new Refusal('document_not_found');
        const kept = tx
          .select({ source: runDocuments.sourceDocumentId })
          .from(runDocuments)
          .where(eq(runDocuments.runId, run.id))
          .all();
        if (kept.some((each) => each.source === document.id)) throw new Refusal('already_linked');
        if (kept.length >= MAX_DOCUMENTS_PER_RUN) throw new Refusal('limit_reached');
        const typeName = document.typeId === null ? null : (tx.select({ name: documentTypes.name }).from(documentTypes).where(eq(documentTypes.id, document.typeId)).get()?.name ?? null);
        // The version of this moment: the Document's details copied, its files referenced (they are
        // immutable, and this reference keeps them). Nothing of the Run itself is written.
        const row = tx
          .insert(runDocuments)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            runId: run.id,
            sourceDocumentId: document.id,
            sourceRevision: document.revision,
            title: document.title,
            typeKey: document.typeKey,
            typeName,
            documentDate: document.documentDate,
            year: document.year,
            notes: document.notes,
            tags: document.tags,
            linkedByUserId: actor.userId,
            linkedByDisplayName: actor.displayName,
            linkedAt: input.at,
          })
          .returning()
          .get();
        const pages = tx.select({ fileId: documentPages.fileId }).from(documentPages).where(eq(documentPages.documentId, document.id)).orderBy(asc(documentPages.position)).all();
        pages.forEach((page, position) => tx.insert(runDocumentFiles).values({ runDocumentId: row.id, workspaceId: input.workspaceId, position, fileId: page.fileId }).run());
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'RUN_DOCUMENT_LINKED',
          actor,
          subjectType: 'run',
          subjectId: run.id,
          runId: run.id,
          occurredAt: input.at,
          metadata: { documentId: document.id, title: document.title, files: pages.length },
        });
        return { document: runDocumentView(tx, row) };
      });
    },

    async unlinkRun(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const row = tx
          .select({ link: runDocuments, state: runs.state })
          .from(runDocuments)
          .innerJoin(runs, eq(runs.id, runDocuments.runId))
          .where(and(eq(runDocuments.workspaceId, input.workspaceId), eq(runDocuments.runId, input.runId), eq(runDocuments.id, input.runDocumentId)))
          .get();
        if (row === undefined) throw new Refusal('link_not_found');
        // From a finished Run only a Workspace admin removes it, with a reason and a note (`removeFromFinishedRun`).
        if (row.state !== 'ACTIVE') throw new Refusal('run_finished');
        const files = tx.delete(runDocumentFiles).where(eq(runDocumentFiles.runDocumentId, row.link.id)).returning({ fileId: runDocumentFiles.fileId }).all().length;
        tx.delete(runDocuments).where(eq(runDocuments.id, row.link.id)).run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'RUN_DOCUMENT_UNLINKED',
          actor,
          subjectType: 'run',
          subjectId: input.runId,
          runId: input.runId,
          occurredAt: input.at,
          metadata: { documentId: row.link.sourceDocumentId, title: row.link.title, files },
        });
        return {};
      });
    },
  };
}

/**
 * Before Documents, Contacts or MaintenanceRecords are deleted for good: their end of every Link is marked as gone (when,
 * by whom), so the other record can still say that something was linked — without a title or name. A
 * Link whose both ends are gone says nothing to anybody and is removed. Called inside the purging
 * transaction.
 */
export function markLinksOfPurged(tx: Transaction, workspaceId: string, type: 'document' | 'contact' | 'maintenance', recordIds: readonly string[], at: Date, byName: string): void {
  if (recordIds.length === 0) return;
  const ids = [...recordIds];
  tx.update(links)
    .set({ fromGoneAt: at, fromGoneByDisplayName: byName })
    .where(and(eq(links.workspaceId, workspaceId), eq(links.fromType, type), inArray(links.fromId, ids), isNull(links.fromGoneAt)))
    .run();
  tx.update(links)
    .set({ toGoneAt: at, toGoneByDisplayName: byName })
    .where(and(eq(links.workspaceId, workspaceId), eq(links.toType, type), inArray(links.toId, ids), isNull(links.toGoneAt)))
    .run();
  tx.delete(links)
    .where(and(eq(links.workspaceId, workspaceId), sql`${links.fromGoneAt} is not null`, sql`${links.toGoneAt} is not null`))
    .run();
}

export const markLinksOfPurgedDocuments = (tx: Transaction, workspaceId: string, documentIds: readonly string[], at: Date, byName: string): void => markLinksOfPurged(tx, workspaceId, 'document', documentIds, at, byName);

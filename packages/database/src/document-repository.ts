import { STALE_AFTER_MS } from '@vergissmeinnicht/application';
import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type {
  ActorGuard,
  DocumentFilterValues,
  DocumentRecord,
  DocumentRepository,
  DocumentSummary,
  DocumentTypeRecord,
  DocumentTypeView,
  DocumentWrite,
  DocumentWriteRefusal,
  ExportData,
  ExportScope,
  ExportSize,
  ExportedDocument,
  ExportedFile,
  ExportedLink,
  FolderRecord,
  PurgeOutcome,
  RestoreOutcome,
  TrashEntry,
  WorkspaceToolRepository,
} from '@vergissmeinnicht/application';
import {
  MAX_CUSTOM_DOCUMENT_TYPES,
  MAX_DOCUMENTS_PER_WORKSPACE,
  MAX_FOLDERS_PER_WORKSPACE,
  containsPattern,
  documentSearchText,
  documentTagKeys,
  documentTitleKey,
  findSnippet,
  foldSearchText,
  folderDepth,
  folderNameKey,
  folderPlacementProblem,
  isWithin,
  restoreParent,
  restoredFolderName,
  subtreeHeight,
  type DocumentContent,
  type DocumentCursor,
  type DocumentFileId,
  type DocumentId,
  type DocumentQuery,
  type DocumentTypeId,
  type FolderId,
  type FolderNode,
  type WorkspaceId,
  type WorkspaceTool,
} from '@vergissmeinnicht/domain';
import { IMMEDIATE, actorAllowed, type Transaction, type UserActor } from './actor-guard.ts';
import { recordAuditEvent } from './audit-events.ts';
import type { AppDatabase } from './connection.ts';
import { recordToolEnabled } from './tool-policy.ts';
import { fileRecords } from './document-file-repository.ts';
import { deleteTextsOfFiles } from './document-text-repository.ts';
import { markLinksOfPurgedDocuments } from './link-repository.ts';
import { documentFileDerivatives, documentFileTexts, documentFiles, documentSuggestionDismissals, documentFolders, documentPages, documentTypes, documents, links, procedures, runDocumentFiles, runDocuments, runs, schedules, scheduledReminders, occurrences, workspaceTools, workspaces } from './schema.ts';

type Reader = Pick<Transaction, 'select'>;
type FolderRow = typeof documentFolders.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;

/** Rolls the transaction back with a refusal: nothing of a refused write is kept. */
class Refusal extends Error {
  readonly status: DocumentWriteRefusal;
  constructor(status: DocumentWriteRefusal) {
    super(status);
    this.status = status;
  }
}

function toolEnabled(tx: Reader, workspaceId: string, tool: WorkspaceTool): boolean {
  return (
    tx
      .select({ enabled: workspaceTools.enabled })
      .from(workspaceTools)
      .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.tool, tool)))
      .get()?.enabled === true
  );
}

/** Which optional tools a Workspace has switched on. */
export function createWorkspaceToolRepository({ db }: Pick<AppDatabase, 'db'>): WorkspaceToolRepository {
  return {
    async revision(workspaceId) {
      return db.select({ revision: workspaces.toolsRevision }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.revision ?? 0;
    },
    async settings(workspaceId) {
      return db.transaction((tx) => ({
        tools: tx.select({ tool: workspaceTools.tool }).from(workspaceTools).where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.enabled, true))).all().map((row) => row.tool),
        revision: tx.select({ revision: workspaces.toolsRevision }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.revision ?? 0,
      }));
    },
    async enabled(workspaceId) {
      return db
        .select({ tool: workspaceTools.tool })
        .from(workspaceTools)
        .where(and(eq(workspaceTools.workspaceId, workspaceId), eq(workspaceTools.enabled, true)))
        .all()
        .map((row) => row.tool);
    },

    async set(input, actor, guard) {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, input.workspaceId, actor, guard)) return 'forbidden';
        const revision = tx.select({ revision: workspaces.toolsRevision }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get()?.revision;
        if (revision !== input.expectedRevision) return 'conflict';
        if (toolEnabled(tx, input.workspaceId, input.tool) === input.enabled) return 'ok'; // nothing to change, nothing to record
        tx.update(workspaces).set({ toolsRevision: revision + 1 }).where(eq(workspaces.id, input.workspaceId)).run();
        const values = { enabled: input.enabled, updatedAt: input.at, updatedByUserId: actor.userId };
        tx.insert(workspaceTools)
          .values({ workspaceId: input.workspaceId, tool: input.tool, ...values })
          .onConflictDoUpdate({ target: [workspaceTools.workspaceId, workspaceTools.tool], set: values })
          .run();
        // Reenable catches up only the last 24 hours; older notifications are retained as superseded.
        // This is part of the same flag/revision/audit transaction and never changes an Occurrence.
        if (input.enabled && (input.tool === 'PROCEDURES' || input.tool === 'REMINDERS')) {
          const kind = input.tool === 'PROCEDURES' ? 'PROCEDURE' : 'REMINDER';
          tx.update(scheduledReminders).set({ processedAt: input.at, supersededAt: input.at, nextAttemptAt: null })
            .where(and(isNull(scheduledReminders.processedAt), lt(scheduledReminders.remindAt, new Date(input.at.getTime() - STALE_AFTER_MS)), sql`${scheduledReminders.occurrenceId} in (select ${occurrences.id} from ${occurrences} join ${schedules} on ${schedules.id} = ${occurrences.scheduleId} where ${schedules.workspaceId} = ${input.workspaceId} and ${schedules.kind} = ${kind})`)).run();
        }
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: input.enabled ? 'WORKSPACE_TOOL_ENABLED' : 'WORKSPACE_TOOL_DISABLED',
          actor,
          subjectType: 'workspace',
          subjectId: input.workspaceId,
          occurredAt: input.at,
          metadata: { tool: input.tool },
        });
        return 'ok';
      }, IMMEDIATE);
    },
  };
}

const node = (row: FolderRow): FolderNode => ({ id: row.id, parentId: row.parentId, name: row.name, deleted: row.deletedAt !== null });

/** Every Folder of the Workspace, in Trash or not: the tree rules need the whole picture (at most a few thousand rows). */
function allFolders(tx: Reader, workspaceId: string): FolderRow[] {
  return tx.select().from(documentFolders).where(eq(documentFolders.workspaceId, workspaceId)).all();
}

function folderRecord(tx: Reader, row: FolderRow): FolderRecord {
  const documentsIn =
    tx
      .select({ n: count() })
      .from(documents)
      .where(and(eq(documents.folderId, row.id), isNull(documents.deletedAt)))
      .get()?.n ?? 0;
  return { id: row.id as FolderId, parentId: row.parentId as FolderId | null, name: row.name, revision: row.revision, documents: documentsIn };
}

/** Names of the Folders above (and including) `folderId`, outermost first. */
function pathNames(folders: readonly FolderRow[], folderId: string | null): string[] {
  const index = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  for (let current = folderId; current !== null && names.length <= folders.length; ) {
    const folder = index.get(current);
    if (folder === undefined) break;
    names.unshift(folder.name);
    current = folder.parentId;
  }
  return names;
}

function typeView(tx: Reader, row: DocumentRow): DocumentTypeView | null {
  if (row.typeKey !== null) return { kind: 'builtin', key: row.typeKey };
  if (row.typeId === null) return null;
  const type = tx.select().from(documentTypes).where(eq(documentTypes.id, row.typeId)).get();
  return type === undefined ? null : { kind: 'custom', id: type.id as DocumentTypeId, name: type.name, retired: type.retiredAt !== null };
}

function pageFileIds(tx: Reader, documentId: string): string[] {
  return tx
    .select({ fileId: documentPages.fileId })
    .from(documentPages)
    .where(eq(documentPages.documentId, documentId))
    .orderBy(asc(documentPages.position))
    .all()
    .map((row) => row.fileId);
}

function summary(tx: Reader, row: DocumentRow): DocumentSummary {
  const files = pageFileIds(tx, row.id);
  const first = files[0];
  const hasThumbnail =
    first !== undefined &&
    tx
      .select({ page: documentFileDerivatives.page })
      .from(documentFileDerivatives)
      .where(and(eq(documentFileDerivatives.fileId, first), eq(documentFileDerivatives.kind, 'THUMBNAIL')))
      .get() !== undefined;
  return {
    id: row.id as DocumentId,
    folderId: row.folderId as FolderId | null,
    title: row.title,
    type: typeView(tx, row),
    documentDate: row.documentDate,
    year: row.year,
    tags: row.tags,
    revision: row.revision,
    files: files.length,
    cover: first === undefined ? null : { fileId: first as DocumentFileId, hasThumbnail },
    uploadedAt: row.createdAt,
    uploadedByName: row.createdByDisplayName,
    modifiedAt: row.updatedAt,
    modifiedByName: row.updatedByDisplayName,
  };
}

/**
 * The first place a search term occurs in text recognised from the Document's files, in page order
 * (16.9). Called only for Documents already in the asking member's results, so a snippet never says
 * more than the listing itself may.
 */
function withTextMatch(tx: Reader, document: DocumentSummary, terms: readonly string[]): DocumentSummary {
  if (terms.length === 0) return document;
  const any = or(...terms.map((term) => sql`${documentFileTexts.searchText} like ${containsPattern(term)} escape '\\'`));
  const rows = tx
    .select({ position: documentPages.position, text: documentFileTexts.text })
    .from(documentPages)
    .innerJoin(documentFileTexts, eq(documentFileTexts.fileId, documentPages.fileId))
    .where(and(eq(documentPages.documentId, document.id), eq(documentFileTexts.state, 'DONE'), any))
    .orderBy(asc(documentPages.position))
    .limit(1)
    .all();
  const row = rows[0];
  const snippet = row === undefined ? undefined : findSnippet(row.text, terms);
  return { ...document, textMatch: row === undefined || snippet === undefined ? null : { file: row.position + 1, page: snippet.page, snippet: snippet.text } };
}

function record(tx: Reader, row: DocumentRow): DocumentRecord {
  const ids = pageFileIds(tx, row.id);
  const files = fileRecords(tx, ids);
  return { ...summary(tx, row), notes: row.notes, pages: ids.flatMap((id) => files.get(id) ?? []) };
}

function liveDocument(tx: Reader, workspaceId: string, documentId: string): DocumentRow | undefined {
  return tx
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, documentId), isNull(documents.deletedAt)))
    .get();
}

/** The derived columns search, the tag filter and the title order read (16.3): written with every change of content. */
const searchColumns = (content: DocumentContent) => ({
  titleKey: documentTitleKey(content.title),
  tagKeys: documentTagKeys(content.tags),
  searchText: documentSearchText(content),
});

/** Values offered per filter: more would not be a list anyone picks from. */
const FILTER_VALUES_LIMIT = 200;

/**
 * The conditions of a listing besides Workspace and "not in Trash". Every value is a bound parameter;
 * sort and direction never reach SQL as text (they select between fixed columns below).
 */
function matching(query: DocumentQuery, folderIds: readonly string[] | null): SQL[] {
  const where: SQL[] = [];
  if (query.place.kind === 'top') where.push(isNull(documents.folderId));
  if (folderIds !== null) where.push(inArray(documents.folderId, [...folderIds]));
  if (query.type?.kind === 'builtin') where.push(eq(documents.typeKey, query.type.key));
  if (query.type?.kind === 'custom') where.push(eq(documents.typeId, query.type.id));
  if (query.year !== null) where.push(eq(documents.year, query.year));
  if (query.uploader !== null) where.push(eq(documents.createdByDisplayName, query.uploader));
  for (const tag of query.tags) where.push(sql`exists (select 1 from json_each(${documents.tagKeys}) where value = ${tag})`);
  // Each term in the title, tags or notes — or in text recognised from one of the Document's files (16.9).
  for (const term of query.terms) {
    const pattern = containsPattern(term);
    where.push(sql`(${documents.searchText} like ${pattern} escape '\\' or exists (select 1 from ${documentPages} inner join ${documentFileTexts} on ${documentFileTexts.fileId} = ${documentPages.fileId} where ${documentPages.documentId} = ${documents.id} and ${documentFileTexts.state} = 'DONE' and ${documentFileTexts.searchText} like ${pattern} escape '\\'))`);
  }
  return where;
}

/** "Strictly after the cursor" under the order in use, with the id as tie-break. */
function afterCursor(query: DocumentQuery, cursor: DocumentCursor): SQL | undefined {
  const beyond = query.direction === 'asc' ? gt : lt;
  const later = beyond(documents.id, cursor.id);
  if (query.sort === 'documentDate') {
    // Documents without a document date come last in either direction.
    if (cursor.value === null) return and(isNull(documents.documentDate), later);
    const date = String(cursor.value);
    return or(beyond(documents.documentDate, date), and(eq(documents.documentDate, date), later), isNull(documents.documentDate));
  }
  if (query.sort === 'title') {
    const key = String(cursor.value);
    return or(beyond(documents.titleKey, key), and(eq(documents.titleKey, key), later));
  }
  const column = query.sort === 'uploaded' ? documents.createdAt : documents.updatedAt;
  const at = new Date(Number(cursor.value));
  return or(beyond(column, at), and(eq(column, at), later));
}

function ordering(query: DocumentQuery): SQL[] {
  const by = query.direction === 'asc' ? asc : desc;
  const column = { uploaded: documents.createdAt, modified: documents.updatedAt, documentDate: documents.documentDate, title: documents.titleKey }[query.sort];
  // No document date sorts last. Descending that is SQLite's own order (NULL is smallest), so the index serves it; ascending needs saying.
  return [...(query.sort === 'documentDate' && query.direction === 'asc' ? [sql`${documents.documentDate} is null`] : []), by(column), by(documents.id)];
}

const cursorOf = (query: DocumentQuery, row: DocumentRow): DocumentCursor => ({
  id: row.id,
  value: query.sort === 'uploaded' ? row.createdAt.getTime() : query.sort === 'modified' ? row.updatedAt.getTime() : query.sort === 'documentDate' ? row.documentDate : (row.titleKey ?? ''),
});

const typeColumns = (content: DocumentContent) => ({
  typeKey: content.type?.kind === 'builtin' ? content.type.key : null,
  typeId: content.type?.kind === 'custom' ? content.type.id : null,
});

/**
 * Which Documents an export covers — always of this Workspace and never in Trash — and the Folder tree
 * to show them in. `undefined`: the Folder, or one of the Documents chosen, is not there.
 */
function exportScope(tx: Reader, workspaceId: string, scope: ExportScope): { documents: SQL; folders: ExportData['folders']; folder: { id: string; name: string } | null } | undefined {
  const live = and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt)) as SQL;
  const tree = tx
    .select({ id: documentFolders.id, parentId: documentFolders.parentId, name: documentFolders.name })
    .from(documentFolders)
    .where(and(eq(documentFolders.workspaceId, workspaceId), isNull(documentFolders.deletedAt)))
    .all() as { id: FolderId; parentId: FolderId | null; name: string }[];
  if (scope.kind === 'all') return { documents: live, folders: tree, folder: null };
  if (scope.kind === 'folder') {
    const root = tree.find((folder) => folder.id === scope.id);
    if (root === undefined) return undefined;
    const ids: string[] = [root.id];
    for (let index = 0; index < ids.length; index++) ids.push(...tree.filter((folder) => folder.parentId === ids[index]).map((folder) => folder.id));
    // The exported Folder is the top of the archive: what is above it is not part of the export.
    const folders = tree.filter((folder) => ids.includes(folder.id)).map((folder) => (folder.id === root.id ? { ...folder, parentId: null } : folder));
    return { documents: and(live, inArray(documents.folderId, ids)) as SQL, folders, folder: { id: root.id, name: root.name } };
  }
  const chosen = and(live, inArray(documents.id, [...scope.ids])) as SQL;
  if ((tx.select({ n: count() }).from(documents).where(chosen).get()?.n ?? 0) !== scope.ids.length) return undefined;
  return { documents: chosen, folders: tree, folder: null };
}

/**
 * What the Documents of a Workspace are linked to, for an export (16.5): Procedures that are not
 * deleted, Schedules, related Documents that are not in Trash, and Runs that retain a version — all
 * of them records that every member who may export can read. Nothing that is gone or in Trash is named.
 */
function exportedLinks(tx: Reader, workspaceId: string): Map<string, ExportedLink[]> {
  const byDocument = new Map<string, ExportedLink[]>();
  const add = (documentId: string, link: ExportedLink) => byDocument.set(documentId, [...(byDocument.get(documentId) ?? []), link]);
  const procedureTitles = new Map(tx.select({ id: procedures.id, title: procedures.title }).from(procedures).where(and(eq(procedures.workspaceId, workspaceId), isNull(procedures.deletedAt))).all().map((row) => [row.id, row.title]));
  const scheduleRows = new Map(tx.select({ id: schedules.id, kind: schedules.kind, title: schedules.title, procedureId: schedules.procedureId }).from(schedules).where(eq(schedules.workspaceId, workspaceId)).all().map((row) => [row.id, row]));
  const documentTitles = new Map(tx.select({ id: documents.id, title: documents.title }).from(documents).where(and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt))).all().map((row) => [row.id, row.title]));
  for (const row of tx.select().from(links).where(and(eq(links.workspaceId, workspaceId), isNull(links.fromGoneAt), isNull(links.toGoneAt))).all()) {
    if (!recordToolEnabled(tx, workspaceId, row.fromType, row.fromId) || !recordToolEnabled(tx, workspaceId, row.toType, row.toId)) continue;
    if (row.toType === 'procedure') {
      const title = procedureTitles.get(row.toId);
      if (title !== undefined) add(row.fromId, { type: 'procedure', id: row.toId, title });
    } else if (row.toType === 'schedule') {
      const schedule = scheduleRows.get(row.toId);
      if (schedule !== undefined) add(row.fromId, { type: schedule.kind === 'REMINDER' ? 'reminder' : 'scheduled_procedure', id: row.toId, title: schedule.title ?? procedureTitles.get(schedule.procedureId ?? '') ?? '' });
    } else if (row.toType === 'document') {
      const [from, to] = [documentTitles.get(row.fromId), documentTitles.get(row.toId)];
      if (from !== undefined && to !== undefined) {
        add(row.fromId, { type: 'document', id: row.toId, title: to });
        add(row.toId, { type: 'document', id: row.fromId, title: from });
      }
    }
  }
  for (const row of tx.select({ documentId: runDocuments.sourceDocumentId, runId: runs.id, title: runs.title }).from(runDocuments).innerJoin(runs, eq(runs.id, runDocuments.runId)).where(eq(runDocuments.workspaceId, workspaceId)).all()) {
    if (!recordToolEnabled(tx, workspaceId, 'run', row.runId)) continue;
    add(row.documentId, { type: 'run', id: row.runId, title: row.title });
  }
  return byDocument;
}

function exportSizeOf(tx: Reader, where: SQL): ExportSize {
  const totals = tx
    .select({ files: count(), bytes: sql<number>`coalesce(sum(${documentFiles.bytes}), 0)` })
    .from(documentPages)
    .innerJoin(documents, eq(documents.id, documentPages.documentId))
    .innerJoin(documentFiles, eq(documentFiles.id, documentPages.fileId))
    .where(where)
    .get();
  return { documents: tx.select({ n: count() }).from(documents).where(where).get()?.n ?? 0, files: totals?.files ?? 0, bytes: Number(totals?.bytes ?? 0) };
}

/** Folders, Documents and types (16.2). See `DocumentRepository`. */
export function createDocumentRepository({ db }: Pick<AppDatabase, 'db'>): DocumentRepository {
  /** One write: IMMEDIATE transaction, actor and tool re-checked first; a `Refusal` rolls everything back. */
  function write<T>(workspaceId: WorkspaceId, actor: UserActor, guard: ActorGuard, change: (tx: Transaction) => T): DocumentWrite<T> {
    try {
      return db.transaction((tx) => {
        if (!actorAllowed(tx, workspaceId, actor, guard)) throw new Refusal('forbidden');
        if (!toolEnabled(tx, workspaceId, 'DOCUMENTS')) throw new Refusal('tool_disabled');
        return { status: 'ok' as const, ...change(tx) };
      }, IMMEDIATE);
    } catch (error) {
      if (error instanceof Refusal) return { status: error.status };
      throw error;
    }
  }

  function liveFolder(tx: Reader, workspaceId: string, folderId: string): FolderRow {
    const row = tx
      .select()
      .from(documentFolders)
      .where(and(eq(documentFolders.workspaceId, workspaceId), eq(documentFolders.id, folderId), isNull(documentFolders.deletedAt)))
      .get();
    if (row === undefined) throw new Refusal('folder_not_found');
    return row;
  }

  /** The target Folder of a Document must be a live Folder of the Workspace (or the top level). */
  function requireTarget(tx: Reader, workspaceId: string, folderId: string | null): void {
    if (folderId !== null) liveFolder(tx, workspaceId, folderId);
  }

  /** A custom type must be one of this Workspace; a retired one stays on a Document that already has it, and is refused otherwise. */
  function requireType(tx: Reader, workspaceId: string, content: DocumentContent, current: string | null): void {
    if (content.type?.kind !== 'custom') return;
    const type = tx
      .select({ retiredAt: documentTypes.retiredAt })
      .from(documentTypes)
      .where(and(eq(documentTypes.workspaceId, workspaceId), eq(documentTypes.id, content.type.id)))
      .get();
    if (type === undefined || (type.retiredAt !== null && current !== content.type.id)) throw new Refusal('type_not_found');
  }

  /** Writes the pages of a Document in this order. Each file is of this Workspace and on no other Document. */
  function writePages(tx: Transaction, workspaceId: string, documentId: string, fileIds: readonly string[]): void {
    const known = tx
      .select({ id: documentFiles.id })
      .from(documentFiles)
      .where(and(eq(documentFiles.workspaceId, workspaceId), inArray(documentFiles.id, [...fileIds])))
      .all();
    if (known.length !== fileIds.length) throw new Refusal('file_not_found');
    const elsewhere = tx
      .select({ fileId: documentPages.fileId })
      .from(documentPages)
      .where(and(inArray(documentPages.fileId, [...fileIds]), sql`${documentPages.documentId} <> ${documentId}`))
      .get();
    if (elsewhere !== undefined) throw new Refusal('file_in_use');
    tx.delete(documentPages).where(eq(documentPages.documentId, documentId)).run();
    fileIds.forEach((fileId, position) => tx.insert(documentPages).values({ documentId, workspaceId, position, fileId }).run());
  }

  const liveCount = (tx: Reader, table: typeof documents | typeof documentFolders, workspaceId: string) =>
    tx
      .select({ n: count() })
      .from(table)
      .where(and(eq(table.workspaceId, workspaceId), isNull(table.deletedAt)))
      .get()?.n ?? 0;

  /** The Folders of one deletion (`groupId`) that lie at or below `folderId`. */
  function groupSubtree(folders: readonly FolderRow[], groupId: string, folderId: string): FolderRow[] {
    const nodes = folders.map(node);
    return folders.filter((folder) => folder.deletedWithFolderId === groupId && isWithin(nodes, folder.id, folderId));
  }

  return {
    async listFolders(workspaceId) {
      return db
        .select()
        .from(documentFolders)
        .where(and(eq(documentFolders.workspaceId, workspaceId), isNull(documentFolders.deletedAt)))
        .orderBy(asc(documentFolders.nameKey))
        .all()
        .map((row) => folderRecord(db, row));
    },

    async createFolder(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const folders = allFolders(tx, input.workspaceId);
        if (folders.filter((folder) => folder.deletedAt === null).length >= MAX_FOLDERS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const problem = folderPlacementProblem(folders.map(node), { parentId: input.parentId, name: input.name, height: 1 });
        if (problem !== undefined) throw new Refusal(problem === 'parent_not_found' ? 'folder_not_found' : problem);
        const row = tx
          .insert(documentFolders)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            parentId: input.parentId,
            name: input.name,
            nameKey: folderNameKey(input.name),
            createdByUserId: actor.userId,
            createdByDisplayName: actor.displayName,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'FOLDER_CREATED', actor, subjectType: 'folder', subjectId: row.id, occurredAt: input.at, metadata: { name: row.name } });
        return { folder: folderRecord(tx, row) };
      });
    },

    async renameFolder(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveFolder(tx, input.workspaceId, input.folderId);
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        const folders = allFolders(tx, input.workspaceId).map(node);
        if (folderPlacementProblem(folders, { parentId: current.parentId, name: input.name, height: 0, movingId: current.id }) === 'name_taken') throw new Refusal('name_taken');
        const row = tx
          .update(documentFolders)
          .set({ name: input.name, nameKey: folderNameKey(input.name), revision: current.revision + 1, updatedAt: input.at })
          .where(eq(documentFolders.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'FOLDER_RENAMED', actor, subjectType: 'folder', subjectId: row.id, occurredAt: input.at, metadata: { from: current.name, to: row.name } });
        return { folder: folderRecord(tx, row) };
      });
    },

    async moveFolder(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveFolder(tx, input.workspaceId, input.folderId);
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        const folders = allFolders(tx, input.workspaceId).map(node);
        const problem = folderPlacementProblem(folders, { parentId: input.parentId, name: current.name, height: subtreeHeight(folders, current.id), movingId: current.id });
        if (problem !== undefined) throw new Refusal(problem === 'parent_not_found' ? 'folder_not_found' : problem);
        const row = tx
          .update(documentFolders)
          .set({ parentId: input.parentId, revision: current.revision + 1, updatedAt: input.at })
          .where(eq(documentFolders.id, current.id))
          .returning()
          .get();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'FOLDER_MOVED',
          actor,
          subjectType: 'folder',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { name: row.name, from: current.parentId ?? '', to: input.parentId ?? '' },
        });
        return { folder: folderRecord(tx, row) };
      });
    },

    async deleteFolder(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveFolder(tx, input.workspaceId, input.folderId);
        const folders = allFolders(tx, input.workspaceId);
        const nodes = folders.map(node);
        // The Folder and everything below it that is not in Trash already: one unit, marked with this Folder's id.
        const taken = folders.filter((folder) => folder.deletedAt === null && isWithin(nodes, folder.id, current.id)).map((folder) => folder.id);
        const mark = { deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName, deletedWithFolderId: current.id };
        const contained = tx
          .update(documents)
          .set(mark)
          .where(and(eq(documents.workspaceId, input.workspaceId), inArray(documents.folderId, taken), isNull(documents.deletedAt)))
          .returning({ id: documents.id })
          .all().length;
        tx.update(documentFolders)
          .set({ ...mark, revision: sql`${documentFolders.revision} + 1`, updatedAt: input.at })
          .where(inArray(documentFolders.id, taken))
          .run();
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'FOLDER_DELETED',
          actor,
          subjectType: 'folder',
          subjectId: current.id,
          occurredAt: input.at,
          metadata: { name: current.name, folders: taken.length - 1, documents: contained },
        });
        return { folders: taken.length - 1, documents: contained };
      });
    },

    async restoreFolder(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const folders = allFolders(tx, input.workspaceId);
        const current = folders.find((folder) => folder.id === input.folderId && folder.deletedAt !== null);
        if (current?.deletedWithFolderId == null) throw new Refusal('folder_not_found');
        const group = current.deletedWithFolderId;
        // What comes back: this Folder and what went to Trash with the same deletion below it. Items
        // deleted separately before (another group, or a Document deleted by itself) stay in Trash.
        const returning = groupSubtree(folders, group, current.id).map((folder) => folder.id);
        const nodes = folders.map(node);
        const place = restoreParent(nodes, current.parentId);
        const name = restoredFolderName(nodes, place.parentId, current.name);
        if (folders.filter((folder) => folder.deletedAt === null).length + returning.length > MAX_FOLDERS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const clear = { deletedAt: null, deletedByUserId: null, deletedByDisplayName: null, deletedWithFolderId: null };
        const restoredDocuments = tx
          .update(documents)
          .set(clear)
          .where(and(eq(documents.workspaceId, input.workspaceId), eq(documents.deletedWithFolderId, group), inArray(documents.folderId, returning)))
          .returning({ id: documents.id })
          .all().length;
        if (liveCount(tx, documents, input.workspaceId) > MAX_DOCUMENTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        // Place and name first, while it is still in Trash: it must never be live under a name a sibling has.
        tx.update(documentFolders).set({ parentId: place.parentId, name, nameKey: folderNameKey(name) }).where(eq(documentFolders.id, current.id)).run();
        tx.update(documentFolders)
          .set({ ...clear, revision: sql`${documentFolders.revision} + 1`, updatedAt: input.at })
          .where(inArray(documentFolders.id, returning))
          .run();
        const target = place.parentId === null ? null : folders.find((folder) => folder.id === place.parentId);
        const missing = folders.find((folder) => folder.id === current.parentId);
        const outcome: RestoreOutcome = {
          folders: returning.length - 1,
          documents: restoredDocuments,
          ...(name === current.name ? {} : { renamedTo: name }),
          ...(place.moved ? { movedTo: { id: place.parentId as FolderId | null, name: target?.name ?? null, because: missing?.name ?? '' } } : {}),
        };
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'FOLDER_RESTORED',
          actor,
          subjectType: 'folder',
          subjectId: current.id,
          occurredAt: input.at,
          metadata: { name, folders: outcome.folders, documents: outcome.documents, moved: place.moved, renamed: name !== current.name },
        });
        return { outcome };
      });
    },

    async findDocuments(workspaceId, query, after, limit) {
      let folderIds: string[] | null = null;
      if (query.place.kind === 'folder') {
        const folders = db
          .select({ id: documentFolders.id, parentId: documentFolders.parentId })
          .from(documentFolders)
          .where(and(eq(documentFolders.workspaceId, workspaceId), isNull(documentFolders.deletedAt)))
          .all();
        const start = query.place.id;
        if (!folders.some((folder) => folder.id === start)) return undefined;
        folderIds = [start];
        // With its sub-folders: everything live below it (a live Folder is never below one in Trash).
        for (let index = 0; query.place.withSubfolders && index < folderIds.length; index++) {
          const parent = folderIds[index];
          folderIds.push(...folders.filter((folder) => folder.parentId === parent).map((folder) => folder.id));
        }
      }
      const scope = and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt), ...matching(query, folderIds));
      const rows = db
        .select()
        .from(documents)
        .where(after === null ? scope : and(scope, afterCursor(query, after)))
        .orderBy(...ordering(query))
        .limit(limit + 1)
        .all();
      const shown = rows.slice(0, limit);
      const last = shown.at(-1);
      // Counting reads every match: done once, for the first page.
      const total = after === null ? (rows.length <= limit ? rows.length : (db.select({ n: count() }).from(documents).where(scope).get()?.n ?? 0)) : null;
      return { documents: shown.map((row) => withTextMatch(db, summary(db, row), query.terms)), next: rows.length > limit && last !== undefined ? cursorOf(query, last) : null, total };
    },

    async filterValues(workspaceId): Promise<DocumentFilterValues> {
      const live = and(eq(documents.workspaceId, workspaceId), isNull(documents.deletedAt));
      const years = db.selectDistinct({ year: documents.year }).from(documents).where(and(live, isNotNull(documents.year))).orderBy(desc(documents.year)).limit(FILTER_VALUES_LIMIT).all();
      const uploaders = db.selectDistinct({ name: documents.createdByDisplayName }).from(documents).where(live).orderBy(asc(documents.createdByDisplayName)).limit(FILTER_VALUES_LIMIT).all();
      // Tags that differ only by case or accents are one tag: the most used spelling stands for it.
      const spellings = new Map<string, Map<string, number>>();
      for (const row of db.select({ tags: documents.tags }).from(documents).where(and(live, sql`${documents.tags} <> '[]'`)).all()) {
        for (const tag of row.tags) {
          const variants = spellings.get(foldSearchText(tag)) ?? new Map<string, number>();
          variants.set(tag, (variants.get(tag) ?? 0) + 1);
          spellings.set(foldSearchText(tag), variants);
        }
      }
      // Plain code-point order throughout: the same answer on every server, whatever its locale.
      const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      const tags = [...spellings]
        .map(([key, variants]) => ({ key, uses: [...variants.values()].reduce((sum, n) => sum + n, 0), name: [...variants].sort((a, b) => b[1] - a[1] || order(a[0], b[0]))[0]?.[0] ?? '' }))
        .sort((a, b) => b.uses - a.uses || order(a.key, b.key))
        .slice(0, FILTER_VALUES_LIMIT)
        .sort((a, b) => order(a.key, b.key))
        .map((tag) => tag.name);
      return { years: years.flatMap((row) => (row.year === null ? [] : [row.year])), tags, uploaders: uploaders.map((row) => row.name) };
    },

    async findDocument(workspaceId, documentId) {
      const row = liveDocument(db, workspaceId, documentId);
      return row === undefined ? undefined : record(db, row);
    },

    async createDocument(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        if (liveCount(tx, documents, input.workspaceId) >= MAX_DOCUMENTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        requireTarget(tx, input.workspaceId, input.folderId);
        requireType(tx, input.workspaceId, input.content, null);
        const by = { createdByUserId: actor.userId, createdByDisplayName: actor.displayName, createdAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName, updatedAt: input.at };
        const row = tx
          .insert(documents)
          .values({
            id: randomUUID(),
            workspaceId: input.workspaceId,
            folderId: input.folderId,
            title: input.content.title,
            ...typeColumns(input.content),
            documentDate: input.content.documentDate,
            year: input.content.year,
            notes: input.content.notes,
            tags: input.content.tags,
            ...searchColumns(input.content),
            ...by,
          })
          .returning()
          .get();
        writePages(tx, input.workspaceId, row.id, input.fileIds);
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_CREATED',
          actor,
          subjectType: 'document',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: { title: row.title, files: input.fileIds.length, folder: input.folderId ?? '' },
        });
        return { document: record(tx, row) };
      });
    },

    async updateDocument(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveDocument(tx, input.workspaceId, input.documentId);
        if (current === undefined) throw new Refusal('document_not_found');
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        requireType(tx, input.workspaceId, input.content, current.typeId);
        const next = { title: input.content.title, ...typeColumns(input.content), documentDate: input.content.documentDate, year: input.content.year, notes: input.content.notes, tags: input.content.tags };
        const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
        const row = tx
          .update(documents)
          .set({ ...next, ...searchColumns(input.content), revision: current.revision + 1, updatedAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName })
          .where(eq(documents.id, current.id))
          .returning()
          .get();
        // Which fields changed — never their content (notes are not history).
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_UPDATED', actor, subjectType: 'document', subjectId: row.id, occurredAt: input.at, metadata: { title: row.title, changed } });
        return { document: record(tx, row) };
      });
    },

    async setDocumentFiles(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveDocument(tx, input.workspaceId, input.documentId);
        if (current === undefined) throw new Refusal('document_not_found');
        if (current.revision !== input.expectedRevision) throw new Refusal('conflict');
        const before = pageFileIds(tx, current.id);
        writePages(tx, input.workspaceId, current.id, input.fileIds);
        const row = tx
          .update(documents)
          .set({ revision: current.revision + 1, updatedAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName })
          .where(eq(documents.id, current.id))
          .returning()
          .get();
        const kept = input.fileIds.filter((id) => before.includes(id));
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENT_FILES_CHANGED',
          actor,
          subjectType: 'document',
          subjectId: row.id,
          occurredAt: input.at,
          metadata: {
            title: row.title,
            added: input.fileIds.length - kept.length,
            removed: before.length - kept.length,
            reordered: kept.join() !== before.filter((id) => kept.includes(id as DocumentFileId)).join(),
            files: input.fileIds.length,
          },
        });
        return { document: record(tx, row) };
      });
    },

    async moveDocuments(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        requireTarget(tx, input.workspaceId, input.folderId);
        let moved = 0;
        for (const documentId of input.documentIds) {
          const current = liveDocument(tx, input.workspaceId, documentId);
          if (current === undefined) throw new Refusal('document_not_found'); // all or nothing
          if (current.folderId === input.folderId) continue;
          tx.update(documents)
            .set({ folderId: input.folderId, revision: current.revision + 1, updatedAt: input.at, updatedByUserId: actor.userId, updatedByDisplayName: actor.displayName })
            .where(eq(documents.id, current.id))
            .run();
          recordAuditEvent(tx, {
            workspaceId: input.workspaceId,
            type: 'DOCUMENT_MOVED',
            actor,
            subjectType: 'document',
            subjectId: current.id,
            occurredAt: input.at,
            metadata: { title: current.title, from: current.folderId ?? '', to: input.folderId ?? '' },
          });
          moved++;
        }
        return { moved };
      });
    },

    async deleteDocument(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = liveDocument(tx, input.workspaceId, input.documentId);
        if (current === undefined) throw new Refusal('document_not_found');
        tx.update(documents)
          .set({ deletedAt: input.at, deletedByUserId: actor.userId, deletedByDisplayName: actor.displayName, deletedWithFolderId: null, revision: current.revision + 1 })
          .where(eq(documents.id, current.id))
          .run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_DELETED', actor, subjectType: 'document', subjectId: current.id, occurredAt: input.at, metadata: { title: current.title } });
        return {};
      });
    },

    async restoreDocument(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = tx
          .select()
          .from(documents)
          .where(and(eq(documents.workspaceId, input.workspaceId), eq(documents.id, input.documentId), isNotNull(documents.deletedAt)))
          .get();
        if (current === undefined) throw new Refusal('document_not_found');
        if (liveCount(tx, documents, input.workspaceId) >= MAX_DOCUMENTS_PER_WORKSPACE) throw new Refusal('limit_reached');
        const folders = allFolders(tx, input.workspaceId);
        const place = restoreParent(folders.map(node), current.folderId);
        tx.update(documents)
          .set({ deletedAt: null, deletedByUserId: null, deletedByDisplayName: null, deletedWithFolderId: null, folderId: place.parentId, revision: current.revision + 1 })
          .where(eq(documents.id, current.id))
          .run();
        const target = place.parentId === null ? null : folders.find((folder) => folder.id === place.parentId);
        const missing = folders.find((folder) => folder.id === current.folderId);
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_RESTORED', actor, subjectType: 'document', subjectId: current.id, occurredAt: input.at, metadata: { title: current.title, moved: place.moved } });
        return {
          outcome: {
            folders: 0,
            documents: 1,
            ...(place.moved ? { movedTo: { id: place.parentId as FolderId | null, name: target?.name ?? null, because: missing?.name ?? '' } } : {}),
          } satisfies RestoreOutcome,
        };
      });
    },

    async listTypes(workspaceId) {
      return db
        .select()
        .from(documentTypes)
        .where(eq(documentTypes.workspaceId, workspaceId))
        .orderBy(asc(documentTypes.nameKey))
        .all()
        .map((row): DocumentTypeRecord => ({ id: row.id as DocumentTypeId, name: row.name, retired: row.retiredAt !== null }));
    },

    async createType(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const live = tx
          .select({ nameKey: documentTypes.nameKey })
          .from(documentTypes)
          .where(and(eq(documentTypes.workspaceId, input.workspaceId), isNull(documentTypes.retiredAt)))
          .all();
        if (live.length >= MAX_CUSTOM_DOCUMENT_TYPES) throw new Refusal('limit_reached');
        if (live.some((type) => type.nameKey === folderNameKey(input.name))) throw new Refusal('name_taken');
        const row = tx
          .insert(documentTypes)
          .values({ id: randomUUID(), workspaceId: input.workspaceId, name: input.name, nameKey: folderNameKey(input.name), createdByUserId: actor.userId, createdAt: input.at })
          .returning()
          .get();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_TYPE_CREATED', actor, subjectType: 'document_type', subjectId: row.id, occurredAt: input.at, metadata: { name: row.name } });
        return { type: { id: row.id as DocumentTypeId, name: row.name, retired: false } };
      });
    },

    async renameType(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = tx
          .select()
          .from(documentTypes)
          .where(and(eq(documentTypes.workspaceId, input.workspaceId), eq(documentTypes.id, input.typeId), isNull(documentTypes.retiredAt)))
          .get();
        if (current === undefined) throw new Refusal('type_not_found');
        const key = folderNameKey(input.name);
        const taken = tx
          .select({ id: documentTypes.id })
          .from(documentTypes)
          .where(and(eq(documentTypes.workspaceId, input.workspaceId), eq(documentTypes.nameKey, key), isNull(documentTypes.retiredAt), sql`${documentTypes.id} <> ${current.id}`))
          .get();
        if (taken !== undefined) throw new Refusal('name_taken');
        tx.update(documentTypes).set({ name: input.name, nameKey: key }).where(eq(documentTypes.id, current.id)).run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_TYPE_RENAMED', actor, subjectType: 'document_type', subjectId: current.id, occurredAt: input.at, metadata: { from: current.name, to: input.name } });
        return { type: { id: current.id as DocumentTypeId, name: input.name, retired: false } };
      });
    },

    async retireType(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const current = tx
          .select()
          .from(documentTypes)
          .where(and(eq(documentTypes.workspaceId, input.workspaceId), eq(documentTypes.id, input.typeId), isNull(documentTypes.retiredAt)))
          .get();
        if (current === undefined) throw new Refusal('type_not_found');
        tx.update(documentTypes).set({ retiredAt: input.at }).where(eq(documentTypes.id, current.id)).run();
        recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_TYPE_RETIRED', actor, subjectType: 'document_type', subjectId: current.id, occurredAt: input.at, metadata: { name: current.name } });
        return { type: { id: current.id as DocumentTypeId, name: current.name, retired: true } };
      });
    },

    async exportSize(workspaceId, scope) {
      const where = exportScope(db, workspaceId, scope);
      return where === undefined ? undefined : exportSizeOf(db, where.documents);
    },

    async startExport(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        const where = exportScope(tx, input.workspaceId, input.scope);
        if (where === undefined) throw new Refusal(input.scope.kind === 'folder' ? 'folder_not_found' : 'document_not_found');
        const size = exportSizeOf(tx, where.documents);
        if (size.files > input.limits.files || size.bytes > input.limits.bytes) throw new Refusal('limit_reached');
        const rows = tx.select().from(documents).where(where.documents).orderBy(asc(documents.titleKey), asc(documents.id)).all();
        const files = new Map<string, ExportedFile[]>();
        for (const page of tx
          .select({ documentId: documentPages.documentId, file: documentFiles })
          .from(documentPages)
          .innerJoin(documents, eq(documents.id, documentPages.documentId))
          .innerJoin(documentFiles, eq(documentFiles.id, documentPages.fileId))
          .where(where.documents)
          .orderBy(asc(documentPages.documentId), asc(documentPages.position))
          .all()) {
          const list = files.get(page.documentId) ?? [];
          list.push({ id: page.file.id as DocumentFileId, sha256: page.file.sha256, bytes: page.file.bytes, originalName: page.file.originalName, format: page.file.format, pageCount: page.file.pageCount });
          files.set(page.documentId, list);
        }
        const types = new Map(tx.select().from(documentTypes).where(eq(documentTypes.workspaceId, input.workspaceId)).all().map((type) => [type.id, type]));
        const related = exportedLinks(tx, input.workspaceId);
        const exported = rows.map((row): ExportedDocument => {
          const custom = row.typeId === null ? undefined : types.get(row.typeId);
          return {
            id: row.id as DocumentId,
            folderId: row.folderId as FolderId | null,
            title: row.title,
            type: row.typeKey !== null ? { kind: 'builtin', key: row.typeKey } : custom === undefined ? null : { kind: 'custom', id: custom.id as DocumentTypeId, name: custom.name, retired: custom.retiredAt !== null },
            documentDate: row.documentDate,
            year: row.year,
            notes: row.notes,
            tags: row.tags,
            uploadedAt: row.createdAt,
            uploadedByName: row.createdByDisplayName,
            modifiedAt: row.updatedAt,
            modifiedByName: row.updatedByDisplayName,
            files: files.get(row.id) ?? [],
            links: related.get(row.id) ?? [],
          };
        });
        recordAuditEvent(tx, {
          workspaceId: input.workspaceId,
          type: 'DOCUMENTS_EXPORTED',
          actor,
          subjectType: where.folder === null ? 'workspace' : 'folder',
          subjectId: where.folder?.id ?? input.workspaceId,
          occurredAt: input.at,
          // What was taken, in numbers — never titles of everything, never content.
          metadata: { scope: input.scope.kind === 'documents' ? 'selection' : input.scope.kind, folder: where.folder?.name ?? '', documents: size.documents, files: size.files, bytes: size.bytes },
        });
        return { data: { folders: where.folders, folderName: where.folder?.name ?? null, documents: exported, size } satisfies ExportData };
      });
    },

    async purgeTrash(input, actor, guard) {
      return write(input.workspaceId, actor, guard, (tx) => {
        let folders = allFolders(tx, input.workspaceId);
        const trashed = () =>
          tx
            .select({ id: documents.id, title: documents.title, folderId: documents.folderId, group: documents.deletedWithFolderId })
            .from(documents)
            .where(and(eq(documents.workspaceId, input.workspaceId), isNotNull(documents.deletedAt)))
            .all();
        // "Empty Trash": everything that was deleted itself — each takes along what went with it.
        const items =
          input.items === 'all'
            ? [
                ...folders.filter((folder) => folder.deletedAt !== null && folder.deletedWithFolderId === folder.id).map((folder) => ({ kind: 'folder' as const, id: folder.id })),
                ...trashed().filter((document) => document.group === null).map((document) => ({ kind: 'document' as const, id: document.id })),
              ]
            : input.items;
        const purged = { folders: 0, documents: 0, files: 0 };
        /** Removes Documents (already known to be in Trash) with their pages; returns how many files they held. */
        const removeDocuments = (ids: readonly string[]): number => {
          let files = 0;
          for (let start = 0; start < ids.length; start += 500) {
            const chunk = ids.slice(start, start + 500);
            // Links to them say "deleted for good" from now on; Document versions retained for Runs are untouched.
            markLinksOfPurgedDocuments(tx, input.workspaceId, chunk, input.at, actor.displayName);
            const released = tx.delete(documentPages).where(inArray(documentPages.documentId, chunk)).returning({ fileId: documentPages.fileId }).all().map((row) => row.fileId);
            files += released.length;
            // Recognised text goes with the Document (16.9) — except for a version a Run retains (16.5).
            const kept = new Set(released.length === 0 ? [] : tx.select({ fileId: runDocumentFiles.fileId }).from(runDocumentFiles).where(inArray(runDocumentFiles.fileId, released)).all().map((row) => row.fileId));
            deleteTextsOfFiles(tx, released.filter((fileId) => !kept.has(fileId)));
            tx.delete(documentSuggestionDismissals).where(and(eq(documentSuggestionDismissals.workspaceId, input.workspaceId), inArray(documentSuggestionDismissals.documentId, chunk))).run();
            tx.delete(documents).where(and(eq(documents.workspaceId, input.workspaceId), inArray(documents.id, chunk), isNotNull(documents.deletedAt))).run();
          }
          return files;
        };
        for (const item of items) {
          if (item.kind === 'document') {
            const current = trashed().find((document) => document.id === item.id);
            if (current === undefined) throw new Refusal('document_not_found');
            const files = removeDocuments([current.id]);
            recordAuditEvent(tx, { workspaceId: input.workspaceId, type: 'DOCUMENT_PURGED', actor, subjectType: 'document', subjectId: current.id, occurredAt: input.at, metadata: { title: current.title, files } });
            purged.documents += 1;
            purged.files += files;
            continue;
          }
          const current = folders.find((folder) => folder.id === item.id && folder.deletedAt !== null);
          if (current?.deletedWithFolderId == null) throw new Refusal('folder_not_found');
          const group = current.deletedWithFolderId;
          // Exactly what a restore of this Folder would bring back: it and what went to Trash with it below it.
          const nodes = folders.map(node);
          const going = groupSubtree(folders, group, current.id).map((folder) => folder.id);
          const inTrash = trashed();
          const contained = inTrash.filter((document) => document.group === group && document.folderId !== null && going.includes(document.folderId)).map((document) => document.id);
          const files = removeDocuments(contained);
          // What else lies in Trash inside these Folders (deleted separately, before) is not deleted with
          // them: it moves up to where this Folder was, so a later restore still finds the nearest place.
          const strays = inTrash.filter((document) => !contained.includes(document.id) && document.folderId !== null && going.includes(document.folderId)).map((document) => document.id);
          for (let start = 0; start < strays.length; start += 500) {
            tx.update(documents).set({ folderId: current.parentId }).where(inArray(documents.id, strays.slice(start, start + 500))).run();
          }
          const strayFolders = folders.filter((folder) => !going.includes(folder.id) && folder.parentId !== null && going.includes(folder.parentId)).map((folder) => folder.id);
          if (strayFolders.length > 0) tx.update(documentFolders).set({ parentId: current.parentId }).where(inArray(documentFolders.id, strayFolders)).run();
          // Deepest first: a Folder can only go once nothing is inside it.
          const depth = new Map(going.map((id) => [id, folderDepth(nodes, id) ?? 0]));
          for (const id of [...going].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0))) {
            tx.delete(documentFolders).where(and(eq(documentFolders.workspaceId, input.workspaceId), eq(documentFolders.id, id), isNotNull(documentFolders.deletedAt))).run();
          }
          recordAuditEvent(tx, {
            workspaceId: input.workspaceId,
            type: 'FOLDER_PURGED',
            actor,
            subjectType: 'folder',
            subjectId: current.id,
            occurredAt: input.at,
            metadata: { name: current.name, folders: going.length - 1, documents: contained.length, files },
          });
          purged.folders += going.length;
          purged.documents += contained.length;
          purged.files += files;
          folders = allFolders(tx, input.workspaceId);
        }
        return { purged: purged satisfies PurgeOutcome };
      });
    },

    async listTrash(workspaceId, within) {
      const folders = allFolders(db, workspaceId);
      let group: string | null = null;
      if (within !== null) {
        const parent = folders.find((folder) => folder.id === within && folder.deletedAt !== null);
        if (parent?.deletedWithFolderId == null) return undefined;
        group = parent.deletedWithFolderId;
      }
      const trashedDocuments = db
        .select()
        .from(documents)
        .where(and(eq(documents.workspaceId, workspaceId), isNotNull(documents.deletedAt)))
        .all();
      const fileCounts = new Map(
        db
          .select({ id: documentPages.documentId, n: count() })
          .from(documentPages)
          .innerJoin(documents, eq(documents.id, documentPages.documentId))
          .where(and(eq(documents.workspaceId, workspaceId), isNotNull(documents.deletedAt)))
          .groupBy(documentPages.documentId)
          .all()
          .map((row) => [row.id, row.n]),
      );
      const entries: TrashEntry[] = [];
      for (const folder of folders) {
        if (folder.deletedAt === null || folder.deletedByDisplayName === null || folder.deletedWithFolderId === null) continue;
        // At the top: Folders that were deleted themselves. Inside a trashed Folder: its children of the same deletion.
        if (within === null ? folder.deletedWithFolderId !== folder.id : folder.deletedWithFolderId !== group || folder.parentId !== within) continue;
        const below = groupSubtree(folders, folder.deletedWithFolderId, folder.id).map((each) => each.id);
        const inside = trashedDocuments.filter((document) => document.deletedWithFolderId === folder.deletedWithFolderId && document.folderId !== null && below.includes(document.folderId));
        entries.push({
          kind: 'folder',
          id: folder.id,
          name: folder.name,
          location: pathNames(folders, folder.parentId),
          deletedAt: folder.deletedAt,
          deletedByName: folder.deletedByDisplayName,
          folders: below.length - 1,
          documents: inside.length,
          files: inside.reduce((sum, document) => sum + (fileCounts.get(document.id) ?? 0), 0),
        });
      }
      for (const document of trashedDocuments) {
        if (document.deletedAt === null || document.deletedByDisplayName === null) continue;
        if (within === null ? document.deletedWithFolderId !== null : document.deletedWithFolderId !== group || document.folderId !== within) continue;
        entries.push({ kind: 'document', id: document.id, name: document.title, location: pathNames(folders, document.folderId), deletedAt: document.deletedAt, deletedByName: document.deletedByDisplayName, folders: 0, documents: 0, files: fileCounts.get(document.id) ?? 0 });
      }
      return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime() || a.name.localeCompare(b.name));
    },
  };
}

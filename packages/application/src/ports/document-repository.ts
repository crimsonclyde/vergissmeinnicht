import type { Actor, BuiltInDocumentType, DocumentContent, DocumentCursor, DocumentFileFormat, DocumentFileId, DocumentId, DocumentQuery, DocumentTypeId, FolderId, WorkspaceId, WorkspaceTool } from '@vergissmeinnicht/domain';
import type { ActorGuard } from './actor-guard.ts';
import type { DocumentFileRecord } from './document-files.ts';

type UserActor = Actor & { readonly kind: 'user' };

/** Which optional tools a Workspace has switched on (16.2). */
export interface WorkspaceToolRepository {
  enabled(workspaceId: WorkspaceId): Promise<WorkspaceTool[]>;
  /** In one IMMEDIATE transaction: re-checks the guard, sets the switch and records the audit event. Data is never touched. */
  set(input: { readonly workspaceId: WorkspaceId; readonly tool: WorkspaceTool; readonly enabled: boolean; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<'ok' | 'forbidden'>;
}

export interface FolderRecord {
  readonly id: FolderId;
  readonly parentId: FolderId | null;
  readonly name: string;
  readonly revision: number;
  /** Documents directly in this Folder (not in Trash). */
  readonly documents: number;
}

export type DocumentTypeView =
  | { readonly kind: 'builtin'; readonly key: BuiltInDocumentType }
  | { readonly kind: 'custom'; readonly id: DocumentTypeId; readonly name: string; readonly retired: boolean };

export interface DocumentTypeRecord {
  readonly id: DocumentTypeId;
  readonly name: string;
  readonly retired: boolean;
}

export interface DocumentSummary {
  readonly id: DocumentId;
  readonly folderId: FolderId | null;
  readonly title: string;
  readonly type: DocumentTypeView | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly tags: readonly string[];
  readonly revision: number;
  /** Number of files. */
  readonly files: number;
  /** The first file, whose thumbnail stands for the Document (when it has one). */
  readonly cover: { readonly fileId: DocumentFileId; readonly hasThumbnail: boolean } | null;
  readonly uploadedAt: Date;
  readonly uploadedByName: string;
  readonly modifiedAt: Date;
  readonly modifiedByName: string;
}

export interface DocumentRecord extends DocumentSummary {
  readonly notes: string;
  /** The files in the user's order. */
  readonly pages: readonly DocumentFileRecord[];
}

/** One page of a listing (16.3). */
export interface DocumentListing {
  readonly documents: DocumentSummary[];
  /** Where the next page starts, or `null` on the last page. */
  readonly next: DocumentCursor | null;
  /** How many Documents match in all — counted for the first page only (`null` on later ones). */
  readonly total: number | null;
}

/** What the filters can be set to: only values that Documents of this Workspace (not in Trash) actually have. */
export interface DocumentFilterValues {
  readonly years: number[];
  /** One spelling per tag (tags that differ only by case or accents are one). */
  readonly tags: string[];
  /** Names of uploaders as recorded on the Documents. */
  readonly uploaders: string[];
}

/** Something in Trash: a Folder (with what went with it) or a Document. */
export interface TrashEntry {
  readonly kind: 'folder' | 'document';
  readonly id: string;
  readonly name: string;
  /** Names of the Folders it was in, outermost first (empty = top level). */
  readonly location: readonly string[];
  readonly deletedAt: Date;
  readonly deletedByName: string;
  /** For a Folder: sub-folders and Documents that went to Trash with it. */
  readonly folders: number;
  readonly documents: number;
  /** Files of the Document, or of all Documents that went with the Folder. */
  readonly files: number;
}

/** What an export covers: every Document, one Folder with its sub-folders, or Documents chosen one by one. Never Trash. */
export type ExportScope = { readonly kind: 'all' } | { readonly kind: 'folder'; readonly id: FolderId } | { readonly kind: 'documents'; readonly ids: readonly DocumentId[] };

/** How much an export would hold. */
export interface ExportSize {
  readonly documents: number;
  readonly files: number;
  /** Bytes of the original files. */
  readonly bytes: number;
}

/** A file as it goes into an export. `sha256` names the stored file for reading and is written to the metadata as the file's checksum. */
export interface ExportedFile {
  readonly id: DocumentFileId;
  readonly sha256: string;
  readonly bytes: number;
  readonly originalName: string;
  readonly format: DocumentFileFormat;
  readonly pageCount: number | null;
}

/** A relationship of an exported Document: the kind of record, its id and its title. */
export interface ExportedLink {
  readonly type: 'procedure' | 'reminder' | 'scheduled_procedure' | 'document' | 'run';
  readonly id: string;
  readonly title: string;
}

export interface ExportedDocument {
  readonly id: DocumentId;
  readonly folderId: FolderId | null;
  readonly title: string;
  readonly type: DocumentTypeView | null;
  readonly documentDate: string | null;
  readonly year: number | null;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly uploadedAt: Date;
  readonly uploadedByName: string;
  readonly modifiedAt: Date;
  readonly modifiedByName: string;
  /** In page order. */
  readonly files: readonly ExportedFile[];
  /** What the Document is linked to (16.5) — only records every member who can export may read. */
  readonly links: readonly ExportedLink[];
}

/** Everything an export is made of: Documents that are not in Trash, and the Folders to show them in. */
export interface ExportData {
  /** The Folder tree of the export: for one Folder, that Folder (as the top, `parentId` null) and what is below it. */
  readonly folders: readonly { readonly id: FolderId; readonly parentId: FolderId | null; readonly name: string }[];
  /** The exported Folder's name, or `null` when the export is not of one Folder. */
  readonly folderName: string | null;
  readonly documents: readonly ExportedDocument[];
  readonly size: ExportSize;
}

/** One entry of Trash, named for permanent deletion. */
export interface TrashItemRef {
  readonly kind: 'folder' | 'document';
  readonly id: string;
}

/** What a permanent deletion removed. */
export interface PurgeOutcome {
  readonly folders: number;
  readonly documents: number;
  readonly files: number;
}

/** Where a restored item ended up when its original place no longer exists, and under which name. */
export interface RestoreOutcome {
  /** Set when the item could not return to its parent: the Folder it went to instead (`null` = top level). */
  readonly movedTo?: { readonly id: FolderId | null; readonly name: string | null; readonly because: string } | undefined;
  /** Set when a Folder had to be renamed because a sibling took its name. */
  readonly renamedTo?: string | undefined;
  readonly folders: number;
  readonly documents: number;
}

export type DocumentWriteRefusal =
  | 'forbidden'
  | 'tool_disabled'
  | 'folder_not_found'
  | 'document_not_found'
  | 'type_not_found'
  | 'file_not_found'
  | 'file_in_use'
  | 'conflict'
  | 'name_taken'
  | 'cycle'
  | 'too_deep'
  | 'limit_reached';

export type DocumentWrite<T> = ({ readonly status: 'ok' } & T) | { readonly status: DocumentWriteRefusal };

/**
 * Folders, Documents and document types of a Workspace. Every method is scoped by the Workspace id:
 * an id of another Workspace is "not found". Every write runs in one IMMEDIATE transaction that
 * re-checks the actor (guard) and that the Documents tool is enabled, applies the change, raises the
 * revision and writes the audit event — or changes nothing.
 */
export interface DocumentRepository {
  listFolders(workspaceId: WorkspaceId): Promise<FolderRecord[]>;
  createFolder(input: { readonly workspaceId: WorkspaceId; readonly parentId: FolderId | null; readonly name: string; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ folder: FolderRecord }>>;
  renameFolder(
    input: { readonly workspaceId: WorkspaceId; readonly folderId: FolderId; readonly name: string; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ folder: FolderRecord }>>;
  /** Takes the whole subtree along. Refuses a move into itself or a descendant, beyond the depth limit, or onto a sibling's name. */
  moveFolder(
    input: { readonly workspaceId: WorkspaceId; readonly folderId: FolderId; readonly parentId: FolderId | null; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ folder: FolderRecord }>>;
  /** Moves the Folder and everything in it (not already in Trash) to Trash as one unit. */
  deleteFolder(input: { readonly workspaceId: WorkspaceId; readonly folderId: FolderId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ folders: number; documents: number }>>;
  /** Brings back a Folder with what went to Trash with it (or the part of it below this Folder). */
  restoreFolder(input: { readonly workspaceId: WorkspaceId; readonly folderId: FolderId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ outcome: RestoreOutcome }>>;

  /**
   * The Documents (never those in Trash) matching `query`, in its order, strictly after `after`.
   * `undefined` = the Folder to look in does not exist in this Workspace (or is in Trash).
   */
  findDocuments(workspaceId: WorkspaceId, query: DocumentQuery, after: DocumentCursor | null, limit: number): Promise<DocumentListing | undefined>;
  filterValues(workspaceId: WorkspaceId): Promise<DocumentFilterValues>;
  findDocument(workspaceId: WorkspaceId, documentId: DocumentId): Promise<DocumentRecord | undefined>;
  /** `fileIds`: uploaded files of this Workspace that belong to no Document yet. */
  createDocument(
    input: { readonly workspaceId: WorkspaceId; readonly folderId: FolderId | null; readonly content: DocumentContent; readonly fileIds: readonly DocumentFileId[]; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ document: DocumentRecord }>>;
  updateDocument(
    input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly content: DocumentContent; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ document: DocumentRecord }>>;
  /** The complete new order: files already in the Document and/or new uploads; files left out are removed from it. */
  setDocumentFiles(
    input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly fileIds: readonly DocumentFileId[]; readonly expectedRevision: number; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ document: DocumentRecord }>>;
  /** All or nothing. */
  moveDocuments(
    input: { readonly workspaceId: WorkspaceId; readonly documentIds: readonly DocumentId[]; readonly folderId: FolderId | null; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ moved: number }>>;
  deleteDocument(input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<object>>;
  restoreDocument(input: { readonly workspaceId: WorkspaceId; readonly documentId: DocumentId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ outcome: RestoreOutcome }>>;

  listTypes(workspaceId: WorkspaceId): Promise<DocumentTypeRecord[]>;
  createType(input: { readonly workspaceId: WorkspaceId; readonly name: string; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ type: DocumentTypeRecord }>>;
  renameType(input: { readonly workspaceId: WorkspaceId; readonly typeId: DocumentTypeId; readonly name: string; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ type: DocumentTypeRecord }>>;
  retireType(input: { readonly workspaceId: WorkspaceId; readonly typeId: DocumentTypeId; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ type: DocumentTypeRecord }>>;

  /** How much an export of `scope` would hold. `undefined` = the Folder or one of the Documents does not exist here (or is in Trash). */
  exportSize(workspaceId: WorkspaceId, scope: ExportScope): Promise<ExportSize | undefined>;
  /**
   * Starts an export: in one IMMEDIATE transaction re-checks the actor and the tool, refuses
   * (`limit_reached`) what is larger than `limits`, reads everything the archive needs and records
   * DOCUMENTS_EXPORTED — a deliberate bulk action, unlike a single download.
   */
  startExport(
    input: { readonly workspaceId: WorkspaceId; readonly scope: ExportScope; readonly limits: { readonly files: number; readonly bytes: number }; readonly at: Date },
    actor: UserActor,
    guard: ActorGuard,
  ): Promise<DocumentWrite<{ data: ExportData }>>;

  /**
   * Deletes items of Trash **for good** (16.4): each Document named, and each Folder with what went to
   * Trash with it — or everything in Trash (`'all'`). All or nothing; an id that is not in Trash is
   * "not found". The records and their pages are removed and one audit event per item is written
   * (ids, titles, counts); the files are left to housekeeping, which deletes what nothing references.
   * Something else in Trash that lay inside a deleted Folder moves up to that Folder's parent.
   */
  purgeTrash(input: { readonly workspaceId: WorkspaceId; readonly items: readonly TrashItemRef[] | 'all'; readonly at: Date }, actor: UserActor, guard: ActorGuard): Promise<DocumentWrite<{ purged: PurgeOutcome }>>;

  /** What is in Trash: at the top (`within` = null) what was deleted itself; inside a trashed Folder, what went with it. `undefined` = no such Folder in Trash. */
  listTrash(workspaceId: WorkspaceId, within: FolderId | null): Promise<TrashEntry[] | undefined>;
}

import {
  BUILT_IN_DOCUMENT_TYPES,
  DOCUMENTS_PAGE_SIZE,
  MAX_DOCUMENTS_PER_MOVE,
  MAX_TRASH_ITEMS_PER_PURGE,
  DomainValidationError,
  normalizeDocumentContent,
  normalizeDocumentTypeName,
  normalizeFolderName,
  parseDocumentCursor,
  parseDocumentFileIds,
  parseDocumentId,
  parseDocumentQuery,
  parseDocumentTypeId,
  parseFolderId,
  type BuiltInDocumentType,
  type DocumentCursor,
  type DocumentId,
  type DocumentQueryInput,
  type FolderId,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { Clock } from '../ports/clock.ts';
import { InvalidCursorError } from '../ports/paging.ts';
import type {
  DocumentFilterValues,
  DocumentListing,
  DocumentRecord,
  DocumentRepository,
  DocumentTypeRecord,
  DocumentWrite,
  DocumentWriteRefusal,
  FolderRecord,
  PurgeOutcome,
  RestoreOutcome,
  TrashEntry,
  TrashItemRef,
  WorkspaceToolRepository,
} from '../ports/document-repository.ts';
import type { WorkspaceRepository } from '../ports/workspace-repository.ts';
import { userActor } from '../user-actor.ts';
import {
  DocumentConflictError,
  DocumentFileNotFoundError,
  DocumentLimitReachedError,
  DocumentNotFoundError,
  DocumentTypeNotFoundError,
  FileInUseError,
  FolderMoveRefusedError,
  FolderNotFoundError,
  NameTakenError,
  ToolNotEnabledError,
} from './errors.ts';
import { authorizeTool } from './tools.ts';

export interface DocumentDeps {
  readonly workspaces: WorkspaceRepository;
  readonly tools: WorkspaceToolRepository;
  readonly documents: DocumentRepository;
  readonly clock: Clock;
}

/** Re-checked inside every write transaction (concurrent demotion, removal or disabling). */
const manage: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'document.manage') };

function refuse(status: DocumentWriteRefusal): never {
  switch (status) {
    case 'forbidden':
      throw new NotAuthorizedError();
    case 'tool_disabled':
      throw new ToolNotEnabledError();
    case 'folder_not_found':
      throw new FolderNotFoundError();
    case 'document_not_found':
      throw new DocumentNotFoundError();
    case 'type_not_found':
      throw new DocumentTypeNotFoundError();
    case 'file_not_found':
      throw new DocumentFileNotFoundError();
    case 'file_in_use':
      throw new FileInUseError();
    case 'conflict':
      throw new DocumentConflictError();
    case 'name_taken':
      throw new NameTakenError();
    case 'cycle':
    case 'too_deep':
      throw new FolderMoveRefusedError(status);
    case 'limit_reached':
      throw new DocumentLimitReachedError();
  }
}

function ok<T>(result: DocumentWrite<T>): { readonly status: 'ok' } & T {
  if (result.status !== 'ok') refuse(result.status);
  return result;
}

interface Ref {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
}

const view = (deps: DocumentDeps, input: Ref) => authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
const write = (deps: DocumentDeps, input: Ref) => authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.manage');
const folderIdOrTop = (value: string | null): FolderId | null => (value === null ? null : parseFolderId(value));

// ---- Folders

/** The whole Folder tree of the Workspace (`document.view`: every role, guests included). */
export async function listFolders(deps: DocumentDeps, input: Ref): Promise<FolderRecord[]> {
  await view(deps, input);
  return deps.documents.listFolders(input.workspaceId);
}

/** A new Folder at the top level or inside another one (`document.manage`: USER and above). Audited. */
export async function createFolder(deps: DocumentDeps, input: Ref & { readonly parentId: string | null; readonly name: string }): Promise<FolderRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, parentId: folderIdOrTop(input.parentId), name: normalizeFolderName(input.name), at: deps.clock.now() };
  return ok(await deps.documents.createFolder(values, userActor(input.actor), manage)).folder;
}

export async function renameFolder(deps: DocumentDeps, input: Ref & { readonly folderId: string; readonly name: string; readonly expectedRevision: number }): Promise<FolderRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, folderId: parseFolderId(input.folderId), name: normalizeFolderName(input.name), expectedRevision: input.expectedRevision, at: deps.clock.now() };
  return ok(await deps.documents.renameFolder(values, userActor(input.actor), manage)).folder;
}

/**
 * Moves a Folder with its whole subtree. Refused — with the reason — into itself or one of its
 * sub-folders, beyond ten levels, or where a sibling already has its name; the check runs inside the
 * transaction, so two moves that would form a cycle together cannot both succeed.
 */
export async function moveFolder(deps: DocumentDeps, input: Ref & { readonly folderId: string; readonly parentId: string | null; readonly expectedRevision: number }): Promise<FolderRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, folderId: parseFolderId(input.folderId), parentId: folderIdOrTop(input.parentId), expectedRevision: input.expectedRevision, at: deps.clock.now() };
  return ok(await deps.documents.moveFolder(values, userActor(input.actor), manage)).folder;
}

/** Moves the Folder and all its contents to Trash as one unit; returns how much went with it. */
export async function deleteFolder(deps: DocumentDeps, input: Ref & { readonly folderId: string }): Promise<{ readonly folders: number; readonly documents: number }> {
  await write(deps, input);
  const result = ok(await deps.documents.deleteFolder({ workspaceId: input.workspaceId, folderId: parseFolderId(input.folderId), at: deps.clock.now() }, userActor(input.actor), manage));
  return { folders: result.folders, documents: result.documents };
}

/**
 * Restores a Folder from Trash with the subtree that went with it. If a sibling has its name now it
 * comes back as "Name (restored)"; if its parent is gone it goes to the nearest Folder that still
 * exists, else to the top level. The outcome says which of these happened.
 */
export async function restoreFolder(deps: DocumentDeps, input: Ref & { readonly folderId: string }): Promise<RestoreOutcome> {
  await write(deps, input);
  return ok(await deps.documents.restoreFolder({ workspaceId: input.workspaceId, folderId: parseFolderId(input.folderId), at: deps.clock.now() }, userActor(input.actor), manage)).outcome;
}

// ---- Documents

export interface DocumentInput {
  readonly title: string;
  readonly type?: { readonly builtIn?: string | undefined; readonly customId?: string | undefined } | null | undefined;
  readonly documentDate?: string | null | undefined;
  readonly year?: number | null | undefined;
  readonly notes?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

/**
 * One page of Documents (16.3): searched, filtered and sorted on the server, fifty at a time. Without
 * any input: every Document of the Workspace, newest upload first ("Recently added"). Never anything
 * in Trash or of another Workspace — nor a count of them. `cursor` is what the previous page returned
 * as `next`; only its shape is checked, it can select nothing outside this listing.
 */
export async function findDocuments(deps: DocumentDeps, input: Ref & { readonly query: DocumentQueryInput; readonly cursor?: unknown }): Promise<DocumentListing> {
  await view(deps, input);
  const query = parseDocumentQuery(input.query);
  let after: DocumentCursor | null = null;
  if (input.cursor !== undefined && input.cursor !== null) {
    const parsed = parseDocumentCursor(input.cursor, query.sort);
    if (parsed === undefined) throw new InvalidCursorError();
    after = parsed;
  }
  const found = await deps.documents.findDocuments(input.workspaceId, query, after, DOCUMENTS_PAGE_SIZE);
  if (found === undefined) throw new FolderNotFoundError();
  return found;
}

/** What the filters can be set to: the years, tags and uploaders that Documents of this Workspace have. */
export async function documentFilterValues(deps: DocumentDeps, input: Ref): Promise<DocumentFilterValues> {
  await view(deps, input);
  return deps.documents.filterValues(input.workspaceId);
}

export async function getDocument(deps: DocumentDeps, input: Ref & { readonly documentId: string }): Promise<DocumentRecord> {
  await view(deps, input);
  const found = await deps.documents.findDocument(input.workspaceId, parseDocumentId(input.documentId));
  if (found === undefined) throw new DocumentNotFoundError();
  return found;
}

/**
 * Creates a Document from files uploaded before (16.1) — only now do they become permanent. A title
 * and one file are all that is required. Audited (this, not the upload, is the recorded change).
 */
export async function createDocument(deps: DocumentDeps, input: Ref & { readonly folderId: string | null; readonly content: DocumentInput; readonly fileIds: readonly string[] }): Promise<DocumentRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, folderId: folderIdOrTop(input.folderId), content: normalizeDocumentContent(input.content), fileIds: parseDocumentFileIds(input.fileIds), at: deps.clock.now() };
  return ok(await deps.documents.createDocument(values, userActor(input.actor), manage)).document;
}

/** Changes title, type, dates, notes and tags. "Uploaded" stays; "last modified" becomes this person and time. */
export async function updateDocument(deps: DocumentDeps, input: Ref & { readonly documentId: string; readonly content: DocumentInput; readonly expectedRevision: number }): Promise<DocumentRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, documentId: parseDocumentId(input.documentId), content: normalizeDocumentContent(input.content), expectedRevision: input.expectedRevision, at: deps.clock.now() };
  return ok(await deps.documents.updateDocument(values, userActor(input.actor), manage)).document;
}

/** Adds, removes and reorders the files (pages) of a Document: the complete new order. */
export async function setDocumentFiles(deps: DocumentDeps, input: Ref & { readonly documentId: string; readonly fileIds: readonly string[]; readonly expectedRevision: number }): Promise<DocumentRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, documentId: parseDocumentId(input.documentId), fileIds: parseDocumentFileIds(input.fileIds), expectedRevision: input.expectedRevision, at: deps.clock.now() };
  return ok(await deps.documents.setDocumentFiles(values, userActor(input.actor), manage)).document;
}

/** Moves one or several Documents to another Folder (or the top level). All or nothing. */
export async function moveDocuments(deps: DocumentDeps, input: Ref & { readonly documentIds: readonly string[]; readonly folderId: string | null }): Promise<number> {
  await write(deps, input);
  if (input.documentIds.length === 0 || input.documentIds.length > MAX_DOCUMENTS_PER_MOVE || new Set(input.documentIds).size !== input.documentIds.length) {
    throw new DomainValidationError('documents', 'invalid_document_selection', 'Choose between 1 and 200 documents');
  }
  const values = { workspaceId: input.workspaceId, documentIds: input.documentIds.map(parseDocumentId) as DocumentId[], folderId: folderIdOrTop(input.folderId), at: deps.clock.now() };
  return ok(await deps.documents.moveDocuments(values, userActor(input.actor), manage)).moved;
}

/** Moves a Document to Trash; its files are kept. */
export async function deleteDocument(deps: DocumentDeps, input: Ref & { readonly documentId: string }): Promise<void> {
  await write(deps, input);
  ok(await deps.documents.deleteDocument({ workspaceId: input.workspaceId, documentId: parseDocumentId(input.documentId), at: deps.clock.now() }, userActor(input.actor), manage));
}

export async function restoreDocument(deps: DocumentDeps, input: Ref & { readonly documentId: string }): Promise<RestoreOutcome> {
  await write(deps, input);
  return ok(await deps.documents.restoreDocument({ workspaceId: input.workspaceId, documentId: parseDocumentId(input.documentId), at: deps.clock.now() }, userActor(input.actor), manage)).outcome;
}

// ---- Types

/** The built-in types and the Workspace's own (retired ones included, marked — they stay on old Documents). */
export async function listDocumentTypes(deps: DocumentDeps, input: Ref): Promise<{ readonly builtIn: readonly BuiltInDocumentType[]; readonly custom: DocumentTypeRecord[] }> {
  await view(deps, input);
  return { builtIn: BUILT_IN_DOCUMENT_TYPES, custom: await deps.documents.listTypes(input.workspaceId) };
}

export async function createDocumentType(deps: DocumentDeps, input: Ref & { readonly name: string }): Promise<DocumentTypeRecord> {
  await write(deps, input);
  return ok(await deps.documents.createType({ workspaceId: input.workspaceId, name: normalizeDocumentTypeName(input.name), at: deps.clock.now() }, userActor(input.actor), manage)).type;
}

export async function renameDocumentType(deps: DocumentDeps, input: Ref & { readonly typeId: string; readonly name: string }): Promise<DocumentTypeRecord> {
  await write(deps, input);
  const values = { workspaceId: input.workspaceId, typeId: parseDocumentTypeId(input.typeId), name: normalizeDocumentTypeName(input.name), at: deps.clock.now() };
  return ok(await deps.documents.renameType(values, userActor(input.actor), manage)).type;
}

/** A retired type is no longer offered; Documents that have it keep it. */
export async function retireDocumentType(deps: DocumentDeps, input: Ref & { readonly typeId: string }): Promise<DocumentTypeRecord> {
  await write(deps, input);
  return ok(await deps.documents.retireType({ workspaceId: input.workspaceId, typeId: parseDocumentTypeId(input.typeId), at: deps.clock.now() }, userActor(input.actor), manage)).type;
}

// ---- Trash

/**
 * What is in Trash (`document.manage`: those who can restore). At the top what was deleted itself;
 * with `within`, what went to Trash together with that Folder — to restore a part of it.
 */
export async function listDocumentTrash(deps: DocumentDeps, input: Ref & { readonly within: string | null }): Promise<TrashEntry[]> {
  await write(deps, input);
  const entries = await deps.documents.listTrash(input.workspaceId, folderIdOrTop(input.within));
  if (entries === undefined) throw new FolderNotFoundError();
  return entries;
}

/** Re-checked inside the deleting transaction: only a Workspace admin deletes for good. */
const purge: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'document.purge') };

/**
 * **Permanent deletion** (16.4, H11): removes items from Trash for good — the Documents named, the
 * Folders named with everything that went to Trash with them, or all of Trash. Only a Workspace admin
 * (`document.purge`); only what is in Trash; never by itself and never after some time. Audited with
 * ids, titles and counts. The files are deleted by housekeeping once nothing references them; copies
 * in existing backups stay there until those backups rotate.
 */
export async function purgeDocumentTrash(deps: DocumentDeps, input: Ref & { readonly items: readonly { readonly kind: string; readonly id: string }[] | 'all' }): Promise<PurgeOutcome> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.purge');
  let items: readonly TrashItemRef[] | 'all' = 'all';
  if (input.items !== 'all') {
    const keys = new Set(input.items.map((item) => `${item.kind}:${item.id}`));
    if (input.items.length === 0 || input.items.length > MAX_TRASH_ITEMS_PER_PURGE || keys.size !== input.items.length || input.items.some((item) => item.kind !== 'folder' && item.kind !== 'document')) {
      throw new DomainValidationError('items', 'invalid_trash_selection', 'Choose between 1 and 200 items of Trash');
    }
    items = input.items.map((item) => (item.kind === 'folder' ? { kind: 'folder', id: parseFolderId(item.id) } : { kind: 'document', id: parseDocumentId(item.id) }));
  }
  return ok(await deps.documents.purgeTrash({ workspaceId: input.workspaceId, items, at: deps.clock.now() }, userActor(input.actor), purge)).purged;
}

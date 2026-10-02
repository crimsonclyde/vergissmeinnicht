import {
  DomainValidationError,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_FILES,
  MAX_EXPORT_SELECTION,
  parseDocumentId,
  parseFolderId,
  planExportPaths,
  type DocumentId,
  type User,
  type WorkspaceId,
} from '@vergissmeinnicht/domain';
import { roleHasCapability } from '@vergissmeinnicht/permissions';
import { NotAuthorizedError } from '../invitations/errors.ts';
import type { ActorGuard } from '../ports/actor-guard.ts';
import type { DocumentFileStore } from '../ports/document-files.ts';
import type { ExportScope, ExportSize, ExportedDocument, ExportedFile } from '../ports/document-repository.ts';
import { userActor } from '../user-actor.ts';
import type { DocumentDeps } from './documents.ts';
import { DocumentFileNotFoundError, DocumentNotFoundError, ExportRunningError, ExportTooLargeError, FolderNotFoundError, ToolNotEnabledError } from './errors.ts';
import { authorizeTool } from './tools.ts';

export interface DocumentExportDeps extends DocumentDeps {
  readonly store: Pick<DocumentFileStore, 'open'>;
  /** What one export may hold; the domain's bounds (2 GB, 5 000 files) unless a test sets smaller ones. */
  readonly exportLimits?: { readonly files: number; readonly bytes: number };
}

/** What to export, as it arrives: one Folder (with its sub-folders), Documents chosen one by one, or — neither given — everything. */
export interface ExportRequest {
  readonly folder?: string | undefined;
  readonly documents?: readonly string[] | undefined;
}

/** A Document in an export, with where it and its files are in the archive. */
export interface ArchivedDocument extends Omit<ExportedDocument, 'files'> {
  /** The Folders it is in, by name, outermost first (within the export). */
  readonly folderNames: readonly string[];
  /** Its directory in the archive, as path segments. */
  readonly directory: readonly string[];
  readonly files: readonly (ExportedFile & { readonly page: number; readonly path: readonly string[]; readonly open: () => Promise<AsyncIterable<Uint8Array>> })[];
}

/** Everything the archive is written from. No path in it comes from a title or file name as it is. */
export interface DocumentExport {
  readonly workspaceName: string;
  /** The exported Folder, or `null` for "all documents" or a selection. */
  readonly folderName: string | null;
  readonly scope: 'all' | 'folder' | 'selection';
  readonly exportedAt: Date;
  readonly exportedByName: string;
  readonly documents: readonly ArchivedDocument[];
  readonly size: ExportSize;
}

function parseScope(request: ExportRequest): ExportScope {
  if (request.folder !== undefined && request.documents !== undefined) throw new DomainValidationError('scope', 'invalid_export_scope', 'Export a folder or a selection, not both');
  if (request.folder !== undefined) return { kind: 'folder', id: parseFolderId(request.folder) };
  if (request.documents === undefined) return { kind: 'all' };
  if (request.documents.length === 0 || request.documents.length > MAX_EXPORT_SELECTION || new Set(request.documents).size !== request.documents.length) {
    throw new DomainValidationError('documents', 'invalid_export_selection', 'Choose between 1 and 200 documents');
  }
  return { kind: 'documents', ids: request.documents.map(parseDocumentId) as DocumentId[] };
}

const limitsOf = (deps: { readonly exportLimits?: { readonly files: number; readonly bytes: number } }) => deps.exportLimits ?? { files: MAX_EXPORT_FILES, bytes: MAX_EXPORT_BYTES };
const notFound = (scope: ExportScope) => (scope.kind === 'folder' ? new FolderNotFoundError() : new DocumentNotFoundError());

/** Re-checked inside the transaction that records the export: whoever can view Documents may export them (P2 — guests included). */
const viewer: ActorGuard = { actorMay: (role) => roleHasCapability(role, 'document.view') };

/** One export at a time per person: an archive can be large and is read from disk while it is sent. */
const running = new Set<string>();

interface Ref {
  readonly actor: User;
  readonly workspaceId: WorkspaceId;
}

/**
 * How much an export would hold — asked before starting one, so the size can be shown and "too large"
 * is said plainly. Same authorisation as the export itself; nothing is recorded.
 */
export async function checkDocumentExport(deps: DocumentDeps & Pick<DocumentExportDeps, 'exportLimits'>, input: Ref & { readonly request: ExportRequest }): Promise<ExportSize> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  const scope = parseScope(input.request);
  const size = await deps.documents.exportSize(input.workspaceId, scope);
  if (size === undefined) throw notFound(scope);
  const limits = limitsOf(deps);
  if (size.files > limits.files || size.bytes > limits.bytes) throw new ExportTooLargeError(size);
  if (running.has(input.actor.id)) throw new ExportRunningError();
  return size;
}

/**
 * Exports Documents (16.4, H12 / P2): every member who can view Documents — guests included — for all
 * Documents, one Folder with its sub-folders, or a selection. Never anything in Trash or of another
 * Workspace. Bounded (2 GB, 5 000 files), one at a time per person, audited. `deliver` receives what
 * the archive is written from and resolves when it has been sent (or given up); the export counts as
 * running until then. Files are opened one by one, only when their turn comes.
 */
export async function exportDocuments(deps: DocumentExportDeps, input: Ref & { readonly request: ExportRequest }, deliver: (archive: DocumentExport) => Promise<void>): Promise<void> {
  await authorizeTool(deps, input.actor, input.workspaceId, 'DOCUMENTS', 'document.view');
  const scope = parseScope(input.request);
  if (running.has(input.actor.id)) throw new ExportRunningError();
  running.add(input.actor.id);
  try {
    const workspace = await deps.workspaces.findById(input.workspaceId);
    const at = deps.clock.now();
    const started = await deps.documents.startExport({ workspaceId: input.workspaceId, scope, limits: limitsOf(deps), at }, userActor(input.actor), viewer);
    if (started.status === 'limit_reached') {
      const size = await deps.documents.exportSize(input.workspaceId, scope);
      throw size === undefined ? notFound(scope) : new ExportTooLargeError(size);
    }
    if (started.status === 'forbidden') throw new NotAuthorizedError();
    if (started.status === 'tool_disabled') throw new ToolNotEnabledError();
    if (started.status !== 'ok') throw notFound(scope);
    const { data } = started;
    const paths = planExportPaths(data.folders, data.documents);
    const folders = new Map(data.folders.map((folder) => [folder.id as string, folder]));
    const folderNames = (folderId: string | null): string[] => {
      const names: string[] = [];
      for (let current = folderId; current !== null && names.length <= folders.size; ) {
        const folder = folders.get(current);
        if (folder === undefined) break;
        names.unshift(folder.name);
        current = folder.parentId;
      }
      return names;
    };
    const documents = data.documents.map((document): ArchivedDocument => {
      const place = paths.documents.get(document.id);
      const directory = place?.directory ?? [];
      return {
        ...document,
        folderNames: folderNames(document.folderId),
        directory,
        files: document.files.map((file, index) => ({
          ...file,
          page: index + 1,
          path: [...directory, place?.files[index] ?? ''],
          open: async () => {
            const opened = await deps.store.open(file.sha256);
            if (opened === undefined) throw new DocumentFileNotFoundError();
            return opened.stream;
          },
        })),
      };
    });
    await deliver({
      workspaceName: workspace?.name ?? '',
      folderName: data.folderName,
      scope: scope.kind === 'documents' ? 'selection' : scope.kind,
      exportedAt: at,
      exportedByName: input.actor.displayName,
      documents,
      size: data.size,
    });
  } finally {
    running.delete(input.actor.id);
  }
}

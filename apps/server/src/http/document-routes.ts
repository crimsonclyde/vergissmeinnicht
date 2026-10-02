import { finished } from 'node:stream';
import {
  checkDocumentExport,
  createDocument,
  createDocumentType,
  createFolder,
  deleteDocument,
  deleteFolder,
  documentFilterValues,
  enabledTools,
  exportDocuments,
  findDocuments,
  getDocument,
  listDocumentTrash,
  listDocumentTypes,
  listFolders,
  moveDocuments,
  moveFolder,
  purgeDocumentTrash,
  renameDocumentType,
  renameFolder,
  restoreDocument,
  restoreFolder,
  retireDocumentType,
  setDocumentFiles,
  setWorkspaceTool,
  updateDocument,
  InvalidCursorError,
  type DocumentRecord,
  type DocumentSummary,
  type FolderRecord,
  type RestoreOutcome,
  type TrashEntry,
} from '@vergissmeinnicht/application';
import { MAX_EXPORT_BYTES, MAX_EXPORT_FILES, UUID_V4, exportSegment, type DocumentCursor, type WorkspaceId } from '@vergissmeinnicht/domain';
import { writeDocumentsArchive } from '@vergissmeinnicht/import-export';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { attachment, fileView } from './document-file-routes.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const folderParams = z.strictObject({ workspaceId: uuid, folderId: uuid });
const documentParams = z.strictObject({ workspaceId: uuid, documentId: uuid });
const typeParams = z.strictObject({ workspaceId: uuid, typeId: uuid });
// Coarse transport bounds; the domain normalizes and enforces the exact rules.
const name = z.string().max(1024);
const revision = z.number().int().min(1);
const folderRef = uuid.nullable();
const content = {
  title: name,
  type: z.strictObject({ builtIn: z.string().max(64).optional(), customId: uuid.optional() }).nullable().optional(),
  documentDate: z.string().max(10).nullable().optional(),
  year: z.number().int().min(0).max(9999).nullable().optional(),
  notes: z.string().max(20_000).optional(),
  tags: z.array(z.string().max(256)).max(64).optional(),
};
const fileIds = z.array(uuid).max(200);
const createFolderBody = z.strictObject({ name, parentId: folderRef });
const renameFolderBody = z.strictObject({ name, expectedRevision: revision });
const moveFolderBody = z.strictObject({ parentId: folderRef, expectedRevision: revision });
const createDocumentBody = z.strictObject({ ...content, folderId: folderRef, fileIds });
const updateDocumentBody = z.strictObject({ ...content, expectedRevision: revision });
const filesBody = z.strictObject({ fileIds, expectedRevision: revision });
const moveDocumentsBody = z.strictObject({ documentIds: z.array(uuid).max(1000), folderId: folderRef });
// A listing (16.3). Everything is optional and bounded here; the domain decides what each value may be.
// A repeated `tag=` arrives as an array, a single one as a string.
const listQuery = z.strictObject({
  q: z.string().max(400).optional(),
  folder: z.union([uuid, z.literal('top')]).optional(),
  sub: z.literal('1').optional(),
  type: z.string().max(64).optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  tag: z.union([z.string().max(256), z.array(z.string().max(256)).max(10)]).optional(),
  uploader: z.string().max(1024).optional(),
  sort: z.string().max(32).optional(),
  dir: z.string().max(8).optional(),
  cursor: z.string().max(8192).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
const trashQuery = z.strictObject({ within: uuid.optional() });
// Permanent deletion names its items, or says "all" — never both, never nothing.
const purgeBody = z.union([z.strictObject({ items: z.array(z.strictObject({ kind: z.enum(['folder', 'document']), id: uuid })).min(1).max(1000) }), z.strictObject({ all: z.literal(true) })]);
// An export: one Folder (with its sub-folders), Documents named one by one (`document=` repeated), or neither — everything.
const exportQuery = z.strictObject({ folder: uuid.optional(), document: z.union([uuid, z.array(uuid).max(200)]).optional() });
const exportRequest = (query: z.infer<typeof exportQuery>) => ({ folder: query.folder, documents: query.document === undefined ? undefined : typeof query.document === 'string' ? [query.document] : query.document });
const MINUTE_MS = 60_000;
const typeBody = z.strictObject({ name });
const toolBody = z.strictObject({ tool: z.string().max(32), enabled: z.boolean() });

/** Metadata and notes of one Document; never files. */
const BODY_LIMIT = 64 * 1024;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

const ref = (request: FastifyRequest, workspaceId: string) => ({ actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });

const folderView = (folder: FolderRecord) => ({ id: folder.id, parentId: folder.parentId, name: folder.name, revision: folder.revision, documents: folder.documents });

/** Display names only — never user ids, emails or storage names. */
const summaryView = (document: DocumentSummary) => ({
  id: document.id,
  folderId: document.folderId,
  title: document.title,
  type: document.type,
  documentDate: document.documentDate,
  year: document.year,
  tags: document.tags,
  revision: document.revision,
  files: document.files,
  cover: document.cover,
  uploadedAt: document.uploadedAt.toISOString(),
  uploadedBy: document.uploadedByName,
  modifiedAt: document.modifiedAt.toISOString(),
  modifiedBy: document.modifiedByName,
});

const documentView = (document: DocumentRecord) => ({ ...summaryView(document), notes: document.notes, pages: document.pages.map(fileView) });

/** A cursor travels as base64url JSON: opaque to the client, and only a position — it carries no authority. */
const encodeCursor = (cursor: DocumentCursor | null) => (cursor === null ? null : Buffer.from(JSON.stringify([cursor.value, cursor.id]), 'utf8').toString('base64url'));
function decodeCursor(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new InvalidCursorError();
  }
}

const outcomeView = (outcome: RestoreOutcome) => ({ folders: outcome.folders, documents: outcome.documents, renamedTo: outcome.renamedTo ?? null, movedTo: outcome.movedTo ?? null });

const trashView = (entry: TrashEntry) => ({
  kind: entry.kind,
  id: entry.id,
  name: entry.name,
  location: entry.location,
  deletedAt: entry.deletedAt.toISOString(),
  deletedBy: entry.deletedByName,
  folders: entry.folders,
  documents: entry.documents,
  files: entry.files,
});

/** Optional tools of a Workspace (16.2): every member reads which are on; a Workspace admin switches them. */
export async function workspaceToolRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.documents;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { tools: await enabledTools(deps, ref(request, workspaceId)) };
  });

  app.post('/', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(toolBody, request.body);
    return { tools: await setWorkspaceTool(deps, { ...ref(request, workspaceId), ...body }) };
  });
}

/**
 * Folders of Documents (16.2). All routes need a session, the Documents tool switched on in the
 * Workspace (otherwise 404) and `document.view`; writes need `document.manage` (USER and above — a
 * GUEST only reads). Ids of another Workspace are "not found".
 */
export async function documentFolderRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.documents;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { folders: (await listFolders(deps, ref(request, workspaceId))).map(folderView) };
  });

  app.post('/', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createFolderBody, request.body);
    return reply.code(201).send({ folder: folderView(await createFolder(deps, { ...ref(request, workspaceId), ...body })) });
  });

  app.post('/:folderId/rename', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, folderId } = parse(folderParams, request.params);
    const body = parse(renameFolderBody, request.body);
    return { folder: folderView(await renameFolder(deps, { ...ref(request, workspaceId), folderId, ...body })) };
  });

  app.post('/:folderId/move', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, folderId } = parse(folderParams, request.params);
    const body = parse(moveFolderBody, request.body);
    return { folder: folderView(await moveFolder(deps, { ...ref(request, workspaceId), folderId, ...body })) };
  });

  app.post('/:folderId/delete', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, folderId } = parse(folderParams, request.params);
    return { deleted: await deleteFolder(deps, { ...ref(request, workspaceId), folderId }) };
  });

  app.post('/:folderId/restore', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, folderId } = parse(folderParams, request.params);
    return { restored: outcomeView(await restoreFolder(deps, { ...ref(request, workspaceId), folderId })) };
  });
}

/** Documents (16.2): records with ordered files. Same access rules as the Folders. */
export async function documentRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.documents;
  app.addHook('preHandler', requireUser(services));

  // One page of Documents (16.3). Without parameters: all of the Workspace, newest upload first.
  // `folder=<id>|top`, `sub=1` (with sub-folders), `q`, `type`, `year`, `tag` (repeatable), `uploader`,
  // `sort`, `dir`, and `cursor` (the `nextCursor` of the page before).
  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { sub, year, tag, dir, cursor, ...rest } = parse(listQuery, request.query);
    const query = { ...rest, subfolders: sub === '1', year: year === undefined ? undefined : Number(year), tags: tag === undefined ? [] : typeof tag === 'string' ? [tag] : tag, direction: dir };
    const found = await findDocuments(deps, { ...ref(request, workspaceId), query, cursor: decodeCursor(cursor) });
    return { documents: found.documents.map(summaryView), nextCursor: encodeCursor(found.next), total: found.total };
  });

  // What the filters can be set to: years, tags and uploaders that Documents here actually have.
  app.get('/filters', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { filters: await documentFilterValues(deps, ref(request, workspaceId)) };
  });

  app.post('/', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { folderId, fileIds: files, ...fields } = parse(createDocumentBody, request.body);
    return reply.code(201).send({ document: documentView(await createDocument(deps, { ...ref(request, workspaceId), folderId, fileIds: files, content: fields })) });
  });

  app.post('/move', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(moveDocumentsBody, request.body);
    return { moved: await moveDocuments(deps, { ...ref(request, workspaceId), ...body }) };
  });

  app.get('/trash', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { within } = parse(trashQuery, request.query);
    return { entries: (await listDocumentTrash(deps, { ...ref(request, workspaceId), within: within ?? null })).map(trashView) };
  });

  // How much an export would hold, asked before starting one (and "too large" said plainly).
  app.get('/export/check', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const size = await checkDocumentExport(deps, { ...ref(request, workspaceId), request: exportRequest(parse(exportQuery, request.query)) });
    return { export: { ...size, maxFiles: MAX_EXPORT_FILES, maxBytes: MAX_EXPORT_BYTES } };
  });

  // The export itself (16.4): a ZIP of the originals in their Folders with metadata.json and index.html,
  // streamed. Every member who can view Documents; one at a time per person; audited.
  app.get(
    '/export',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: 15 * MINUTE_MS,
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => `document-export:${request.principal?.user.id ?? request.ip}`,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = parse(workspaceParams, request.params);
      const query = exportRequest(parse(exportQuery, request.query));
      await exportDocuments(
        deps,
        { ...ref(request, workspaceId), request: query },
        (archive) =>
          new Promise<void>((resolve) => {
            const zip = writeDocumentsArchive(archive);
            // The export counts as running until the answer is finished or the client is gone.
            finished(reply.raw, () => {
              zip.destroy();
              resolve();
            });
            const fileName = `${exportSegment(`Documents - ${archive.folderName ?? archive.workspaceName} - ${archive.exportedAt.toISOString().slice(0, 10)}`)}.zip`;
            void reply.type('application/zip').header('Content-Disposition', attachment(fileName)).send(zip);
          }),
      );
      return reply;
    },
  );

  // Deletes items of Trash for good (16.4): Workspace admins only (`document.purge`).
  app.post('/trash/purge', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(purgeBody, request.body);
    return { purged: await purgeDocumentTrash(deps, { ...ref(request, workspaceId), items: 'all' in body ? 'all' : body.items }) };
  });

  app.get('/:documentId', async (request) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    return { document: documentView(await getDocument(deps, { ...ref(request, workspaceId), documentId })) };
  });

  app.post('/:documentId/update', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    const { expectedRevision, ...fields } = parse(updateDocumentBody, request.body);
    return { document: documentView(await updateDocument(deps, { ...ref(request, workspaceId), documentId, expectedRevision, content: fields })) };
  });

  app.post('/:documentId/files', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    const body = parse(filesBody, request.body);
    return { document: documentView(await setDocumentFiles(deps, { ...ref(request, workspaceId), documentId, ...body })) };
  });

  app.post('/:documentId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    await deleteDocument(deps, { ...ref(request, workspaceId), documentId });
    return reply.code(204).send();
  });

  app.post('/:documentId/restore', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    return { restored: outcomeView(await restoreDocument(deps, { ...ref(request, workspaceId), documentId })) };
  });
}

/** Document types (16.2): the built-in ones and the Workspace's own, managed by USER and above. */
export async function documentTypeRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.documents;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return { types: await listDocumentTypes(deps, ref(request, workspaceId)) };
  });

  app.post('/', { bodyLimit: 4096 }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return reply.code(201).send({ type: await createDocumentType(deps, { ...ref(request, workspaceId), ...parse(typeBody, request.body) }) });
  });

  app.post('/:typeId/rename', { bodyLimit: 4096 }, async (request) => {
    const { workspaceId, typeId } = parse(typeParams, request.params);
    return { type: await renameDocumentType(deps, { ...ref(request, workspaceId), typeId, ...parse(typeBody, request.body) }) };
  });

  app.post('/:typeId/retire', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, typeId } = parse(typeParams, request.params);
    return { type: await retireDocumentType(deps, { ...ref(request, workspaceId), typeId }) };
  });
}

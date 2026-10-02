import {
  addDocumentLink,
  linkRunDocument,
  listDocumentLinks,
  listLinkedDocuments,
  listRunDocuments,
  removeDocumentLink,
  removeRunDocumentFromFinishedRun,
  unlinkRunDocument,
  type LinkView,
  type RunDocumentRemoval,
  type RunDocumentView,
  type RunLinkView,
} from '@vergissmeinnicht/application';
import { UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { fileView } from './document-file-routes.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const documentParams = z.strictObject({ workspaceId: uuid, documentId: uuid });
const linkParams = z.strictObject({ workspaceId: uuid, linkId: uuid });
const runParams = z.strictObject({ workspaceId: uuid, runId: uuid });
const runDocumentParams = z.strictObject({ workspaceId: uuid, runId: uuid, runDocumentId: uuid });
// The kind of record is a name the domain checks; the id is always a UUID.
const addBody = z.strictObject({ target: z.strictObject({ type: z.string().max(32), id: uuid }) });
const runBody = z.strictObject({ documentId: uuid });
// Removal from a finished Run: the reason, and the confirmation given explicitly — `true`, nothing else.
const removeKeptBody = z.strictObject({ reason: z.string().max(4000), confirm: z.literal(true) });
// Exactly one record whose linked Documents are asked for.
const targetQuery = z.union([z.strictObject({ procedure: uuid }), z.strictObject({ schedule: uuid }), z.strictObject({ contact: uuid })]);

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

/** The other end of a Link: its kind, id, title and state — display names only, never content. */
export const linkView = (link: Pick<LinkView, 'id' | 'record' | 'createdAt' | 'createdByName'>) => ({
  id: link.id,
  record: {
    type: link.record.type,
    id: link.record.id,
    title: link.record.title,
    state: link.record.state,
    scheduleKind: link.record.scheduleKind ?? null,
    runState: link.record.runState ?? null,
    nextDue: link.record.nextDue ?? null,
    goneAt: link.record.goneAt?.toISOString() ?? null,
    goneBy: link.record.goneByName ?? null,
  },
  createdAt: link.createdAt.toISOString(),
  createdBy: link.createdByName,
});

const runLinkView = (link: RunLinkView) => ({ id: link.id, runId: link.runId, title: link.runTitle, state: link.runState, linkedAt: link.linkedAt.toISOString(), linkedBy: link.linkedByName, changedSince: link.changedSince });

const runDocumentView = (document: RunDocumentView) => ({
  id: document.id,
  sourceDocumentId: document.sourceDocumentId,
  source: document.source,
  title: document.title,
  type: document.type === null ? null : document.type.kind === 'builtin' ? { kind: 'builtin', key: document.type.key } : { kind: 'custom', name: document.type.name },
  documentDate: document.documentDate,
  year: document.year,
  notes: document.notes,
  tags: document.tags,
  files: document.files.map(fileView),
  linkedAt: document.linkedAt.toISOString(),
  linkedBy: document.linkedByName,
});

/** The permanent note of a removed version: who, when, why — nothing of the document. */
const removalView = (removal: RunDocumentRemoval) => ({
  id: removal.id,
  reason: removal.reason,
  files: removal.files,
  linkedAt: removal.linkedAt.toISOString(),
  linkedBy: removal.linkedByName,
  removedAt: removal.removedAt.toISOString(),
  removedBy: removal.removedByName,
});

/**
 * Links (16.5): references between a Document and a Procedure, a Schedule or another Document, and the
 * Document versions a Run retains. All routes need a session, the Documents tool switched on (404
 * otherwise) and `document.view`; changes need `document.manage` (a GUEST only reads). Ids of another
 * Workspace are "not found". A Link grants nothing: each record is still read through its own routes.
 * The files of a retained version are served by the document-file routes, by file id.
 */
export async function linkRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.links;
  app.addHook('preHandler', requireUser(services));

  app.get('/documents/:documentId/links', async (request) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    const found = await listDocumentLinks(deps, { ...ref(request, workspaceId), documentId });
    return { links: found.links.map(linkView), runs: found.runs.map(runLinkView) };
  });

  app.post('/documents/:documentId/links', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, documentId } = parse(documentParams, request.params);
    const { target } = parse(addBody, request.body);
    return reply.code(201).send({ link: linkView(await addDocumentLink(deps, { ...ref(request, workspaceId), documentId, target })) });
  });

  // The Documents linked to one Procedure, Schedule or Contact: `?procedure=<id>`, `?schedule=<id>` or `?contact=<id>`.
  app.get('/document-links', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const query = parse(targetQuery, request.query);
    const target = 'procedure' in query ? { type: 'procedure', id: query.procedure } : 'schedule' in query ? { type: 'schedule', id: query.schedule } : { type: 'contact', id: query.contact };
    return { links: (await listLinkedDocuments(deps, { ...ref(request, workspaceId), target })).map(linkView) };
  });

  app.post('/document-links/:linkId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, linkId } = parse(linkParams, request.params);
    await removeDocumentLink(deps, { ...ref(request, workspaceId), linkId });
    return reply.code(204).send();
  });

  app.get('/runs/:runId/documents', async (request) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const found = await listRunDocuments(deps, { ...ref(request, workspaceId), runId });
    return { documents: found.documents.map(runDocumentView), removals: found.removals.map(removalView) };
  });

  app.post('/runs/:runId/documents', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, runId } = parse(runParams, request.params);
    const { documentId } = parse(runBody, request.body);
    return reply.code(201).send({ document: runDocumentView(await linkRunDocument(deps, { ...ref(request, workspaceId), runId, documentId })) });
  });

  // From a finished Run (P4): Workspace admins only, with a reason and `confirm: true`; leaves a permanent note.
  app.post('/runs/:runId/documents/:runDocumentId/remove-kept', { bodyLimit: 16_384 }, async (request) => {
    const { workspaceId, runId, runDocumentId } = parse(runDocumentParams, request.params);
    const body = parse(removeKeptBody, request.body);
    return { removal: removalView(await removeRunDocumentFromFinishedRun(deps, { ...ref(request, workspaceId), runId, runDocumentId, reason: body.reason, confirmed: body.confirm })) };
  });

  app.post('/runs/:runId/documents/:runDocumentId/remove', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, runId, runDocumentId } = parse(runDocumentParams, request.params);
    await unlinkRunDocument(deps, { ...ref(request, workspaceId), runId, runDocumentId });
    return reply.code(204).send();
  });
}

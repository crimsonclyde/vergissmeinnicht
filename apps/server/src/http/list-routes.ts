import {
  addListItem,
  createList,
  deleteList,
  getList,
  listLists,
  listSnapshot,
  replayListChange,
  removeListItem,
  renameList,
  restoreList,
  restoreListItem,
  setListItemChecked,
  updateListItem,
  type ListSummary,
  type ListWithItems,
} from '@vergissmeinnicht/application';
import { UUID_V4, type List, type ListId, type ListItem, type ListItemId, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const listParams = z.strictObject({ workspaceId: uuid, listId: uuid });
const itemParams = z.strictObject({ workspaceId: uuid, listId: uuid, itemId: uuid });
// Coarse transport bounds; the domain normalizes and enforces the exact rules.
const title = z.string().max(1024);
const optionalText = z.string().max(64).nullable().optional();
const createBody = z.strictObject({ title });
const renameBody = z.strictObject({ title, expectedTitle: title });
const itemBody = z.strictObject({ title, quantity: optionalText, unit: optionalText });
const itemUpdateBody = z.strictObject({ title, quantity: optionalText, unit: optionalText, expectedRevision: z.number().int().min(1) });
const checkBody = z.strictObject({ checked: z.boolean() });
const itemContent = { title, quantity: optionalText, unit: optionalText };
/** One change made offline (17.5): what it is, and who made it when — the server decides what it does. */
const replayBody = z.strictObject({
  clientChangeId: uuid,
  /** The account that made the change; must be the one signed in (13.1). */
  userId: uuid,
  deviceTime: z.iso.datetime({ offset: true }),
  change: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('createList'), listId: uuid, title }),
    z.strictObject({ kind: z.literal('renameList'), listId: uuid, title }),
    z.strictObject({ kind: z.literal('deleteList'), listId: uuid }),
    z.strictObject({ kind: z.literal('addItem'), listId: uuid, itemId: uuid, ...itemContent }),
    z.strictObject({ kind: z.literal('editItem'), listId: uuid, itemId: uuid, ...itemContent }),
    z.strictObject({ kind: z.literal('checkItem'), listId: uuid, itemId: uuid, checked: z.boolean() }),
    z.strictObject({ kind: z.literal('removeItem'), listId: uuid, itemId: uuid }),
  ]),
});

/** Small bodies only: a List name or one item. */
const BODY_LIMIT = 4096;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Display names only — never user ids or emails. */
function listInfo(list: List) {
  return {
    id: list.id,
    kind: list.kind,
    title: list.title,
    revision: list.revision,
    createdAt: list.created.at.toISOString(),
    createdBy: list.created.by.displayName,
    updatedAt: list.updatedAt.toISOString(),
    deleted: list.deleted !== null,
  };
}

function itemView(item: ListItem) {
  return {
    id: item.id,
    title: item.title,
    quantity: item.quantity,
    unit: item.unit,
    revision: item.revision,
    addedBy: item.created.by.displayName,
    checked: item.checked === null ? null : { at: item.checked.at.toISOString(), by: item.checked.by.displayName },
  };
}

const summaryView = (entry: ListSummary) => ({ ...listInfo(entry.list), open: entry.open, checked: entry.checked });
const detailView = (entry: ListWithItems) => ({ ...listInfo(entry.list), items: entry.items.map(itemView) });

/**
 * Lists of one Workspace (`/api/workspaces/{workspaceId}/lists`, 15.3): grocery lists with items that
 * are checked off. Reading needs `list.view`, every change `list.edit`; authorization is enforced in
 * the use-cases. Every change answers with the canonical List.
 */
export async function listRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.lists;
  app.addHook('preHandler', requireUser(services));
  const post = { bodyLimit: BODY_LIMIT };
  const listRef = (request: FastifyRequest) => {
    const { workspaceId, listId } = parse(listParams, request.params);
    return { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, listId: listId as ListId };
  };
  const itemRef = (request: FastifyRequest) => {
    const { workspaceId, listId, itemId } = parse(itemParams, request.params);
    return { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, listId: listId as ListId, itemId: itemId as ListItemId };
  };

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const entries = await listLists(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { lists: entries.map(summaryView) };
  });

  app.post('/', post, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createBody, request.body);
    const created = await createList(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, title: body.title });
    return reply.code(201).send({ list: detailView(created) });
  });

  // Offline use (17.5): every List with its items for the device, and one change made offline.
  app.get('/snapshot', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const entries = await listSnapshot(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    return { lists: entries.map(detailView), at: new Date().toISOString() };
  });

  app.post('/replay', post, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(replayBody, request.body);
    const result = await replayListChange(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      clientChangeId: body.clientChangeId,
      madeBy: body.userId,
      deviceTime: new Date(body.deviceTime),
      change: body.change,
    });
    return {
      outcome: result.outcome,
      duplicate: result.duplicate,
      by: result.by,
      byAt: result.byAt === null ? null : result.byAt.toISOString(),
      list: result.list === null ? null : detailView(result.list),
    };
  });

  app.get('/:listId', async (request) => ({ list: detailView(await getList(deps, listRef(request))) }));

  app.post('/:listId/rename', post, async (request) => {
    const ref = listRef(request);
    return { list: detailView(await renameList(deps, { ...ref, ...parse(renameBody, request.body) })) };
  });

  app.post('/:listId/delete', post, async (request) => ({ list: detailView(await deleteList(deps, listRef(request))) }));

  app.post('/:listId/restore', post, async (request) => ({ list: detailView(await restoreList(deps, listRef(request))) }));

  app.post('/:listId/items', post, async (request, reply) => {
    const ref = listRef(request);
    const added = await addListItem(deps, { ...ref, ...parse(itemBody, request.body) });
    return reply.code(201).send({ list: detailView(added.list), itemId: added.itemId });
  });

  app.post('/:listId/items/:itemId/update', post, async (request) => {
    const ref = itemRef(request);
    return { list: detailView(await updateListItem(deps, { ...ref, ...parse(itemUpdateBody, request.body) })) };
  });

  app.post('/:listId/items/:itemId/check', post, async (request) => {
    const ref = itemRef(request);
    return { list: detailView(await setListItemChecked(deps, { ...ref, ...parse(checkBody, request.body) })) };
  });

  app.post('/:listId/items/:itemId/remove', post, async (request) => ({ list: detailView(await removeListItem(deps, itemRef(request))) }));

  app.post('/:listId/items/:itemId/restore', post, async (request) => ({ list: detailView(await restoreListItem(deps, itemRef(request))) }));
}

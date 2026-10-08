import {
  InvalidCursorError,
  addMaintenanceLink,
  createMaintenanceRecord,
  deleteMaintenanceRecord,
  findMaintenance,
  getMaintenanceRecord,
  listMaintenanceLinks,
  listMaintenanceTrash,
  maintenanceBoard,
  maintenanceDueSoon,
  maintenanceFilterValues,
  purgeMaintenanceTrash,
  removeMaintenanceLink,
  restoreMaintenanceRecord,
  setMaintenanceStatus,
  updateMaintenanceRecord,
  type MaintenanceRecord,
  type MaintenanceSummary,
  type TrashedMaintenanceRecord,
} from '@vergissmeinnicht/application';
import { CURRENCY_CODES, MAINTENANCE_STATUSES, UUID_V4, type MaintenanceCursor, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { linkView } from './link-routes.ts';
import { requireUser, type Principal } from './session.ts';

// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const recordParams = z.strictObject({ workspaceId: uuid, recordId: uuid });
const linkParams = z.strictObject({ workspaceId: uuid, linkId: uuid });
// Coarse transport bounds; the domain normalizes and enforces the exact rules.
const line = z.string().max(2048);
const date = z.string().max(10);
const content = {
  title: line,
  category: line.optional(),
  date: date.nullable().optional(),
  description: z.string().max(20_000).optional(),
  contactId: uuid.nullable().optional(),
  cost: z.strictObject({ amount: z.string().max(64), currency: z.string().max(8) }).nullable().optional(),
};
const revision = z.number().int().min(1);
const createBody = z.strictObject(content);
const updateBody = z.strictObject({ ...content, expectedRevision: revision });
// A status is a name the domain checks; nothing else of the record travels with a status change.
const statusBody = z.strictObject({ status: z.string().max(32), expectedRevision: revision, completedOn: date.optional() });
const listQuery = z.strictObject({
  q: z.string().max(400).optional(),
  status: z.string().max(32).optional(),
  category: line.optional(),
  contact: uuid.optional(),
  equipment: uuid.optional(),
  year: z.string().regex(/^\d{4}$/).optional(),
  cursor: z.string().max(8192).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
const noQuery = z.strictObject({});
const purgeBody = z.union([z.strictObject({ recordIds: z.array(uuid).min(1).max(1000) }), z.strictObject({ all: z.literal(true) })]);
const linkBody = z.strictObject({ target: z.strictObject({ type: z.string().max(32), id: uuid }) });

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

const summaryView = (record: MaintenanceSummary) => ({
  id: record.id,
  title: record.title,
  category: record.category,
  date: record.date,
  status: record.status,
  completedOn: record.completedOn,
  contact: record.contact,
  cost: record.cost,
  revision: record.revision,
});

/** Display names only — never user ids. */
const recordView = (record: MaintenanceRecord) => ({
  ...summaryView(record),
  description: record.description,
  createdAt: record.createdAt.toISOString(),
  createdBy: record.createdByName,
  modifiedAt: record.updatedAt.toISOString(),
  modifiedBy: record.updatedByName,
});

const trashView = (record: TrashedMaintenanceRecord) => ({ id: record.id, title: record.title, status: record.status, deletedAt: record.deletedAt.toISOString(), deletedBy: record.deletedByName });

/** A cursor travels as base64url JSON: opaque to the client, and only a position — it carries no authority. */
const encodeCursor = (cursor: MaintenanceCursor | null) => (cursor === null ? null : Buffer.from(JSON.stringify([cursor.value, cursor.id]), 'utf8').toString('base64url'));
function decodeCursor(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new InvalidCursorError();
  }
}

/**
 * Maintenance (16.7). All routes need a session and the Maintenance tool switched on in that Workspace
 * (404 otherwise, for every role). Reading needs `maintenance.view` (every member, guests included —
 * costs too, P3); changing anything needs `maintenance.manage` (USER and above); permanent deletion
 * `maintenance.purge` (Workspace admins). Ids of another Workspace are "not found". There is no route
 * that sums costs, and none through which a Run or a Schedule changes a record.
 */
export async function maintenanceRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.maintenance;
  app.addHook('preHandler', requireUser(services));

  // The board: the four statuses, each with its newest cards and its total.
  app.get('/maintenance/board', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { statuses: MAINTENANCE_STATUSES, columns: (await maintenanceBoard(deps, ref(request, workspaceId))).map((column) => ({ status: column.status, total: column.total, records: column.records.map(summaryView) })) };
  });

  // Today's Maintenance due soon card (19.1): a few soonest open records, read-only. `today` is the viewer's local date.
  app.get('/maintenance/due-soon', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { today } = parse(z.strictObject({ today: z.string().max(10) }), request.query);
    const found = await maintenanceDueSoon(deps, { ...ref(request, workspaceId), today });
    return { items: found.items, total: found.total };
  });

  // The List: newest first; `q`, `status`, `category`, `contact`, `year`, `cursor`.
  app.get('/maintenance', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const { cursor, year, ...rest } = parse(listQuery, request.query);
    const found = await findMaintenance(deps, { ...ref(request, workspaceId), query: { ...rest, year: year === undefined ? undefined : Number(year) }, cursor: decodeCursor(cursor) });
    return { records: found.records.map(summaryView), nextCursor: encodeCursor(found.next), total: found.total };
  });

  // What the List can be filtered by, and the currencies a cost can be recorded in.
  app.get('/maintenance/filters', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { filters: await maintenanceFilterValues(deps, ref(request, workspaceId)), currencies: CURRENCY_CODES };
  });

  app.post('/maintenance', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    return reply.code(201).send({ record: recordView(await createMaintenanceRecord(deps, { ...ref(request, workspaceId), content: parse(createBody, request.body) })) });
  });

  app.get('/maintenance/trash', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    parse(noQuery, request.query);
    return { records: (await listMaintenanceTrash(deps, ref(request, workspaceId))).map(trashView) };
  });

  // Deletes records in Trash for good: Workspace admins only (`maintenance.purge`).
  app.post('/maintenance/trash/purge', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(purgeBody, request.body);
    return { purged: await purgeMaintenanceTrash(deps, { ...ref(request, workspaceId), recordIds: 'all' in body ? 'all' : body.recordIds }) };
  });

  app.get('/maintenance/:recordId', async (request) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    return { record: recordView(await getMaintenanceRecord(deps, { ...ref(request, workspaceId), recordId })) };
  });

  app.post('/maintenance/:recordId/update', { bodyLimit: BODY_LIMIT }, async (request) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    const { expectedRevision, ...fields } = parse(updateBody, request.body);
    return { record: recordView(await updateMaintenanceRecord(deps, { ...ref(request, workspaceId), recordId, expectedRevision, content: fields })) };
  });

  // The one way a status changes — from the board (drag or the status control), the List or the record. Always a person's request.
  app.post('/maintenance/:recordId/status', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    const body = parse(statusBody, request.body);
    return { record: recordView(await setMaintenanceStatus(deps, { ...ref(request, workspaceId), recordId, ...body })) };
  });

  app.post('/maintenance/:recordId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    await deleteMaintenanceRecord(deps, { ...ref(request, workspaceId), recordId });
    return reply.code(204).send();
  });

  app.post('/maintenance/:recordId/restore', { bodyLimit: 1024 }, async (request) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    return { record: recordView(await restoreMaintenanceRecord(deps, { ...ref(request, workspaceId), recordId })) };
  });

  // What a record is linked to: Documents (evidence), Procedures, Runs, Reminders. Titles and states only.
  app.get('/maintenance/:recordId/links', async (request) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    return { links: (await listMaintenanceLinks(deps, { ...ref(request, workspaceId), recordId })).map(linkView) };
  });

  app.post('/maintenance/:recordId/links', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, recordId } = parse(recordParams, request.params);
    const { target } = parse(linkBody, request.body);
    return reply.code(201).send({ link: linkView(await addMaintenanceLink(deps, { ...ref(request, workspaceId), recordId, target })) });
  });

  app.post('/maintenance-links/:linkId/delete', { bodyLimit: 1024 }, async (request, reply) => {
    const { workspaceId, linkId } = parse(linkParams, request.params);
    await removeMaintenanceLink(deps, { ...ref(request, workspaceId), linkId });
    return reply.code(204).send();
  });
}

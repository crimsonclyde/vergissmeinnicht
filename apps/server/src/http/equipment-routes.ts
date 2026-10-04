import { InvalidCursorError, addEquipmentLink, createEquipmentRecord, deleteEquipmentRecord, findEquipment, getEquipmentRecord, listEquipmentLinks, listEquipmentTrash, equipmentFilterValues, purgeEquipmentTrash, removeEquipmentLink, restoreEquipmentRecord, updateEquipmentRecord, type EquipmentRecord, type EquipmentSummary, type TrashedEquipmentRecord, } from '@vergissmeinnicht/application';
import { UUID_V4, type EquipmentCursor, type WorkspaceId } from '@vergissmeinnicht/domain';
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
    name: line, category: line.optional(), location: line.optional(), manufacturer: line.optional(), model: line.optional(), serialNumber: line.optional(), purchaseDate: date.nullable().optional(), warrantyExpiry: date.nullable().optional(), notes: z.string().max(20000).optional(),
};
const revision = z.number().int().min(1);
const createBody = z.strictObject(content);
const updateBody = z.strictObject({ ...content, expectedRevision: revision });
const listQuery = z.strictObject({ q: z.string().max(400).optional(), category: line.optional(), location: line.optional(), manufacturer: line.optional(), cursor: z.string().max(8192).regex(/^[A-Za-z0-9_-]+$/).optional() });
const noQuery = z.strictObject({});
const purgeBody = z.union([z.strictObject({ recordIds: z.array(uuid).min(1).max(1000) }), z.strictObject({ all: z.literal(true) })]);
const linkBody = z.strictObject({ target: z.strictObject({ type: z.string().max(32), id: uuid }) });
const BODY_LIMIT = 64 * 1024;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success)
        throw new InvalidRequestError();
    return parsed.data;
}
function principalOf(request: FastifyRequest): Principal {
    if (request.principal === null)
        throw new Error('requireUser did not run');
    return request.principal;
}
const ref = (request: FastifyRequest, workspaceId: string) => ({ actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
const summaryView = (record: EquipmentSummary) => ({ id: record.id, name: record.name, category: record.category, location: record.location, manufacturer: record.manufacturer, model: record.model, serialNumber: record.serialNumber, purchaseDate: record.purchaseDate, warrantyExpiry: record.warrantyExpiry, notes: record.notes, revision: record.revision });
const recordView = (record: EquipmentRecord) => ({ ...summaryView(record), createdAt: record.createdAt.toISOString(), createdBy: record.createdByName, modifiedAt: record.updatedAt.toISOString(), modifiedBy: record.updatedByName });
const trashView = (record: TrashedEquipmentRecord) => ({ id: record.id, name: record.name, deletedAt: record.deletedAt.toISOString(), deletedBy: record.deletedByName });
/** A cursor travels as base64url JSON: opaque to the client, and only a position — it carries no authority. */
const encodeCursor = (cursor: EquipmentCursor | null) => (cursor === null ? null : Buffer.from(JSON.stringify([cursor.value, cursor.id]), 'utf8').toString('base64url'));
function decodeCursor(text: string | undefined): unknown {
    if (text === undefined)
        return undefined;
    try {
        return JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as unknown;
    }
    catch {
        throw new InvalidCursorError();
    }
}
/** Equipment (16.8): session + tool + capability; Workspace-scoped ids, strict bodies and bounded paging.
 * Every member reads all metadata. USER and above manage; ADMIN permanently deletes from Trash.
 */
export async function equipmentRoutes(app: FastifyInstance, { services }: {
    services: AppServices;
}) {
    const deps = services.equipment;
    app.addHook('preHandler', requireUser(services));
    // Name-ordered list: q, category, location, manufacturer, cursor.
    app.get('/equipment', async (request) => {
        const { workspaceId } = parse(workspaceParams, request.params);
        const { cursor, ...rest } = parse(listQuery, request.query);
        const found = await findEquipment(deps, { ...ref(request, workspaceId), query: rest, cursor: decodeCursor(cursor) });
        return { records: found.records.map(summaryView), nextCursor: encodeCursor(found.next), total: found.total };
    });
    // Only filter values in live Equipment of this Workspace.
    app.get('/equipment/filters', async (request) => {
        const { workspaceId } = parse(workspaceParams, request.params);
        parse(noQuery, request.query);
        return { filters: await equipmentFilterValues(deps, ref(request, workspaceId)) };
    });
    app.post('/equipment', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
        const { workspaceId } = parse(workspaceParams, request.params);
        return reply.code(201).send({ record: recordView(await createEquipmentRecord(deps, { ...ref(request, workspaceId), content: parse(createBody, request.body) })) });
    });
    app.get('/equipment/trash', async (request) => {
        const { workspaceId } = parse(workspaceParams, request.params);
        parse(noQuery, request.query);
        return { records: (await listEquipmentTrash(deps, ref(request, workspaceId))).map(trashView) };
    });
    // Deletes records in Trash for good: Workspace admins only (`equipment.purge`).
    app.post('/equipment/trash/purge', { bodyLimit: BODY_LIMIT }, async (request) => {
        const { workspaceId } = parse(workspaceParams, request.params);
        const body = parse(purgeBody, request.body);
        return { purged: await purgeEquipmentTrash(deps, { ...ref(request, workspaceId), recordIds: 'all' in body ? 'all' : body.recordIds }) };
    });
    app.get('/equipment/:recordId', async (request) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        return { record: recordView(await getEquipmentRecord(deps, { ...ref(request, workspaceId), recordId })) };
    });
    app.post('/equipment/:recordId/update', { bodyLimit: BODY_LIMIT }, async (request) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        const { expectedRevision, ...fields } = parse(updateBody, request.body);
        return { record: recordView(await updateEquipmentRecord(deps, { ...ref(request, workspaceId), recordId, expectedRevision, content: fields })) };
    });
    app.post('/equipment/:recordId/delete', { bodyLimit: 1024 }, async (request, reply) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        await deleteEquipmentRecord(deps, { ...ref(request, workspaceId), recordId });
        return reply.code(204).send();
    });
    app.post('/equipment/:recordId/restore', { bodyLimit: 1024 }, async (request) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        return { record: recordView(await restoreEquipmentRecord(deps, { ...ref(request, workspaceId), recordId })) };
    });
    // Documents, Contacts, MaintenanceRecords, Procedures and Schedules.
    app.get('/equipment/:recordId/links', async (request) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        return { links: (await listEquipmentLinks(deps, { ...ref(request, workspaceId), recordId })).map(linkView) };
    });
    app.post('/equipment/:recordId/links', { bodyLimit: 1024 }, async (request, reply) => {
        const { workspaceId, recordId } = parse(recordParams, request.params);
        const { target } = parse(linkBody, request.body);
        return reply.code(201).send({ link: linkView(await addEquipmentLink(deps, { ...ref(request, workspaceId), recordId, target })) });
    });
    app.post('/equipment-links/:linkId/delete', { bodyLimit: 1024 }, async (request, reply) => {
        const { workspaceId, linkId } = parse(linkParams, request.params);
        await removeEquipmentLink(deps, { ...ref(request, workspaceId), linkId });
        return reply.code(204).send();
    });
}

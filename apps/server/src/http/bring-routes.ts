import { changeBring, getBring, listBring } from '@vergissmeinnicht/application';
import { BRING_STATUSES, parseBringContent, UUID_V4, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser } from './session.ts';
const uuid = z.string().regex(UUID_V4);
const revision = z.number().int().min(0).max(1_000_000_000);
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); if (!result.success) throw new InvalidRequestError(); return result.data; }
export async function bringRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
 app.addHook('preHandler', requireUser(services));
 const scope = (request: FastifyRequest) => {
  const params = parse(z.strictObject({ workspaceId: uuid, itemId: uuid.optional() }), request.params);
  if (request.principal === null) throw new Error('Missing principal');
  return { actor: request.principal.user, workspaceId: params.workspaceId as WorkspaceId, id: params.itemId };
 };
 app.get('/', async request => {
  const query = parse(z.strictObject({ status: z.enum(BRING_STATUSES).default('OPEN'), filter: z.enum(['ALL', 'MINE', 'SHARED']).default('ALL'), offset: z.coerce.number().int().min(0).max(1000).default(0), today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), request.query);
  if (query.today !== undefined && (!Number.isFinite(Date.parse(query.today)) || Math.abs(Date.parse(query.today) - services.bring.clock.now().getTime()) > 48 * 3600_000)) throw new InvalidRequestError();
  const { actor, workspaceId } = scope(request);
  const result = await listBring(services.bring, actor, workspaceId, query);
  // The Today card gets only its compact action projection, never notes or history metadata.
  return query.today === undefined ? result : { items: result.items.map(item => ({ id: item.id, title: item.title, from: item.from, to: item.to, dueDate: item.dueDate, assigneeId: item.assigneeId, assigneeName: item.assigneeName, status: item.status, revision: item.revision })), total: result.total, places: [] };
 });
 app.get('/:itemId', async request => { parse(z.strictObject({}), request.query); const { actor, workspaceId, id } = scope(request); return { item: await getBring(services.bring, actor, workspaceId, id ?? '') }; });
 for (const path of ['/', '/:itemId/update']) app.post(path, { bodyLimit: 16 * 1024 }, async (request, reply) => {
  parse(z.strictObject({}), request.query);
  const input = parse(z.strictObject({ content: z.unknown(), expectedRevision: revision }), request.body);
  const { actor, workspaceId, id } = scope(request);
  const item = await changeBring(services.bring, actor, workspaceId, id, input.expectedRevision, { kind: 'save', content: parseBringContent(input.content) });
  return reply.code(id === undefined ? 201 : 200).send({ item });
 });
 for (const action of ['status', 'delete', 'restore'] as const) app.post(`/:itemId/${action}`, { bodyLimit: 1024 }, async request => {
  parse(z.strictObject({}), request.query);
  const input = parse(z.strictObject({ expectedRevision: revision, ...(action === 'status' ? { status: z.enum(BRING_STATUSES) } : {}) }), request.body);
  const { actor, workspaceId, id } = scope(request);
  return { item: await changeBring(services.bring, actor, workspaceId, id, input.expectedRevision, action === 'status' ? { kind: action, status: parse(z.enum(BRING_STATUSES), input.status) } : { kind: action }) };
 });
}

import { createKnot, listKnots, resolveKnot, revokeKnot, type KnotListEntry } from '@vergissmeinnicht/application';
import { KNOT_TARGET_TYPES, UUID_V4, knotStatus, type Knot, type KnotId, type WorkspaceId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;
// Lower-case UUIDv4 only, like the domain parsers: one canonical spelling per id.
const uuid = z.string().regex(UUID_V4);
const workspaceParams = z.strictObject({ workspaceId: uuid });
const knotParams = z.strictObject({ workspaceId: uuid, knotId: uuid });
const createBody = z.strictObject({
  target: z.strictObject({ type: z.enum(KNOT_TARGET_TYPES), id: z.string().max(64) }),
  label: z.string().max(1024),
  expiresInDays: z.number().int().nullable(),
});
// Tokens travel in JSON bodies, never in API URLs (they would end up in logs).
const resolveBody = z.strictObject({ token: z.string().max(128) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Management view. Display names only; the token is never stored and never listed. */
function knotView(knot: Knot, target: { title: string; available: boolean } | undefined, now: Date) {
  return {
    id: knot.id,
    label: knot.label,
    target: { type: knot.target.type, id: knot.target.id, title: target?.title ?? null, available: target?.available ?? true },
    status: knotStatus(knot, now),
    createdAt: knot.createdAt.toISOString(),
    createdBy: knot.createdBy.displayName,
    expiresAt: knot.expiresAt?.toISOString() ?? null,
    revoked: knot.revoked === null ? null : { at: knot.revoked.at.toISOString(), by: knot.revoked.by.displayName },
  };
}

const entryView = (entry: KnotListEntry, now: Date) =>
  knotView(entry.knot, { title: entry.targetTitle, available: entry.targetAvailable }, now);

/** `POST /api/knots/resolve` — opens a Knot for the signed-in User (Step 7.1). */
export async function knotRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  app.addHook('preHandler', requireUser(services));

  app.post('/resolve', { bodyLimit: 1024, config: { rateLimit: { max: 30, timeWindow: MINUTE_MS } } }, async (request) => {
    const { token } = parse(resolveBody, request.body);
    const resolved = await resolveKnot(services.knots, { actor: principalOf(request).user, token });
    return { workspaceId: resolved.workspaceId, target: resolved.target };
  });
}

/**
 * Knot management of one Workspace (`/api/workspaces/{workspaceId}/knots`, `knot.manage`).
 * Authorization is enforced in the use-cases.
 */
export async function workspaceKnotRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.knots;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const entries = await listKnots(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId });
    const now = deps.clock.now();
    return { knots: entries.map((entry) => entryView(entry, now)) };
  });

  app.post('/', { bodyLimit: 4096, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE_MS } } }, async (request, reply) => {
    const { workspaceId } = parse(workspaceParams, request.params);
    const body = parse(createBody, request.body);
    const { knot, token } = await createKnot(deps, {
      actor: principalOf(request).user,
      workspaceId: workspaceId as WorkspaceId,
      target: body.target,
      label: body.label,
      expiresInDays: body.expiresInDays,
    });
    // The only time the token leaves the server; it is not stored.
    return reply.code(201).send({ knot: knotView(knot, undefined, deps.clock.now()), url: `${services.publicOrigin}/knot/${token}` });
  });

  app.post('/:knotId/revoke', async (request, reply) => {
    const { workspaceId, knotId } = parse(knotParams, request.params);
    await revokeKnot(deps, { actor: principalOf(request).user, workspaceId: workspaceId as WorkspaceId, knotId: knotId as KnotId });
    return reply.code(204).send();
  });
}

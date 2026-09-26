import {
  acceptInvitation,
  issueInvitation,
  listPendingInvitations,
  resolvePendingInvitation,
  revokeInvitation,
} from '@vergissmeinnicht/application';
import { normalizeEmail, type Invitation, type InvitationId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { requireUser, type Principal } from './session.ts';

const MINUTE_MS = 60_000;

// Tokens travel in JSON bodies, never in API URLs; format is checked by the token service.
const token = z.string().max(64);
const resolveBody = z.strictObject({ token });
const acceptBody = z.strictObject({ token, displayName: z.string().max(256), password: z.string().max(1024) });
const issueBody = z.strictObject({ email: z.string().max(320), grantsServerAdmin: z.boolean().default(false) });
const invitationParams = z.strictObject({ id: z.uuid({ version: 'v4' }) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidRequestError();
  return parsed.data;
}

function adminView(invitation: Invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    grantsServerAdmin: invitation.grantsServerAdmin,
    invitedBy: invitation.invitedBy ?? null,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

function principalOf(request: FastifyRequest): Principal {
  if (request.principal === null) throw new Error('requireUser did not run');
  return request.principal;
}

/** Public: used by the `/invite/{token}` page. Possession of the token is the only credential. */
export async function invitationRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.invitations;

  app.post(
    '/resolve',
    { bodyLimit: 1024, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE_MS } } },
    async (request) => {
      const invitation = await resolvePendingInvitation(deps, parse(resolveBody, request.body).token);
      return { email: invitation.email, expiresAt: invitation.expiresAt.toISOString() };
    },
  );

  app.post(
    '/accept',
    // Each accepted request costs one Argon2id hash; keep it scarce per client.
    { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: 15 * MINUTE_MS } } },
    async (request, reply) => {
      const body = parse(acceptBody, request.body);
      await acceptInvitation(deps, body);
      // No session is created here: the new user signs in with the chosen password.
      return reply.code(201).send({ status: 'accepted' });
    },
  );
}

/** Server-admin invitation management. Authorization is enforced inside each use-case. */
export async function adminInvitationRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const deps = services.invitations;
  app.addHook('preHandler', requireUser(services));

  app.get('/', async (request) => {
    const invitations = await listPendingInvitations(deps, { actor: principalOf(request).user });
    return { invitations: invitations.map(adminView) };
  });

  app.post(
    '/',
    { bodyLimit: 1024, config: { rateLimit: { max: 30, timeWindow: 15 * MINUTE_MS } } },
    async (request, reply) => {
      const body = parse(issueBody, request.body);
      const { invitation, delivery } = await issueInvitation(deps, {
        inviter: principalOf(request).user,
        email: normalizeEmail(body.email),
        grantsServerAdmin: body.grantsServerAdmin,
      });
      return reply.code(201).send({ invitation: adminView(invitation), delivery });
    },
  );

  app.post('/:id/revoke', async (request, reply) => {
    const { id } = parse(invitationParams, request.params);
    await revokeInvitation(deps, { actor: principalOf(request).user, invitationId: id as InvitationId });
    return reply.code(204).send();
  });
}

import { normalizeEmail, type NormalizedEmail, type UserId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import { authHeaders, authenticate, endSession, forwardCookies, publicUser } from './session.ts';

const signInBody = z.strictObject({
  email: z.string().max(320),
  // Generous bound; Better Auth rejects > 128 characters, which is answered like a wrong password.
  password: z.string().max(1024),
});

function normalizedOrUndefined(email: unknown): NormalizedEmail | undefined {
  if (typeof email !== 'string') return undefined;
  try {
    return normalizeEmail(email);
  } catch {
    return undefined;
  }
}

function isClientError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    error.statusCode < 500
  );
}

/** One response for every failed sign-in: unknown email, wrong password, disabled account, too long. */
function invalidCredentials(reply: FastifyReply) {
  return reply.code(401).send({ error: 'invalid_credentials' });
}

const MINUTE_MS = 60_000;

/** Sign-in, sign-out and session lookup. The only HTTP entry points into Better Auth. */
export async function authRoutes(app: FastifyInstance, { services }: { services: AppServices }) {
  const { auth } = services;

  // Per-account throttle against distributed guessing; per-IP throttle is the route config below.
  const accountLimiter = app.createRateLimit({
    max: 10,
    timeWindow: 15 * MINUTE_MS,
    keyGenerator: (request) => {
      const email = normalizedOrUndefined((request.body as { email?: unknown } | undefined)?.email);
      return `sign-in:email:${email ?? 'invalid'}`;
    },
  });

  app.post(
    '/sign-in',
    { bodyLimit: 4096, config: { rateLimit: { max: 10, timeWindow: MINUTE_MS } } },
    async (request, reply) => {
      const parsed = signInBody.safeParse(request.body);
      if (!parsed.success) throw new InvalidRequestError();
      const limit = await accountLimiter(request);
      if (!limit.isAllowed && limit.isExceeded) return reply.code(429).header('retry-after', limit.ttlInSeconds).send({ error: 'rate_limited' });

      const email = normalizedOrUndefined(parsed.data.email);
      if (email === undefined) return invalidCredentials(reply);

      const headers = authHeaders(request);
      const previous = request.headers.cookie === undefined ? null : await auth.api.getSession({ headers });

      let response: Response;
      try {
        // Only email and password are forwarded: no callbackURL (open redirect), rememberMe fixed.
        response = await auth.api.signInEmail({
          body: { email, password: parsed.data.password, rememberMe: true },
          headers,
          asResponse: true,
        });
      } catch (error) {
        if (!isClientError(error)) throw error;
        response = new Response(null, { status: 401 });
      }
      if (response.status >= 500) throw new Error('Sign-in failed');

      if (!response.ok) {
        const user = await services.users.findByEmail(email);
        if (user !== undefined) {
          services.securityEvents.record({
            type: 'LOGIN_FAILED',
            actor: { kind: 'system', label: 'anonymous' },
            subjectType: 'user',
            subjectId: user.id,
            occurredAt: new Date(),
            metadata: { accountStatus: user.status },
          });
        }
        request.log.info({ event: 'login_failed' }, 'sign-in rejected');
        return invalidCredentials(reply);
      }

      // Session rotation: a session that existed before this login never survives it.
      if (previous !== null) {
        await (await auth.$context).internalAdapter.deleteSession(previous.session.token);
      }
      forwardCookies(response.headers, reply);
      const body = (await response.json()) as { user: { id: string } };
      const user = await services.users.findById(body.user.id as UserId);
      if (user === undefined) throw new Error('Signed-in user not found');
      // The session token Better Auth returns in the body is deliberately not passed on.
      return { user: publicUser(user) };
    },
  );

  app.post('/sign-out', async (request, reply) => {
    const principal = await authenticate(services, request, reply);
    await endSession(services, request, reply);
    if (principal !== undefined) {
      services.securityEvents.record({
        type: 'LOGOUT',
        actor: { kind: 'user', userId: principal.user.id, displayName: principal.user.displayName },
        subjectType: 'user',
        subjectId: principal.user.id,
        occurredAt: new Date(),
        metadata: { sessionId: principal.sessionId },
      });
    }
    return reply.code(204).send();
  });

  app.get('/session', async (request, reply) => {
    const principal = await authenticate(services, request, reply);
    if (principal === undefined) return reply.code(401).send({ error: 'unauthenticated' });
    return { user: publicUser(principal.user) };
  });
}

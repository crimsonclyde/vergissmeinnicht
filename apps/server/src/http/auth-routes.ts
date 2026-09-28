import {
  MfaChallengeInvalidError,
  beginMfaChallenge,
  completeMfaChallenge,
  requiresSecondFactor,
  type SecondFactorMethod,
} from '@vergissmeinnicht/application';
import { MFA_CHALLENGE_TTL_MS, normalizeEmail, type NormalizedEmail, type User, type UserId } from '@vergissmeinnicht/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppServices } from '../composition.ts';
import { InvalidRequestError } from './errors.ts';
import {
  authHeaders,
  authenticate,
  clearChallengeCookie,
  endSession,
  forwardCookies,
  issueSession,
  publicUser,
  readChallengeCookie,
  setChallengeCookie,
} from './session.ts';

const mfaBody = z.union([
  z.strictObject({ code: z.string().max(32) }),
  z.strictObject({ recoveryCode: z.string().max(64) }),
]);

function recordLogin(services: AppServices, user: User, sessionId: string, method: 'password' | SecondFactorMethod) {
  services.securityEvents.record({
    type: 'LOGIN_SUCCEEDED',
    actor: { kind: 'user', userId: user.id, displayName: user.displayName },
    subjectType: 'user',
    subjectId: user.id,
    occurredAt: new Date(),
    metadata: { sessionId, method },
  });
}

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
    persist: 'sign-in-account',
    max: 10,
    timeWindow: 15 * MINUTE_MS,
    keyGenerator: (request) => {
      const email = normalizedOrUndefined((request.body as { email?: unknown } | undefined)?.email);
      return `sign-in:email:${email ?? 'invalid'}`;
    },
  });

  app.post(
    '/sign-in',
    { bodyLimit: 4096, config: { rateLimit: { persist: 'sign-in', max: 10, timeWindow: MINUTE_MS } } },
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

      const internal = (await auth.$context).internalAdapter;
      // Session rotation: a session that existed before this login never survives it.
      if (previous !== null) await internal.deleteSession(previous.session.token);
      // The session token Better Auth returns in the body is never passed on to the client.
      const body = (await response.json()) as { token: string; user: { id: string } };
      const user = await services.users.findById(body.user.id as UserId);
      if (user === undefined) throw new Error('Signed-in user not found');

      if (await requiresSecondFactor(services.mfa, user)) {
        // Password correct, TOTP outstanding: the session Better Auth just created is deleted
        // before its cookie ever leaves the server. The client only gets a challenge token that
        // is valid for POST /api/auth/mfa and nothing else.
        await internal.deleteSession(body.token);
        const token = await beginMfaChallenge(services.mfa, user);
        setChallengeCookie(services, reply, token, MFA_CHALLENGE_TTL_MS / 1000);
        return { mfaRequired: true };
      }

      const session = await internal.findSession(body.token);
      if (session === null) throw new Error('Session missing after sign-in');
      // Recorded before the cookie is sent: if this fails, the client never receives the session.
      recordLogin(services, user, session.session.id, 'password');
      forwardCookies(response.headers, reply);
      return { user: publicUser(user) };
    },
  );

  app.post(
    '/mfa',
    { bodyLimit: 1024, config: { rateLimit: { persist: 'mfa', max: 10, timeWindow: MINUTE_MS } } },
    async (request, reply) => {
      const parsed = mfaBody.safeParse(request.body);
      if (!parsed.success) throw new InvalidRequestError();
      const factor = 'code' in parsed.data ? { code: parsed.data.code } : { recoveryCode: parsed.data.recoveryCode };
      try {
        const { user, method } = await completeMfaChallenge(services.mfa, {
          token: readChallengeCookie(services, request) ?? '',
          factor,
        });
        clearChallengeCookie(services, reply);
        const sessionId = await issueSession(services, request, reply, user.id);
        recordLogin(services, user, sessionId, method);
        return { user: publicUser(user) };
      } catch (error) {
        if (error instanceof MfaChallengeInvalidError) clearChallengeCookie(services, reply);
        throw error;
      }
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

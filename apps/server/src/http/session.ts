import { CLIENT_IP_HEADER, SESSION_POLICY } from '@vergissmeinnicht/auth';
import { canAuthenticate, type User, type UserId } from '@vergissmeinnicht/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppServices } from '../composition.ts';

/** The authenticated caller of a request. Only ever derived server-side from the session cookie. */
export interface Principal {
  readonly user: User;
  readonly sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser`; `null` on routes that do not require authentication. */
    principal: Principal | null;
  }
}

const MAX_USER_AGENT_LENGTH = 512;

/**
 * Headers passed to Better Auth. Built from an allow-list: the client address comes from the
 * socket (Fastify `request.ip`), never from client-controlled forwarding headers.
 */
export function authHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  if (request.headers.cookie !== undefined) headers.set('cookie', request.headers.cookie);
  const userAgent = request.headers['user-agent'];
  if (userAgent !== undefined) headers.set('user-agent', userAgent.slice(0, MAX_USER_AGENT_LENGTH));
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

export function forwardCookies(from: Headers, reply: FastifyReply): void {
  const cookies = from.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}

export function publicUser(user: User) {
  return { id: user.id, email: user.email, displayName: user.displayName, serverAdmin: user.serverAdmin };
}

/** Deletes the server-side session named by the request cookie and clears the cookie. */
export async function endSession(services: AppServices, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const response = await services.auth.api.signOut({ headers: authHeaders(request), asResponse: true });
  forwardCookies(response.headers, reply);
}

/**
 * Resolves the session cookie to an ACTIVE User. Sessions of disabled or deleted Users and
 * sessions past the absolute lifetime are revoked on sight.
 *
 * Step 2.4 adds the TOTP gate here: a session of a TOTP-enabled account that has not passed the
 * challenge must not yield a Principal for normal routes.
 */
export async function authenticate(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Principal | undefined> {
  if (request.headers.cookie === undefined) return undefined;
  const { headers, response } = await services.auth.api.getSession({
    headers: authHeaders(request),
    returnHeaders: true,
  });
  forwardCookies(headers, reply);
  if (response === null) return undefined;

  const user = await services.users.findById(response.user.id as UserId);
  const ageMs = Date.now() - response.session.createdAt.getTime();
  if (user === undefined || !canAuthenticate(user) || ageMs >= SESSION_POLICY.absoluteSeconds * 1000) {
    await endSession(services, request, reply);
    return undefined;
  }
  return { user, sessionId: response.session.id };
}

export function requireUser(services: AppServices) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = await authenticate(services, request, reply);
    if (principal === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    request.principal = principal;
  };
}

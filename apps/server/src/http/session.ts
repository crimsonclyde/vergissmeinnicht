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

/**
 * Re-checks the session of a long-lived request (SSE) that was authenticated when it started:
 * the same session must still exist and be within its lifetimes, and its User must still be
 * ACTIVE. Returns the current User. Never refreshes the session, because the response headers of
 * a stream are already sent.
 */
export async function reauthenticate(services: AppServices, request: FastifyRequest, principal: Principal): Promise<User | undefined> {
  const response = await services.auth.api.getSession({ headers: authHeaders(request), query: { disableRefresh: true } });
  if (response === null || response.session.id !== principal.sessionId) return undefined;
  const user = await services.users.findById(response.user.id as UserId);
  const ageMs = Date.now() - response.session.createdAt.getTime();
  if (user === undefined || !canAuthenticate(user) || ageMs >= SESSION_POLICY.absoluteSeconds * 1000) return undefined;
  return user;
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

/** Creates a full session (cookie set by Better Auth) for a user whose authentication is complete. */
export async function issueSession(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<string> {
  const response = await services.auth.api.issueSession({
    body: { userId },
    headers: authHeaders(request),
    asResponse: true,
  });
  if (!response.ok) throw new Error('Session could not be issued');
  forwardCookies(response.headers, reply);
  return ((await response.json()) as { sessionId: string }).sessionId;
}

/**
 * After a security-sensitive account change (TOTP enabled/disabled): every existing session of
 * the user — possibly including one an attacker opened before the change — is revoked, and the
 * current client gets a fresh session.
 */
export async function replaceAllSessions(
  services: AppServices,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  await (await services.auth.$context).internalAdapter.deleteUserSessions(userId);
  await issueSession(services, request, reply, userId);
}

const CHALLENGE_COOKIE = 'vmn.mfa_challenge';
/** The challenge cookie is only ever sent to the endpoint that completes it. */
export const MFA_CHALLENGE_PATH = '/api/auth/mfa';

function challengeCookieName(services: AppServices): string {
  return services.secureCookies ? `__Secure-${CHALLENGE_COOKIE}` : CHALLENGE_COOKIE;
}

export function setChallengeCookie(services: AppServices, reply: FastifyReply, token: string, maxAgeSeconds: number) {
  const attributes = [`Path=${MFA_CHALLENGE_PATH}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Strict'];
  if (services.secureCookies) attributes.push('Secure');
  reply.header('set-cookie', [[`${challengeCookieName(services)}=${token}`, ...attributes].join('; ')]);
}

export function clearChallengeCookie(services: AppServices, reply: FastifyReply) {
  setChallengeCookie(services, reply, '', 0);
}

/** Raw cookie value or undefined; the token format is validated by the token service. */
export function readChallengeCookie(services: AppServices, request: FastifyRequest): string | undefined {
  const name = `${challengeCookieName(services)}=`;
  const entry = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name));
  return entry?.slice(name.length);
}

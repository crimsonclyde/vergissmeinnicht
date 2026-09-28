import type { FastifyReply, FastifyRequest } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for every state-changing request (docu/security.md §2): the `Origin` header
 * must be exactly the configured public origin. Browsers always send `Origin` on cross-origin and
 * same-origin POST/PUT/PATCH/DELETE requests, and page scripts cannot forge it. A request without
 * `Origin` is rejected rather than trusted. Together with `SameSite=Strict` session cookies and
 * JSON-only request bodies this replaces a synchronizer token.
 */
export function originGuard(publicOrigin: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.headers.origin !== publicOrigin) {
      return reply.code(403).send({ error: 'forbidden_origin' });
    }
  };
}

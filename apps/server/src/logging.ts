import type { FastifyRequest, FastifyServerOptions } from 'fastify';

/** URL path segments that carry bearer-like tokens. Extend when new token routes are added. */
const TOKEN_PATH_PATTERN = /^(\/(?:api\/)?knot\/)[^/?#]+/;

/**
 * Strips tokens from request paths and replaces any query string before a URL reaches the logs.
 * Tokens must never be sent in query strings, but a misbehaving client could still do so.
 */
export function redactUrl(url: string): string {
  const queryStart = url.search(/[?#]/);
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const redactedPath = path.replace(TOKEN_PATH_PATTERN, '$1[REDACTED]');
  return queryStart === -1 ? redactedPath : `${redactedPath}?[REDACTED]`;
}

export function loggerOptions(level: string): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: redactUrl(request.url),
        remoteAddress: request.ip,
      }),
    },
  };
}

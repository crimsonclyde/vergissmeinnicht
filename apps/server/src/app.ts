import { existsSync } from 'node:fs';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyServerOptions } from 'fastify';
import type { AppServices } from './composition.ts';
import { adminAccountRoutes } from './http/account-admin-routes.ts';
import { accountRoutes } from './http/account-routes.ts';
import { authRoutes } from './http/auth-routes.ts';
import { errorHandler } from './http/errors.ts';
import { adminInvitationRoutes, invitationRoutes } from './http/invitation-routes.ts';
import { knotRoutes, workspaceKnotRoutes } from './http/knot-routes.ts';
import { originGuard } from './http/origin-guard.ts';
import { procedureRoutes } from './http/procedure-routes.ts';
import { adminRecoveryRoutes, recoveryRoutes } from './http/recovery-routes.ts';
import { runRoutes } from './http/run-routes.ts';
import { workspaceRoutes } from './http/workspace-routes.ts';

export interface AppOptions {
  /** Built web assets (apps/web/dist). When absent, only the API is served (development). */
  webDistDir?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Application services. Without them only health and static assets are served (tests of the HTTP baseline). */
  services?: ((log: FastifyBaseLogger) => AppServices) | undefined;
  /** Reverse proxies (IPs/CIDRs, `loopback`) whose X-Forwarded-For is trusted; empty = none (default). */
  trustedProxies?: readonly string[] | undefined;
  /** Strict-Transport-Security max-age in seconds; 0 or undefined = no HSTS header. */
  hstsMaxAge?: number | undefined;
}

/** Browser features the app never uses; denied so injected content cannot use them either. */
const PERMISSIONS_POLICY = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'interest-cohort']
  .map((feature) => `${feature}=()`)
  .join(', ');

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    // Forwarding headers are believed only from explicitly configured proxies (TRUSTED_PROXIES, 10.3);
    // otherwise the socket address is the client address.
    trustProxy: options.trustedProxies !== undefined && options.trustedProxies.length > 0 ? [...options.trustedProxies] : false,
    // Slow clients cannot hold a connection open while sending a request (does not limit SSE responses).
    requestTimeout: 30_000,
    connectionTimeout: 60_000,
    // JSON bodies are small; routes that need more (e.g. imports) must raise this explicitly.
    bodyLimit: 64 * 1024,
  });
  // JSON is the only accepted request body type (no text/plain or form posts).
  app.removeContentTypeParser('text/plain');
  app.setErrorHandler(errorHandler);
  app.decorateRequest('principal', null);

  const services = options.services?.(app.log);
  if (services !== undefined) {
    app.addHook('onRequest', originGuard(services.publicOrigin));
  }

  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
    // IPv6 clients usually control a whole prefix; count it as one client.
    ipv6Subnet: 56,
    errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, error: 'rate_limited' }),
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Only the app's own stylesheet: no inline <style>/style="" and no remote styles or fonts.
        // (React `style` props use the CSSOM, which style-src does not restrict.)
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    // Only for https public origins (HSTS_MAX_AGE, default one year); no includeSubDomains/preload,
    // which would affect other services on the domain.
    strictTransportSecurity: options.hstsMaxAge !== undefined && options.hstsMaxAge > 0 ? { maxAge: options.hstsMaxAge, includeSubDomains: false } : false,
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY);
  });

  await app.register(
    async (api) => {
      api.addHook('onSend', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
      });
      api.get('/health', async () => ({ status: 'ok' }));
      if (services !== undefined) {
        // Readiness for container health checks: no details beyond a reason code.
        api.get('/health/ready', async (_request, reply) => {
          const readiness = services.readiness();
          return readiness.ready ? { status: 'ready' } : reply.code(503).send({ status: 'not_ready', reason: readiness.reason });
        });
        // Public: the license requires offering the source to everyone who uses the app over a network.
        api.get('/about', async () => ({ license: 'AGPL-3.0-only', sourceCodeUrl: services.sourceCodeUrl }));
        await api.register(authRoutes, { prefix: '/auth', services });
        await api.register(accountRoutes, { prefix: '/account', services });
        await api.register(invitationRoutes, { prefix: '/invitations', services });
        await api.register(adminInvitationRoutes, { prefix: '/admin/invitations', services });
        await api.register(recoveryRoutes, { prefix: '/recoveries', services });
        await api.register(adminRecoveryRoutes, { prefix: '/admin/recoveries', services });
        await api.register(adminAccountRoutes, { prefix: '/admin/accounts', services });
        await api.register(workspaceRoutes, { prefix: '/workspaces', services });
        await api.register(procedureRoutes, { prefix: '/workspaces/:workspaceId/procedures', services });
        await api.register(runRoutes, { prefix: '/workspaces/:workspaceId/runs', services });
        await api.register(workspaceKnotRoutes, { prefix: '/workspaces/:workspaceId/knots', services });
        await api.register(knotRoutes, { prefix: '/knots', services });
      }
    },
    { prefix: '/api' },
  );

  const webDistDir = options.webDistDir;
  const serveWeb = webDistDir !== undefined && existsSync(webDistDir);
  if (serveWeb) {
    await app.register(fastifyStatic, { root: webDistDir });
  }

  app.setNotFoundHandler(async (request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    if (serveWeb && !isApi && request.method === 'GET') {
      // Client-side routing fallback: unknown non-API paths render the SPA shell.
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  return app;
}

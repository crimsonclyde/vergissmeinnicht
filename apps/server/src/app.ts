import { existsSync } from 'node:fs';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyServerOptions } from 'fastify';
import type { AppServices } from './composition.ts';
import { accountRoutes } from './http/account-routes.ts';
import { authRoutes } from './http/auth-routes.ts';
import { errorHandler } from './http/errors.ts';
import { adminInvitationRoutes, invitationRoutes } from './http/invitation-routes.ts';
import { originGuard } from './http/origin-guard.ts';
import { adminRecoveryRoutes, recoveryRoutes } from './http/recovery-routes.ts';
import { workspaceRoutes } from './http/workspace-routes.ts';

export interface AppOptions {
  /** Built web assets (apps/web/dist). When absent, only the API is served (development). */
  webDistDir?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Application services. Without them only health and static assets are served (tests of the HTTP baseline). */
  services?: ((log: FastifyBaseLogger) => AppServices) | undefined;
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    // Forwarding headers are not trusted until the reverse-proxy setup is explicit (Step 10.3).
    trustProxy: false,
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
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS is enabled once HTTPS termination is configured (Step 10.3).
    strictTransportSecurity: false,
  });

  await app.register(
    async (api) => {
      api.addHook('onSend', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store');
      });
      api.get('/health', async () => ({ status: 'ok' }));
      if (services !== undefined) {
        await api.register(authRoutes, { prefix: '/auth', services });
        await api.register(accountRoutes, { prefix: '/account', services });
        await api.register(invitationRoutes, { prefix: '/invitations', services });
        await api.register(adminInvitationRoutes, { prefix: '/admin/invitations', services });
        await api.register(recoveryRoutes, { prefix: '/recoveries', services });
        await api.register(adminRecoveryRoutes, { prefix: '/admin/recoveries', services });
        await api.register(workspaceRoutes, { prefix: '/workspaces', services });
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

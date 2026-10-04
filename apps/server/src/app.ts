import { existsSync } from 'node:fs';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyServerOptions } from 'fastify';
import type { AppServices } from './composition.ts';
import { getInstanceSettings } from '@vergissmeinnicht/application';
import { adminAccountRoutes, adminSecurityEventRoutes, adminSettingsRoutes } from './http/account-admin-routes.ts';
import { accountRoutes } from './http/account-routes.ts';
import { authRoutes } from './http/auth-routes.ts';
import { errorHandler } from './http/errors.ts';
import { calendarRoutes, homeRoutes } from './http/home-routes.ts';
import { documentFileRoutes } from './http/document-file-routes.ts';
import { documentFolderRoutes, documentRoutes, documentTypeRoutes, workspaceToolRoutes } from './http/document-routes.ts';
import { imageRoutes } from './http/image-routes.ts';
import { adminStorageRoutes, workspaceStorageRoutes } from './http/storage-routes.ts';
import { linkRoutes } from './http/link-routes.ts';
import { contactRoutes } from './http/contact-routes.ts';
import { equipmentRoutes } from './http/equipment-routes.ts';
import { maintenanceRoutes } from './http/maintenance-routes.ts';
import { adminInvitationRoutes, invitationRoutes } from './http/invitation-routes.ts';
import { knotRoutes, workspaceKnotRoutes } from './http/knot-routes.ts';
import { listRoutes } from './http/list-routes.ts';
import { accountNotificationRoutes, adminNotificationRoutes } from './http/notification-routes.ts';
import { originGuard } from './http/origin-guard.ts';
import { procedureRoutes } from './http/procedure-routes.ts';
import { rateLimitStore } from './http/rate-limit-store.ts';
import { adminRecoveryRoutes, recoveryRoutes } from './http/recovery-routes.ts';
import { runRoutes } from './http/run-routes.ts';
import { occurrenceRoutes, scheduleRoutes } from './http/schedule-routes.ts';
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
  /** Global per-client limit on /api requests per minute (default 300). */
  apiRateLimitPerMinute?: number | undefined;
}

export interface RouteEntry {
  readonly method: string;
  readonly url: string;
}

/** Ordinary requests must have arrived completely within this time (slow clients cannot hold connections). */
const REQUEST_BODY_DEADLINE_MS = 30_000;
/** Routes that receive a large file (`config.slowBody`) get this long: 100 MB at about 1 Mbit/s. */
const SLOW_BODY_DEADLINE_MS = 15 * 60_000;

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route receives a large streamed body (a document upload): the short body deadline does not apply. */
    slowBody?: boolean;
  }
  interface FastifyRequest {
    bodyDeadline: NodeJS.Timeout | null;
  }
  interface FastifyInstance {
    /** Every registered route (method + URL pattern), in registration order. */
    readonly routeTable: readonly RouteEntry[];
  }
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
    // The hard limit for receiving any request — sized for document uploads (16.1). Every other route
    // keeps the 30-second deadline through the hook below; a connection idle for a minute is closed in
    // either case. Neither limits SSE responses.
    requestTimeout: SLOW_BODY_DEADLINE_MS,
    connectionTimeout: 60_000,
    // JSON bodies are small; routes that need more (e.g. imports) must raise this explicitly.
    bodyLimit: 64 * 1024,
  });
  // JSON is the only accepted request body type (no text/plain or form posts).
  app.removeContentTypeParser('text/plain');
  app.setErrorHandler(errorHandler);
  app.decorateRequest('principal', null);
  // Slow clients cannot hold a connection open while sending a request: unless the route expects a
  // large upload, the whole request must have arrived (been parsed) within 30 seconds.
  app.decorateRequest('bodyDeadline', null);
  const clearBodyDeadline = async (request: { bodyDeadline: NodeJS.Timeout | null }) => {
    if (request.bodyDeadline !== null) clearTimeout(request.bodyDeadline);
    request.bodyDeadline = null;
  };
  app.addHook('onRequest', async (request) => {
    if (request.routeOptions.config.slowBody === true) return;
    request.bodyDeadline = setTimeout(() => request.raw.destroy(), REQUEST_BODY_DEADLINE_MS);
    request.bodyDeadline.unref();
  });
  app.addHook('preValidation', clearBodyDeadline);
  app.addHook('onResponse', clearBodyDeadline);
  app.addHook('onRequestAbort', clearBodyDeadline);
  // Every registered route, so tests can prove authentication and Workspace isolation for all of
  // them — including routes added later — instead of a hand-maintained list (13.2).
  const routeTable: RouteEntry[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) if (method !== 'HEAD') routeTable.push({ method, url: route.url });
  });
  app.decorate('routeTable', routeTable as readonly RouteEntry[]);

  const services = options.services?.(app.log);
  if (services !== undefined) {
    app.addHook('onRequest', originGuard(services.publicOrigin));
    app.addHook('onClose', () => services.closeDocumentFiles());
  }

  await app.register(fastifyRateLimit, {
    global: true,
    max: options.apiRateLimitPerMinute ?? 300,
    timeWindow: 60_000,
    // IPv6 clients usually control a whole prefix; count it as one client.
    ipv6Subnet: 56,
    // The limits protect the API. The web app's static files (page shell, hashed assets, icon, service
    // worker) never touch the database; counting them made every page load cost several requests.
    allowList: (request) => request.url !== '/api' && !request.url.startsWith('/api/'),
    errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, error: 'rate_limited' }),
    // Limits marked `persist` (sign-in, MFA, recovery, invitations, account security) live in the database.
    store: rateLimitStore(services?.rateLimits),
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
        // Instruction photos kept on the device for offline Runs are shown from blob: URLs (14.3).
        imgSrc: ["'self'", 'data:', 'blob:'],
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
        api.get('/about', async () => ({
          license: 'AGPL-3.0-only',
          sourceCodeUrl: services.sourceCodeUrl,
          footerHidden: (await getInstanceSettings(services.instanceSettings)).footerHidden,
        }));
        await api.register(authRoutes, { prefix: '/auth', services });
        await api.register(accountRoutes, { prefix: '/account', services });
        await api.register(accountNotificationRoutes, { prefix: '/account/notifications', services });
        await api.register(invitationRoutes, { prefix: '/invitations', services });
        await api.register(adminInvitationRoutes, { prefix: '/admin/invitations', services });
        await api.register(recoveryRoutes, { prefix: '/recoveries', services });
        await api.register(adminRecoveryRoutes, { prefix: '/admin/recoveries', services });
        await api.register(adminAccountRoutes, { prefix: '/admin/accounts', services });
        await api.register(adminSecurityEventRoutes, { prefix: '/admin/security-events', services });
        await api.register(adminSettingsRoutes, { prefix: '/admin/settings', services });
        await api.register(adminNotificationRoutes, { prefix: '/admin/notifications', services });
        await api.register(adminStorageRoutes, { prefix: '/admin/storage', services });
        await api.register(workspaceRoutes, { prefix: '/workspaces', services });
        await api.register(procedureRoutes, { prefix: '/workspaces/:workspaceId/procedures', services });
        await api.register(runRoutes, { prefix: '/workspaces/:workspaceId/runs', services });
        await api.register(scheduleRoutes, { prefix: '/workspaces/:workspaceId/schedules', services });
        await api.register(occurrenceRoutes, { prefix: '/workspaces/:workspaceId/occurrences', services });
        await api.register(homeRoutes, { prefix: '/workspaces/:workspaceId/home', services });
        await api.register(calendarRoutes, { prefix: '/workspaces/:workspaceId/calendar', services });
        await api.register(imageRoutes, { prefix: '/workspaces/:workspaceId/images', services });
        await api.register(workspaceStorageRoutes, { prefix: '/workspaces/:workspaceId/storage', services });
        await api.register(linkRoutes, { prefix: '/workspaces/:workspaceId', services });
        await api.register(contactRoutes, { prefix: '/workspaces/:workspaceId', services });
        await api.register(equipmentRoutes, { prefix: '/workspaces/:workspaceId', services });
        await api.register(maintenanceRoutes, { prefix: '/workspaces/:workspaceId', services });
        await api.register(workspaceToolRoutes, { prefix: '/workspaces/:workspaceId/tools', services });
        await api.register(documentFileRoutes, { prefix: '/workspaces/:workspaceId/document-files', services });
        await api.register(documentFolderRoutes, { prefix: '/workspaces/:workspaceId/document-folders', services });
        await api.register(documentRoutes, { prefix: '/workspaces/:workspaceId/documents', services });
        await api.register(documentTypeRoutes, { prefix: '/workspaces/:workspaceId/document-types', services });
        await api.register(workspaceKnotRoutes, { prefix: '/workspaces/:workspaceId/knots', services });
        await api.register(listRoutes, { prefix: '/workspaces/:workspaceId/lists', services });
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

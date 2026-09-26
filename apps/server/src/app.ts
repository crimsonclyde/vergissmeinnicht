import { existsSync } from 'node:fs';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  /** Built web assets (apps/web/dist). When absent, only the API is served (development). */
  webDistDir?: string | undefined;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    // Forwarding headers are not trusted until the reverse-proxy setup is explicit (Step 10.3).
    trustProxy: false,
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

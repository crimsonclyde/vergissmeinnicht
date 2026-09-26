import { resolve } from 'node:path';
import { buildApp } from './app.ts';

// Full validated configuration handling follows in Step 1.2.
const production = process.env.NODE_ENV === 'production';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);

const app = await buildApp({
  webDistDir: production ? resolve(import.meta.dirname, '../../web/dist') : undefined,
  logger: {
    level: production ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host, port });

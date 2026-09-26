import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { ConfigError, loadConfig } from './config/index.ts';
import { loggerOptions } from './logging.ts';

function readConfig() {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      // Fail closed. The message names invalid variables but never contains their values.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();

const app = await buildApp({
  webDistDir: config.mode === 'production' ? resolve(import.meta.dirname, '../../web/dist') : undefined,
  logger: loggerOptions(config.logLevel),
});

if (config.authSecretEphemeral) {
  app.log.warn(`AUTH_SECRET not set: using a per-process secret (${config.mode} only); sessions will not survive restarts`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });

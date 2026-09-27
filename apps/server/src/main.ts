import { resolve } from 'node:path';
import { openDatabase } from '@vergissmeinnicht/database';
import { buildApp } from './app.ts';
import { createServices } from './composition.ts';
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
// Schema migrations are applied separately (`pnpm db:migrate`); see docu/deployment.md.
const database = openDatabase(config.databasePath);

const app = await buildApp({
  webDistDir: config.mode === 'production' ? resolve(import.meta.dirname, '../../web/dist') : undefined,
  logger: loggerOptions(config.logLevel),
  services: createServices(config, database),
  trustedProxies: config.trustedProxies,
  hstsMaxAge: config.hstsMaxAge,
});
app.addHook('onClose', async () => database.close());

if (config.authSecretEphemeral) {
  app.log.warn(`AUTH_SECRET not set: using a per-process secret (${config.mode} only); sessions will not survive restarts`);
}
if (config.dataEncryptionKeyEphemeral) {
  app.log.warn(
    `DATA_ENCRYPTION_KEY not set: using a per-process key (${config.mode} only); enrolled TOTP authenticators stop working after a restart`,
  );
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });

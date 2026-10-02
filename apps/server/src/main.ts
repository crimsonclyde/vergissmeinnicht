import { resolve } from 'node:path';
import { purgeUnusedDocumentFiles, purgeUnusedImages } from '@vergissmeinnicht/application';
import { openDatabase } from '@vergissmeinnicht/database';
import { buildApp } from './app.ts';
import { createServices } from './composition.ts';
import { ConfigError, loadConfig } from './config/index.ts';
import { scheduleBackups } from './backup-schedule.ts';
import { scheduleHousekeeping } from './housekeeping.ts';
import { scheduleReminders } from './reminder-schedule.ts';
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

const services = createServices(config, database);
let built: ReturnType<typeof services> | undefined;
const app = await buildApp({
  webDistDir: config.mode === 'production' ? resolve(import.meta.dirname, '../../web/dist') : undefined,
  logger: loggerOptions(config.logLevel),
  services: (log) => (built = services(log)),
  trustedProxies: config.trustedProxies,
  hstsMaxAge: config.hstsMaxAge,
  apiRateLimitPerMinute: config.apiRateLimitPerMinute,
});
// Expired sessions, challenges, links and rate-limit windows are deleted hourly (Step 2.8), and so are
// instruction images nothing uses any more (14.3) and document files nothing uses (16.1); previews a
// restart interrupted are taken up again.
const images = built?.images;
const documentFiles = built?.documentFiles;
const stopHousekeeping = scheduleHousekeeping(
  database,
  app.log,
  undefined,
  images === undefined ? undefined : () => purgeUnusedImages(images),
  documentFiles === undefined ? undefined : { purge: () => purgeUnusedDocumentFiles(documentFiles), resumePreviews: () => documentFiles.previews.resume() },
);
// Optional automatic backups (BACKUP_INTERVAL_HOURS, BACKUP_KEEP; Step 10.5).
const stopBackups = scheduleBackups(config.databasePath, app.log, config.backup);
// Reminders of scheduled Procedures and Telegram pairing (13.5, 13.7), within this process.
const stopReminders = built === undefined ? () => undefined : scheduleReminders(built, app.log);
app.addHook('onClose', async () => {
  stopHousekeeping();
  stopBackups();
  stopReminders();
  database.close();
});

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

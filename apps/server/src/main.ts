import { resolve } from 'node:path';
import { TEXT_POLL_MS, purgeUnusedDocumentFiles, purgeUnusedImages } from '@vergissmeinnicht/application';
import { migrationStatus, openDatabase } from '@vergissmeinnicht/database';
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
// Schema migrations are applied separately (`pnpm db:migrate`); see docs/admin/deployment.md.
const database = openDatabase(config.databasePath);

// A database migrated by a newer version is never worked on (no services, jobs, scheduling or writes): the server
// only answers health checks with `database_newer` until it runs with that version again. Nothing is changed.
let databaseNewer = false;
try {
  databaseNewer = migrationStatus(database.sqlite).newer;
} catch {
  // An unreadable database is reported by the readiness check as before.
}

const services = createServices(config, database);
let built: ReturnType<typeof services> | undefined;
const app = await buildApp({
  webDistDir: config.mode === 'production' ? resolve(import.meta.dirname, '../../web/dist') : undefined,
  logger: loggerOptions(config.logLevel),
  services: databaseNewer ? undefined : (log) => (built = services(log)),
  unavailable: databaseNewer ? { reason: 'database_newer' } : undefined,
  trustedProxies: config.trustedProxies,
  hstsMaxAge: config.hstsMaxAge,
  apiRateLimitPerMinute: config.apiRateLimitPerMinute,
});
// Expired sessions, challenges, links and rate-limit windows are deleted hourly (Step 2.8), and so are
// instruction images nothing uses any more (14.3) and document files nothing uses (16.1); previews a
// restart interrupted are taken up again.
const images = built?.images;
const documentFiles = built?.documentFiles;
const stopHousekeeping = databaseNewer
  ? () => undefined
  : scheduleHousekeeping(
      database,
      app.log,
      undefined,
      images === undefined ? undefined : () => purgeUnusedImages(images),
      documentFiles === undefined ? undefined : { purge: () => purgeUnusedDocumentFiles(documentFiles), resumePreviews: () => documentFiles.previews.resume() },
    );
// Optional automatic backups (BACKUP_INTERVAL_HOURS, BACKUP_KEEP; Step 10.5).
const stopBackups = databaseNewer ? () => undefined : scheduleBackups(config.databasePath, app.log, config.backup);
// Text recognition (16.9) wakes on uploads; this also picks up retries that became due and work a
// restart interrupted.
const recognizer = built?.recognizer;
recognizer?.wake();
const recognitionTimer = recognizer === undefined ? undefined : setInterval(() => recognizer.wake(), TEXT_POLL_MS);
recognitionTimer?.unref();
// Workspace backups (section 18): queued jobs run in the background; on start, jobs a stop interrupted are
// marked failed and their files removed; every minute expired packages are deleted.
const backupRunner = built?.backupRunner;
void backupRunner?.wake();
const backupTimer = backupRunner === undefined ? undefined : setInterval(() => void backupRunner.wake(), 60_000);
backupTimer?.unref();
// Reminders of scheduled Procedures and Telegram pairing (13.5, 13.7), within this process.
const stopReminders = built === undefined ? () => undefined : scheduleReminders(built, app.log);
app.addHook('onClose', async () => {
  stopHousekeeping();
  stopBackups();
  stopReminders();
  clearInterval(recognitionTimer);
  clearInterval(backupTimer);
  database.close();
});

if (databaseNewer) {
  app.log.error(
    'The database was migrated by a newer VergissMeinNicht version than this one. Nothing is started and nothing is changed; run that version (or newer) again — see docs/admin/deployment.md, "Database is newer".',
  );
}
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

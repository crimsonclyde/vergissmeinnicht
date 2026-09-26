// One-time creation of the first server admin.
//
//   NODE_ENV=production node apps/server/src/cli/admin-bootstrap.ts --email admin@example.org
//
// Prints a single-use invitation link to this terminal (it is NOT emailed or logged).
// Refuses to run once any server admin exists.
import { parseArgs } from 'node:util';
import { BootstrapNotAllowedError, bootstrapServerAdmin } from '@vergissmeinnicht/application';
import { openDatabase } from '@vergissmeinnicht/database';
import { DomainValidationError, normalizeEmail } from '@vergissmeinnicht/domain';
import { invitationDeps } from '../composition.ts';
import { ConfigError, loadConfig } from '../config/index.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE = 'Usage: admin-bootstrap --email <address>';

let values;
try {
  ({ values } = parseArgs({ options: { email: { type: 'string' } }, strict: true }));
} catch {
  fail(USAGE);
}
if (values.email === undefined) fail(USAGE);

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}

let email;
try {
  email = normalizeEmail(values.email);
} catch (error) {
  if (error instanceof DomainValidationError) fail('Invalid email address.');
  throw error;
}

const database = openDatabase(config.databasePath);
try {
  const { invitation, acceptUrl } = await bootstrapServerAdmin(invitationDeps(config, database), { email });
  process.stdout.write(
    [
      `Server-admin invitation created for ${invitation.email}.`,
      `Open this link to set the password (single use, expires ${invitation.expiresAt.toISOString()}):`,
      ``,
      `  ${acceptUrl}`,
      ``,
      `Treat this link like a password. Running this command again replaces it.`,
      ``,
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof BootstrapNotAllowedError) fail(error.message);
  throw error;
} finally {
  database.close();
}

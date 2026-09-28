// Operator account recovery, for when no server admin can act (e.g. the only admin lost their
// authenticator and recovery codes).
//
//   NODE_ENV=production node apps/server/src/cli/admin-recover.ts --email admin@example.org --totp
//
// --password  reset the password
// --totp      remove two-factor authentication (the user confirms with the current password)
//
// Prints a single-use link (valid 60 minutes) to this terminal; it is NOT emailed or logged.
import { parseArgs } from 'node:util';
import {
  AccountNotActiveError,
  NothingToRecoverError,
  UnknownAccountError,
  issueOperatorRecovery,
} from '@vergissmeinnicht/application';
import { openDatabase } from '@vergissmeinnicht/database';
import { DomainValidationError } from '@vergissmeinnicht/domain';
import { createServices } from '../composition.ts';
import { ConfigError, loadConfig } from '../config/index.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const USAGE = 'Usage: admin-recover --email <address> [--password] [--totp]   (at least one of --password/--totp)';

let values;
try {
  ({ values } = parseArgs({
    options: { email: { type: 'string' }, password: { type: 'boolean' }, totp: { type: 'boolean' } },
    strict: true,
  }));
} catch {
  fail(USAGE);
}
if (values.email === undefined || (values.password !== true && values.totp !== true)) fail(USAGE);

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) fail(error.message);
  throw error;
}

const database = openDatabase(config.databasePath);
try {
  const { recovery } = createServices(config, database)();
  const { recovery: issued, url } = await issueOperatorRecovery(recovery, {
    email: values.email,
    scope: { resetPassword: values.password === true, resetTotp: values.totp === true },
  });
  const scope = [issued.resetPassword && 'password reset', issued.resetTotp && 'two-factor reset'].filter(Boolean).join(' + ');
  process.stdout.write(
    [
      `Account recovery (${scope}) created.`,
      `Give this link only to the account owner (single use, expires ${issued.expiresAt.toISOString()}):`,
      ``,
      `  ${url}`,
      ``,
      `All sessions of the account end when it is used. Running this command again replaces the link.`,
      ``,
    ].join('\n'),
  );
} catch (error) {
  if (error instanceof DomainValidationError) fail('Invalid email address. Type it by hand: it must not contain spaces, invisible or unreadable characters (e.g. from copy and paste).');
  if (error instanceof UnknownAccountError || error instanceof AccountNotActiveError || error instanceof NothingToRecoverError) {
    fail(error.message);
  }
  throw error;
} finally {
  database.close();
}

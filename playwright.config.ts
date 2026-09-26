import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 3100;

// Throwaway production-mode configuration. Stored in process.env so Playwright workers (which
// inherit the runner's environment and re-evaluate this file) see the same values.
const databasePath = (process.env.VMN_E2E_DATABASE_PATH ??= join(tmpdir(), `vergissmeinnicht-e2e-${process.pid}.sqlite`));
const authSecret = (process.env.VMN_E2E_AUTH_SECRET ??= randomBytes(32).toString('base64url'));
const dataKey = (process.env.VMN_E2E_DATA_ENCRYPTION_KEY ??= randomBytes(32).toString('base64url'));

/** Environment of the e2e server; tests use it to run the admin bootstrap CLI against the same DB. */
export const serverEnv = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: String(port),
  PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  DATABASE_PATH: databasePath,
  AUTH_SECRET: authSecret,
  DATA_ENCRYPTION_KEY: dataKey,
  SMTP_HOST: '127.0.0.1',
  SMTP_SECURITY: 'none',
  MAIL_FROM_ADDRESS: 'noreply@vergissmeinnicht.test',
};

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // Started without a pnpm wrapper (`exec`) so Playwright's teardown stops the server process
    // itself. `pnpm test:e2e` builds the web assets first.
    command: 'node packages/database/src/migrate.ts && exec node apps/server/src/main.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    // Production mode requires explicit configuration; use throwaway values for the test run.
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

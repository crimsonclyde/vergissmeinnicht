import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 3100;

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
    // Started without a pnpm wrapper so Playwright's teardown stops the server process itself.
    // `pnpm test:e2e` builds the web assets first.
    command: 'node apps/server/src/main.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    // Production mode requires explicit configuration; use throwaway values for the test run.
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      DATABASE_PATH: join(tmpdir(), `vergissmeinnicht-e2e-${process.pid}.sqlite`),
      AUTH_SECRET: randomBytes(32).toString('base64url'),
      SMTP_HOST: '127.0.0.1',
      SMTP_SECURITY: 'none',
      MAIL_FROM_ADDRESS: 'noreply@vergissmeinnicht.test',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

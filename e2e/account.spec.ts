import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { serverEnv } from '../playwright.config.ts';

const PASSWORD = 'an e2e passphrase that is long';

test('first server admin: CLI bootstrap link, account creation, sign-in and sign-out', async ({ page }, testInfo) => {
  // Bootstrap works exactly once per server; the flow runs on one project only.
  test.skip(testInfo.project.name !== 'desktop-chromium', 'bootstrap is single-use per server');

  const output = execFileSync(
    process.execPath,
    ['apps/server/src/cli/admin-bootstrap.ts', '--email', 'Admin@Example.org'],
    { env: { ...process.env, ...serverEnv }, encoding: 'utf8' },
  );
  const link = /http:\/\/127\.0\.0\.1:\d+(\/invite\/[A-Za-z0-9_-]{43})/.exec(output)?.[1];
  expect(link).toBeDefined();

  await page.goto(link ?? '/');
  await expect(page.getByText('admin@example.org')).toBeVisible();
  await page.getByLabel('Display name').fill('Ada Admin');
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByLabel('Repeat password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  // The link is single-use.
  await page.goto(link ?? '/');
  await expect(page.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible();

  await page.goto('/');
  await page.getByLabel('Email').fill('admin@example.org');
  await page.getByLabel('Password').fill('not the right passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is not correct.');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith('vmn.session_token'));
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

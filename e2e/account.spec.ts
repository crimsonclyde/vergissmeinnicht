import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';
import { serverEnv } from '../playwright.config.ts';

const PASSWORD = 'an e2e passphrase that is long';

test('first server admin: bootstrap link, account creation, sign-in, Workspace creation, TOTP enrollment, TOTP sign-in and operator TOTP recovery', async ({ page }, testInfo) => {
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

  // Workspaces: a server admin creates one and becomes its only admin.
  await expect(page.getByText('You are not a member of any Workspace yet.')).toBeVisible();
  await page.getByLabel('New Workspace name').fill('Household');
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Household' })).toBeVisible();
  await expect(page.getByText('Your role: Admin')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Your Workspaces' }).getByRole('listitem')).toHaveCount(1);
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row')).toHaveCount(2);
  await expect(members.getByRole('cell', { name: 'admin@example.org' })).toBeVisible();
  await page.getByLabel('Member email').fill('nobody@example.org');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/no active account/);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Leave Workspace' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at least one active admin' })).toBeVisible();
  await expect(page.getByText('Your role: Admin')).toBeVisible();

  // Enable TOTP: password, QR code + key, confirmation code, recovery codes.
  await page.getByRole('button', { name: 'Enable two-factor authentication' }).click();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  const key = ((await page.locator('code').first().textContent()) ?? '').replaceAll(' ', '');
  const totp = new TOTP({ secret: key });
  await page.getByLabel('Code from your authenticator app').fill(totp.generate());
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
  await page.getByRole('button', { name: 'I have saved my recovery codes' }).click();
  await expect(page.getByText('Status: Enabled')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // Sign-in now needs the second factor; the enrollment code's time step is used up, so use the next one.
  await page.getByLabel('Email').fill('admin@example.org');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  const cookiesBeforeCode = await page.context().cookies();
  expect(cookiesBeforeCode.some((cookie) => cookie.name.endsWith('vmn.session_token'))).toBe(false);
  await page.getByLabel('Code from your authenticator app').fill(totp.generate({ timestamp: Date.now() + 30_000 }));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  // Lost authenticator, only admin: operator recovery via CLI, completed with the current password.
  const recoverOutput = execFileSync(
    process.execPath,
    ['apps/server/src/cli/admin-recover.ts', '--email', 'admin@example.org', '--totp'],
    { env: { ...process.env, ...serverEnv }, encoding: 'utf8' },
  );
  const recoverLink = /http:\/\/127\.0\.0\.1:\d+(\/recover\/[A-Za-z0-9_-]{43})/.exec(recoverOutput)?.[1];
  expect(recoverLink).toBeDefined();
  await page.goto(recoverLink ?? '/');
  await expect(page.getByRole('heading', { name: 'Recover your account' })).toBeVisible();
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Recover account' }).click();
  await expect(page.getByRole('heading', { name: 'Account recovered' })).toBeVisible();

  await page.goto('/');
  await page.getByLabel('Email').fill('admin@example.org');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();
  await expect(page.getByText('Status: Not enabled')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

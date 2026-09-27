import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';
import { serverEnv } from '../playwright.config.ts';

const PASSWORD = 'an e2e passphrase that is long';

test('first server admin: bootstrap link, account creation, sign-in, Workspace creation, Procedure authoring with Sections and Steps, export/import/duplicate/restore, TOTP enrollment, TOTP sign-in and operator TOTP recovery', async ({ page }, testInfo) => {
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

  // Procedures: create with a Section and Steps, view, edit/reorder, delete.
  await page.getByRole('button', { name: 'New Procedure' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Leave the house');
  await page.getByLabel('Description', { exact: true }).fill('Windows closed?\n<b>Stove off</b>');
  await page.getByLabel('Icon', { exact: true }).selectOption('travel');
  await page.getByLabel('Tags (comma-separated)').fill('daily, Daily, safety');
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByLabel('Section 1 title').fill('Ground floor');
  await page.getByRole('button', { name: 'Add step to section 1' }).click();
  await page.getByLabel('Step 1.1 title').fill('Close windows');
  await page.getByRole('button', { name: 'Add step to section 1' }).click();
  await page.getByLabel('Step 1.2 title').fill('Turn off stove');
  await page.getByRole('group', { name: 'Step 1.2' }).getByLabel(/Critical/).check();
  await page.getByRole('group', { name: 'Step 1.2' }).getByLabel('When skipped:').selectOption('REQUIRED');
  await page.getByRole('button', { name: 'Create Procedure' }).click();

  const procedure = page.getByRole('article');
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the house' })).toBeVisible();
  await expect(procedure.getByText('<b>Stove off</b>')).toBeVisible();
  await expect(procedure.getByText('Tags: daily, safety')).toBeVisible();
  const steps = procedure.getByRole('region', { name: 'Section: Ground floor' }).getByRole('listitem');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toContainText('Turn off stove — Required, Critical');
  await expect(steps.nth(1)).toContainText('Skip: reason required');

  // Edit: rename, move the stove Step to the top, save once.
  await procedure.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Leave the flat');
  await page.getByRole('button', { name: 'Move step 1.2 up' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat' })).toBeVisible();
  await expect(steps.nth(0)).toContainText('Turn off stove');
  await expect(steps.nth(1)).toContainText('Close windows');

  // Drag and drop: a new Section, then drag "Close windows" (step 1.2) into it; one save.
  await procedure.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByLabel('Section 2 title').fill('Upstairs');
  await page.getByTitle('Drag step 1.2').hover();
  await page.mouse.down();
  await page.mouse.move(10, 10);
  const dropZone = page.getByText('Drop here to move the step to the end of section 2');
  await dropZone.hover();
  await dropZone.hover({ position: { x: 20, y: 10 } });
  await page.mouse.up();
  await expect(page.getByLabel('Step 2.1 title')).toHaveValue('Close windows');
  await expect(page.getByLabel('Step 1.2 title')).toHaveCount(0);
  // Keyboard alternative: move it back to section 1 with the select.
  await page.getByLabel('Move step 2.1 to section').selectOption({ label: '1. Ground floor' });
  await expect(page.getByLabel('Step 1.2 title')).toHaveValue('Close windows');
  // And drag it into Upstairs once more before saving.
  await page.getByTitle('Drag step 1.2').hover();
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await dropZone.hover();
  await dropZone.hover({ position: { x: 20, y: 10 } });
  await page.mouse.up();
  // Drag Section 2 onto Section 1: Upstairs comes first.
  await page.getByTitle('Drag section 2').hover();
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await page.getByTitle('Drag section 1').hover();
  await page.getByTitle('Drag section 1').hover({ position: { x: 2, y: 2 } });
  await page.mouse.up();
  await expect(page.getByLabel('Section 1 title')).toHaveValue('Upstairs');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(procedure.getByRole('heading', { level: 6 })).toHaveText(['Upstairs', 'Ground floor']);
  await expect(procedure.getByRole('region', { name: 'Section: Upstairs' }).getByRole('listitem')).toHaveText([/Close windows/]);
  await expect(steps).toHaveCount(1);

  // Export as a JSON file, duplicate, delete the copy, re-import the exported file.
  const downloadPromise = page.waitForEvent('download');
  await procedure.getByRole('button', { name: 'Export as JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('leave-the-flat.vmn.json');
  const exportPath = testInfo.outputPath('export.json');
  await download.saveAs(exportPath);

  await procedure.getByRole('button', { name: 'Duplicate' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat (copy)' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await procedure.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(1);
  // Restore the deleted copy, then delete it again.
  await page.getByRole('button', { name: 'Show deleted Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Deleted Procedures' })).toContainText('Leave the flat (copy) — deleted by Ada Admin');
  await page.getByRole('button', { name: 'Restore Leave the flat (copy)' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat (copy)' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await procedure.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(1);

  await page.getByLabel('Import Procedure from JSON file').setInputFiles(exportPath);
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat' })).toBeVisible();
  await expect(procedure.getByRole('heading', { level: 6 })).toHaveText(['Upstairs', 'Ground floor']);
  await procedure.getByRole('button', { name: 'Back to all Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(2);
  await page.getByLabel('Import Procedure from JSON file').setInputFiles({
    name: 'evil.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'vergissmeinnicht.procedure', schemaVersion: 99, procedure: {} })),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'different version' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(2);

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

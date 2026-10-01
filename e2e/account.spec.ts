import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';
import { serverEnv } from '../playwright.config.ts';
import { expectAccessible } from './a11y.ts';

const PASSWORD = 'an e2e passphrase that is long';

/** A small real PNG (a colour gradient), as a photo from the file picker. */
function photo(width = 320, height = 240): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      rows[i] = (x * 255) / width;
      rows[i + 1] = (y * 255) / height;
      rows[i + 2] = 160;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** The header menu (☰) holds profile & settings, server admin and sign-out. */
async function fromMenu(page: Page, item: 'Profile & settings' | 'Server admin' | 'Sign out') {
  await page.getByRole('button', { name: /^Menu/ }).click();
  const role = item === 'Sign out' ? 'button' : 'link';
  await page.getByRole(role, { name: item }).click();
}

test('first server admin: bootstrap link, account creation, sign-in, Workspace creation, Procedure authoring with Sections and Steps, export/import/duplicate/restore, starting, executing, completing and aborting Runs, TOTP enrollment, TOTP sign-in and operator TOTP recovery', async ({ page, browser }, testInfo) => {
  // Bootstrap works exactly once per server; the flow runs on one project only.
  test.skip(testInfo.project.name !== 'desktop-chromium', 'bootstrap is single-use per server');
  // One long flow through the whole app (~25 s locally): give slower CI runners room.
  test.setTimeout(180_000);
  // The strict CSP (no inline styles/scripts) must not break anything the flow touches.
  const cspViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
  });

  const output = execFileSync(
    process.execPath,
    ['apps/server/src/cli/admin-bootstrap.ts', '--email', 'Admin@Example.org'],
    { env: { ...process.env, ...serverEnv }, encoding: 'utf8' },
  );
  const link = /http:\/\/127\.0\.0\.1:\d+(\/invite\/[A-Za-z0-9_-]{43})/.exec(output)?.[1];
  expect(link).toBeDefined();

  await page.goto(link ?? '/');
  await expect(page.getByText('admin@example.org')).toBeVisible();
  await expectAccessible(page, 'invitation page');
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
  await expectAccessible(page, 'sign-in page with error');

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name.endsWith('vmn.session_token'));
  expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict' });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Ada Admin' })).toBeVisible();
  await expectAccessible(page, 'start page without Workspace');

  // Workspaces: a server admin creates one on the admin page and becomes its only admin.
  await expect(page.getByText('You are not a member of any Workspace yet.')).toBeVisible();
  // Header menu: opens, closes with Escape and gives focus back to its button.
  const menuButton = page.getByRole('button', { name: /^Menu/ });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('admin@example.org')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
  await fromMenu(page, 'Server admin');
  // Invitations are managed here (no mail server in this test, so delivery reports a failure).
  await page.getByLabel('Email address to invite').fill('Bob@Example.org');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText('bob@example.org');
  const pending = page.getByRole('table', { name: 'Pending invitations' });
  await expect(pending.getByRole('cell', { name: 'bob@example.org', exact: true })).toBeVisible();
  await pending.getByRole('button', { name: 'Revoke invitation for bob@example.org' }).click();
  await expect(page.getByText('No pending invitations.')).toBeVisible();
  // Accounts: the admin's own account is listed but offers no disable action (no self-lockout).
  const accountRows = page.getByRole('table', { name: 'All accounts' }).getByRole('row');
  await expect(accountRows).toHaveCount(2);
  await expect(accountRows.nth(1)).toContainText('(you)');
  await expect(accountRows.nth(1)).toContainText('Active');
  await expect(accountRows.nth(1).getByRole('button')).toHaveCount(0);
  // Security log (a snapshot when the page opens): newest first, in plain words.
  await page.reload();
  const log = page.getByRole('table', { name: 'Security events' });
  await expect(log.getByRole('row').nth(1)).toContainText('Invitation revoked');
  await expect(log.getByRole('cell', { name: 'Signed in', exact: true })).toBeVisible();
  await expectAccessible(page, 'server admin page');
  // Hide the footer for everyone (8.10): it stays in the HTML, hidden; also after a reload; then back.
  const footer = page.locator('footer.app-footer');
  await expect(footer).toBeVisible();
  await expect(page.getByRole('img', { name: 'love' })).toBeVisible();
  await page.getByLabel('Hide the page footer (name and licence)').check();
  await expect(page.getByRole('status').filter({ hasText: 'The footer is hidden.' })).toBeVisible();
  await expect(footer).toBeHidden();
  await expect(footer).toHaveAttribute('hidden', '');
  await page.reload();
  await expect(page.getByLabel('Hide the page footer (name and licence)')).toBeChecked();
  await expect(footer).toBeHidden();
  await expect(footer).toContainText('VergissMeinNicht (VMN) with');
  await page.getByLabel('Hide the page footer (name and licence)').uncheck();
  await expect(footer).toBeVisible();
  await page.getByLabel('New Workspace name').fill('Household');
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Members', level: 2 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toContainText('Household (Admin)');
  await expect(page.getByText('Your role: Admin')).toBeVisible();
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row')).toHaveCount(2);
  await expect(members.getByRole('cell', { name: 'admin@example.org' })).toBeVisible();
  await expectAccessible(page, 'members page');
  await page.getByLabel('Member email').fill('nobody@example.org');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/no active account/);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Leave Workspace' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at least one active admin' })).toBeVisible();
  await expect(page.getByText('Your role: Admin')).toBeVisible();
  await page.getByRole('link', { name: 'Procedures' }).click();

  // Procedures: create with a Section and Steps, view, edit/reorder, delete.
  await page.getByRole('button', { name: 'New Procedure' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Leave the house');
  await page.getByLabel('Description', { exact: true }).fill('Windows closed?\n<b>Stove off</b>');
  // Icon picker: search, then pick with the pointer (closes the panel).
  await page.getByRole('button', { name: 'Icon: Checklist — change' }).click();
  // Aliases: "fridge" also finds the freezer.
  await page.getByLabel('Search icons').fill('fridge');
  await expect(page.getByRole('radio', { name: 'Fridge', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Freezer', exact: true })).toBeVisible();
  await page.getByLabel('Search icons').fill('trav');
  // Matches icon names and group names ("Outdoors & travel"); everything else is filtered out.
  await expect(page.getByRole('radio', { name: 'Travel', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Power', exact: true })).toHaveCount(0);
  await page.getByTitle('Travel', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Icon: Travel — change' })).toBeFocused();
  await expect(page.getByLabel('Search icons')).toHaveCount(0);
  await page.getByLabel('Tags (comma-separated)').fill('daily, Daily, safety');
  await page.getByRole('button', { name: 'Add section' }).click();
  await page.getByLabel('Section 1 title').fill('Ground floor');
  await page.getByRole('button', { name: 'Add step to section 1' }).click();
  await page.getByLabel('Step 1.1 title').fill('Close windows');
  // An instruction photo (14.3) through the file picker (the camera button is its phone alternative).
  const firstStep = page.getByRole('group', { name: 'Step 1.1' });
  const chooser = page.waitForEvent('filechooser');
  await firstStep.getByRole('button', { name: 'Choose photo' }).click();
  await (await chooser).setFiles({ name: 'window.png', mimeType: 'image/png', buffer: photo() });
  await firstStep.getByLabel('What the photo shows (Step 1.1)').fill('Blue handle on the left window');
  await expect(firstStep.getByRole('img', { name: 'Blue handle on the left window' })).toBeVisible();
  await expect(firstStep.getByRole('button', { name: 'Replace photo' })).toBeVisible();
  await expect(page.getByText(/^Photos in this Workspace: [\d.]+ MB of 100 MB used\.$/)).toBeVisible();
  await page.getByRole('button', { name: 'Add step to section 1' }).click();
  await page.getByLabel('Step 1.2 title').fill('Turn off stove');
  await page.getByRole('group', { name: 'Step 1.2' }).getByLabel(/Critical/).check();
  // Reason settings are under "More options" of the Step.
  await page.getByRole('group', { name: 'Step 1.2' }).getByText('More options').click();
  await page.getByRole('group', { name: 'Step 1.2' }).getByLabel('When skipped:').selectOption('REQUIRED');
  // Step icon with the keyboard only: grouped tiles, arrows move the choice, Enter closes (no submit).
  // A calm panel first (13.16): a few suggested icons, the complete catalog one click away.
  await page.getByRole('button', { name: 'Step 1.2 icon: No icon — change' }).click();
  await expect(page.getByRole('group', { name: 'Suggested' }).getByRole('radio')).toHaveCount(9); // "No icon" + 8
  await expect(page.getByRole('group', { name: 'Utilities' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Browse all \d+ icons$/ }).click();
  await expect(page.getByRole('group', { name: 'Utilities' })).toBeVisible();
  await expectAccessible(page, 'icon picker');
  // Categories narrow the catalog.
  await page.getByLabel('Category').selectOption({ label: 'Kitchen' });
  await expect(page.getByRole('radio', { name: 'Freezer', exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Power', exact: true })).toHaveCount(0);
  await page.getByLabel('Category').selectOption({ label: 'Utilities' });
  await page.getByRole('radio', { name: 'Power', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Water', exact: true })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Step 1.2 icon: Water — change' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Create Procedure' })).toBeVisible();
  // Back to the kitchen icon for the stove (search by name, pick with the pointer).
  await page.getByRole('button', { name: 'Step 1.2 icon: Water — change' }).click();
  await page.getByLabel('Search icons').fill('kitchen');
  await page.getByTitle('Kitchen', { exact: true }).click();
  await page.getByRole('button', { name: 'Create Procedure' }).click();

  const procedure = page.getByRole('article');
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the house' })).toBeVisible();
  await expect(procedure.getByText('<b>Stove off</b>')).toBeVisible();
  await expect(procedure.getByText('Tags: daily, safety')).toBeVisible();
  const steps = procedure.getByRole('region', { name: 'Section: Ground floor' }).getByRole('listitem');
  await expect(steps).toHaveCount(2);
  // Flags are marks, not prose: a "Critical" icon, and no label for the (default) required Steps.
  await expect(steps.nth(1)).toContainText('Turn off stove');
  await expect(steps.nth(1).getByRole('img', { name: 'Critical' })).toBeVisible();
  await expect(steps.nth(0).getByRole('img', { name: 'Critical' })).toHaveCount(0);
  await expect(steps.nth(1)).not.toContainText('Required');
  await expectAccessible(page, 'procedure view');

  // Secondary actions are under ⋯ (13.15): Edit, Duplicate, Export, Knot link, Delete.
  const fromProcedureMenu = async (item: string) => {
    await procedure.getByRole('button', { name: /^More actions for / }).click();
    await procedure.getByRole('button', { name: item, exact: true }).click();
  };
  // Edit: rename, move the stove Step to the top, save once.
  await fromProcedureMenu('Edit');
  await page.getByLabel('Title', { exact: true }).fill('Leave the flat');
  await page.getByRole('button', { name: 'Move step 1.2 up' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat' })).toBeVisible();
  await expect(steps.nth(0)).toContainText('Turn off stove');
  await expect(steps.nth(1)).toContainText('Close windows');

  // Drag and drop: a new Section, then drag "Close windows" (step 1.2) into it; one save.
  await fromProcedureMenu('Edit');
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
  await page.getByRole('group', { name: 'Step 2.1' }).getByText('More options').click();
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
  await expect(procedure.getByRole('heading', { level: 3 })).toHaveText(['Upstairs', 'Ground floor']);
  await expect(procedure.getByRole('region', { name: 'Section: Upstairs' }).getByRole('listitem')).toHaveText([/Close windows/]);
  await expect(steps).toHaveCount(1);

  // Export as a JSON file, duplicate, delete the copy, re-import the exported file.
  const downloadPromise = page.waitForEvent('download');
  await fromProcedureMenu('Export as JSON (without images)');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('leave-the-flat.vmn.json');
  const exportPath = testInfo.outputPath('export.json');
  await download.saveAs(exportPath);
  expect(readFileSync(exportPath, 'utf8')).not.toContain('Blue handle');
  // The archive carries the photos as well (14.3).
  const archivePromise = page.waitForEvent('download');
  await fromProcedureMenu('Export as archive (with images)');
  const archive = await archivePromise;
  expect(archive.suggestedFilename()).toBe('leave-the-flat.vmn.zip');
  const archivePath = testInfo.outputPath('export.zip');
  await archive.saveAs(archivePath);
  expect(readFileSync(archivePath).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  await fromProcedureMenu('Duplicate');
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat (copy)' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await fromProcedureMenu('Delete');
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(1);
  // Rare actions live in the page's Manage menu (13.15). Restore the deleted copy, then delete it again.
  await page.getByRole('button', { name: 'Manage Procedures' }).click();
  await expectAccessible(page, 'procedure list with manage menu');
  await page.getByRole('button', { name: 'Deleted Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Deleted Procedures' })).toContainText('Leave the flat (copy) — deleted by Ada Admin');
  // It can be read in full before restoring (8.9).
  await page.getByRole('button', { name: 'View Leave the flat (copy)' }).click();
  await expect(procedure.getByRole('note')).toContainText('This Procedure is deleted.');
  await expect(procedure.getByRole('heading', { level: 3 })).toHaveText(['Upstairs', 'Ground floor']);
  await expectAccessible(page, 'deleted procedure view');
  await procedure.getByRole('button', { name: 'Restore Leave the flat (copy)' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat (copy)' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await fromProcedureMenu('Delete');
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(1);

  // Re-import the archive: the Procedure comes back with its photo (the JSON path is checked below).
  await page.getByLabel('Import Procedure (JSON file or archive with images)…').setInputFiles(archivePath);
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat' })).toBeVisible();
  await expect(procedure.getByRole('img', { name: 'Blue handle on the left window' })).toBeVisible();
  await expect(procedure.getByRole('heading', { level: 3 })).toHaveText(['Upstairs', 'Ground floor']);
  await procedure.getByRole('button', { name: 'Back to all Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(2);
  // Tag filter (8.9): every tag of the Workspace, "All tags" by default.
  const tagFilter = page.getByLabel('Tag', { exact: true });
  await expect(tagFilter.getByRole('option')).toHaveText(['All tags', 'daily', 'safety']);
  await tagFilter.selectOption('safety');
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(2);
  await tagFilter.selectOption('');
  await page.getByLabel('Import Procedure (JSON file or archive with images)…').setInputFiles({
    name: 'evil.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'vergissmeinnicht.procedure', schemaVersion: 99, procedure: {} })),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'different version' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem')).toHaveCount(2);

  // Start two executions of the same Procedure; each is a snapshot with pending Steps. The second
  // time VMN warns that one is already active — starting another stays allowed (13.18).
  const run = page.getByRole('article');
  const stepItem = (title: string) => run.getByRole('listitem').filter({ hasText: title });
  const sections = page.getByRole('navigation', { name: 'Workspace sections' });
  for (let i = 0; i < 2; i++) {
    await sections.getByRole('link', { name: 'Procedures' }).click();
    await page.getByRole('list', { name: 'Procedures' }).getByRole('button').first().click();
    await procedure.getByRole('button', { name: 'Start Leave the flat' }).click();
    await procedure.getByRole('button', { name: 'Start now' }).click();
    if (i === 1) {
      const warning = page.getByRole('dialog', { name: 'Already in progress' });
      await expect(warning).toContainText('“Leave the flat” already has an active execution, started by Ada Admin');
      await expectAccessible(page, 'already-active warning');
      await warning.getByRole('button', { name: 'Start another anyway' }).click();
    }
    await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/runs\/[0-9a-f-]{36}$/);
    await expect(run.getByRole('heading', { name: 'Travel Leave the flat', level: 2 })).toBeVisible();
    await expect(run).toContainText('Started by Ada Admin');
    await expect(stepItem('Close windows')).toContainText('Pending');
    await expect(stepItem('Turn off stove')).toContainText('Pending');
    await expect(stepItem('Turn off stove').getByRole('img', { name: 'Critical' })).toBeVisible();
    await expect(stepItem('Turn off stove')).not.toContainText('Required');
  }
  // The photo is part of the execution snapshot: thumbnail with caption, full-screen on tap.
  await expect(stepItem('Close windows').getByRole('img', { name: 'Blue handle on the left window' })).toBeVisible();
  await stepItem('Close windows').getByRole('button', { name: 'Show photo full-screen: Blue handle on the left window' }).click();
  const viewer = page.getByRole('dialog', { name: 'Blue handle on the left window' });
  await expect(viewer.getByRole('img', { name: 'Blue handle on the left window' })).toBeVisible();
  await expectAccessible(page, 'photo viewer');
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  // Home (13.9) lists what is going on: both executions under Active, with Continue.
  await sections.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Household', level: 2 })).toBeVisible();
  const activeRuns = page.getByRole('list', { name: 'Active' });
  await expect(activeRuns.getByRole('listitem')).toHaveCount(2);
  await expect(activeRuns.getByRole('listitem').first()).toContainText('0 of 2 resolved');
  await expectAccessible(page, 'workspace home');

  // Execute: Done, Skip with a required reason, Undo.
  await activeRuns.getByRole('link').first().click();

  // A second device of the same person follows the Run live (6.1).
  const secondDevice = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const page2 = await secondDevice.newPage();
  await page2.goto('/');
  await page2.getByLabel('Email').fill('admin@example.org');
  await page2.getByLabel('Password').fill(PASSWORD);
  await page2.getByRole('button', { name: 'Sign in' }).click();
  await expect(page2.getByRole('button', { name: /^Menu/ })).toBeVisible();
  await page2.goto(page.url());
  const run2 = page2.getByRole('article');
  const stepItem2 = (title: string) => run2.getByRole('listitem').filter({ hasText: title });
  await expect(run2).toContainText('● Live');
  await expect(run).toContainText('● Live');

  await run.getByRole('button', { name: 'Done: Close windows' }).click();
  await expect(stepItem('Close windows')).toContainText('Ada Admin ·');
  await expect(stepItem2('Close windows')).toContainText('Ada Admin ·');
  await expect(run2.getByRole('status').filter({ hasText: 'changed' })).toContainText('Ada Admin changed “Close windows”');

  // Optimistic UI (6.2): the new state shows at once while saving; a rejection restores it.
  const stateUrl = '**/api/workspaces/*/runs/*/steps/*/state';
  await page2.route(stateUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'step_conflict' }) });
  });
  await run2.getByRole('button', { name: 'Undo: Close windows' }).click();
  await expect(stepItem2('Close windows')).toContainText('Saving…');
  await expect(stepItem2('Close windows').locator('.state-badge')).toHaveText(/Pending/);
  await expect(page2.getByRole('alert')).toContainText('“Close windows” was not changed: Someone else changed this Step just now.');
  await expect(stepItem2('Close windows').locator('.state-badge')).toHaveText(/Done/);
  await page2.unroute(stateUrl);
  await page2.route(stateUrl, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await run2.getByRole('button', { name: 'Undo: Close windows' }).click();
  await expect(stepItem2('Close windows')).toContainText('Saving…');
  await expect(stepItem2('Close windows')).not.toContainText('Ada Admin ·');
  await expect(stepItem('Close windows')).not.toContainText('Ada Admin ·');
  await run2.getByRole('button', { name: 'Done: Close windows' }).click();
  await expect(stepItem('Close windows')).toContainText('Ada Admin ·');
  await page2.unroute(stateUrl);

  // Phone-first execution (8.1): the next Step is obvious, progress stays in view, less clutter
  // on demand, and nothing scrolls sideways.
  // Evaluated in the page (string form: the e2e files are type-checked without DOM types).
  const noSidewaysScroll = () => page.evaluate('document.documentElement.scrollWidth <= window.innerWidth');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSidewaysScroll()).toBe(true);
  await expectAccessible(page, 'run view on a phone');
  await expect(stepItem('Turn off stove')).toContainText('Next');
  await expect(stepItem('Close windows')).not.toContainText('Next');
  const dock = page.getByRole('region', { name: 'Progress' });
  await expect(dock).toContainText('1 of 2 resolved · Next: Turn off stove');
  await dock.getByRole('button', { name: 'Go to next Step' }).click();
  await expect(stepItem('Turn off stove')).toBeFocused();
  await expect(dock).toBeInViewport();
  const doneButtonHeight = (await stepItem('Turn off stove').getByRole('button', { name: 'Skip' }).boundingBox())?.height ?? 0;
  expect(doneButtonHeight).toBeGreaterThanOrEqual(44);
  await run.getByLabel('Hide resolved Steps').check();
  await expect(stepItem('Close windows')).toHaveCount(0);
  await expect(stepItem('Turn off stove')).toHaveCount(1);
  await run.getByLabel('Hide resolved Steps').uncheck();
  await expect(stepItem('Close windows')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  const stove = stepItem('Turn off stove');
  await stove.getByRole('button', { name: 'Skip' }).click();
  await stove.getByLabel(/Why is it skipped\? \(required\)/).fill('Nobody cooked today');
  await stove.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(stove).toContainText('Skipped');
  await expect(stove).toContainText('reason: Nobody cooked today');
  // Forced colours (8.8): Step states differ by border style, not only by (now system) colour.
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(stove).toHaveCSS('border-left-style', 'dashed');
  await expect(stepItem('Close windows')).toHaveCSS('border-left-style', 'solid');
  await expect(page.getByRole('progressbar').first().locator('span')).toHaveCSS('forced-color-adjust', 'none');
  await expectAccessible(page, 'run view in forced colours');
  await page.emulateMedia({ forcedColors: 'none' });
  await run.getByRole('button', { name: 'Undo: Close windows' }).click();
  await expect(stepItem('Close windows')).not.toContainText('Ada Admin ·');

  // Critical Step: a click is not enough — it needs press-and-hold, and says so.
  await stove.getByRole('button', { name: 'Undo: Turn off stove' }).click();
  const hold = stove.getByRole('button', { name: 'Hold to mark done: Turn off stove' });
  await expect(hold).toHaveAccessibleDescription(/press and hold/);
  // Each Step is a heading (jump from Step to Step with a screen reader).
  await expect(run.getByRole('heading', { level: 4, name: /Turn off stove/ })).toBeVisible();
  await hold.click();
  // The feedback is a live status, so screen readers announce it.
  await expect(stove.getByRole('status')).toHaveText('Keep holding until the button is completely filled.');
  await expect(stove.locator('.state-badge')).toHaveText(/Pending/);
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(stove).toContainText('Keep holding until the button is completely filled.');
  await expect(stove.locator('.state-badge')).toHaveText(/Pending/);
  await hold.hover();
  await page.mouse.down();
  await expect(stove).toContainText('Ada Admin ·', { timeout: 5000 });
  await page.mouse.up();
  // Keyboard: holding Space works as well (undo first).
  await stove.getByRole('button', { name: 'Undo: Turn off stove' }).click();
  // The optimistic Pending state appears at once; the button is usable once the undo is saved.
  await expect(stove).not.toContainText('Ada Admin ·');
  await expect(hold).toBeEnabled();
  await expect(stove).not.toContainText('Saving…');
  await hold.focus();
  await page.keyboard.down(' ');
  await expect(stove).toContainText('Ada Admin ·', { timeout: 5000 });
  await page.keyboard.up(' ');

  // Completion needs every required Step done or not applicable.
  const finishControls = run.getByRole('region', { name: 'Finish' });
  await expect(finishControls.getByRole('button', { name: 'Complete' })).toBeDisabled();
  await expect(finishControls).toContainText('1 required Step is still pending or skipped: Close windows');
  await run.getByRole('button', { name: 'Done: Close windows' }).click();
  await finishControls.getByRole('button', { name: 'Complete' }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Completed by Ada Admin' })).toBeVisible();
  // The second device sees the completion without reloading and stops listening.
  await expect(run2.getByRole('status').filter({ hasText: 'Completed by Ada Admin on' })).toBeVisible();
  await expect(run2.getByRole('button', { name: /Undo|Done|Skip/ })).toHaveCount(0);
  await secondDevice.close();
  await expect(run.getByRole('button', { name: /Undo|Done|Skip/ })).toHaveCount(0);
  // The Run's history tells who did what, when and why.
  await run.getByRole('region', { name: 'Execution history' }).getByRole('button', { name: 'Show history' }).click();
  const history = run.getByRole('region', { name: 'Execution history' }).getByRole('listitem');
  await expect(history.first()).toContainText('Ada Admin started it');
  await expect(history.filter({ hasText: 'Turn off stove: Pending → Skipped — reason: Nobody cooked today' })).toHaveCount(1);
  // One undo from the second device, one from this one; the rejected attempt left no trace.
  await expect(history.filter({ hasText: 'Close windows: Done → Pending (undo)' })).toHaveCount(2);
  await expect(history.last()).toContainText('Ada Admin completed it');
  await expectAccessible(page, 'finished run with history');
  await sections.getByRole('link', { name: 'Completed history' }).click();
  await expect(page.getByRole('list', { name: 'Finished' })).toContainText('✔ 2 done');
  await expectAccessible(page, 'completed history');

  // Abort the other execution with a reason.
  await page.getByRole('button', { name: 'Go to Home' }).click();
  await page.getByRole('list', { name: 'Active' }).getByRole('link').click();
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByLabel('Why is it aborted? (optional)').fill('Plans changed');
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  const aborted = run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' });
  await expect(aborted).toContainText('reason: Plans changed');
  await page.getByRole('button', { name: '← Home' }).click();
  await expect(page.getByRole('list', { name: 'Active' })).toHaveCount(0);
  await sections.getByRole('link', { name: 'Completed history' }).click();
  await expect(page.getByRole('list', { name: 'Finished' }).getByRole('listitem')).toHaveCount(2);
  // The Procedure card tells when it was last completed.
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem').first()).toContainText('Last completed');

  // Knot links (7.1): an entry link to a Procedure, shown once, that still requires signing in.
  await page.getByRole('list', { name: 'Procedures' }).getByRole('button').first().click();
  await fromProcedureMenu('Share as Knot link…');
  const share = page.getByRole('region', { name: 'Knot link for this Procedure' });
  await share.getByLabel('Name of the link').fill('Hallway card');
  await share.getByLabel('Valid for').selectOption('7');
  await share.getByRole('button', { name: 'Create Knot link' }).click();
  const knotLink = await share.getByLabel(/Knot link \(shown only now/).inputValue();
  expect(knotLink).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/knot\/[A-Za-z0-9_-]{43}$/);
  await share.getByRole('button', { name: 'Done' }).click();

  const visitor = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const visitorPage = await visitor.newPage();
  const knotResponse = await visitorPage.goto(knotLink);
  expect(knotResponse?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(visitorPage.getByRole('status')).toHaveText('Sign in to open this Knot link.');
  await visitorPage.getByLabel('Email').fill('admin@example.org');
  await visitorPage.getByLabel('Password').fill(PASSWORD);
  await visitorPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(visitorPage).toHaveURL(/\/w\/[0-9a-f-]{36}\/procedures\/[0-9a-f-]{36}$/);
  await expect(visitorPage.getByRole('heading', { name: 'Travel Leave the flat', level: 2 })).toBeVisible();

  await page.getByRole('link', { name: 'Knot links' }).click();
  const knotTable = page.getByRole('table', { name: 'Knot links' });
  // Wide tables scroll inside their card, never the page (8.1).
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(knotTable).toBeVisible();
  expect(await noSidewaysScroll()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(knotTable.getByRole('row')).toHaveCount(2);
  await expect(knotTable).toContainText('Hallway card');
  await expect(knotTable).toContainText('Procedure: Leave the flat');
  page.once('dialog', (dialog) => void dialog.accept());
  await knotTable.getByRole('button', { name: 'Revoke Hallway card' }).click();
  await expect(knotTable).toContainText('Revoked by Ada Admin');
  await expectAccessible(page, 'knot links page');
  await visitorPage.goto(knotLink);
  await expect(visitorPage.getByRole('heading', { name: 'Knot link cannot be opened' })).toBeVisible();
  await expect(visitorPage.getByRole('alert')).toContainText('not valid');
  await visitor.close();

  // Procedures are started and scheduled right from the list (13.10), pinned per person (13.12).
  await sections.getByRole('link', { name: 'Procedures' }).click();
  // The imported copy has the same title: work with the first card.
  const card = page.getByRole('list', { name: 'Procedures' }).getByRole('listitem').filter({ hasText: 'Leave the flat' }).first();
  await card.getByRole('button', { name: 'Pin Leave the flat' }).click();
  await expect(card.getByRole('button', { name: 'Unpin Leave the flat' })).toHaveAttribute('aria-pressed', 'true');
  // Start now, directly from the card (no need to open the Procedure first); abort it again.
  await card.getByRole('button', { name: 'Start Leave the flat' }).click();
  await card.getByRole('button', { name: 'Start now' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' })).toBeVisible();

  // Schedule… (13.4): a date, an optional time and reminders; nothing starts by itself.
  const localDate = (offsetDays: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const schedule = async (date: string, reminders: 'custom' | 'none') => {
    await sections.getByRole('link', { name: 'Procedures' }).click();
    await card.getByRole('button', { name: 'Start Leave the flat' }).click();
    await card.getByRole('button', { name: 'Schedule…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Schedule “Leave the flat”' });
    await expect(dialog).toContainText('Nothing starts by itself');
    await dialog.getByLabel('Date', { exact: true }).fill(date);
    if (reminders === 'custom') {
      await dialog.getByLabel('1 day before').check();
      await dialog.getByLabel('Custom reminder: how many').fill('3');
      await dialog.getByRole('button', { name: 'Add reminder' }).click();
      await expect(dialog).toContainText('3 hours before');
      await expectAccessible(page, 'schedule dialog');
    } else {
      await dialog.getByLabel('On the due date').uncheck();
    }
    await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByRole('status')).toContainText('“Leave the flat” is scheduled for');
  };
  await schedule(localDate(4), 'custom');
  await expect(card).toContainText('Scheduled');
  await schedule(localDate(0), 'none');
  await expect(card).toContainText('Due today');

  // Home (13.9, 14.2): Today with Start, Upcoming with its reminders, Pinned and Recent.
  await sections.getByRole('link', { name: 'Home' }).click();
  const todayList = page.getByRole('list', { name: 'Today' });
  const upcoming = page.getByRole('list', { name: 'Upcoming' });
  await expect(todayList.getByRole('listitem')).toHaveCount(1);
  await expect(todayList).toContainText('Today');
  await expect(todayList).toContainText('Shared');
  await expect(upcoming.getByRole('listitem')).toHaveCount(1);
  await expect(upcoming).toContainText('Reminders: 1 day before, 3 hours before, on the due date');
  await expect(page.getByRole('list', { name: 'Pinned' })).toContainText('Leave the flat');
  await expect(page.getByRole('list', { name: 'Recent', exact: true })).toContainText('Leave the flat');
  await expect(page.getByRole('list', { name: 'Active' })).toHaveCount(0);
  await expectAccessible(page, 'home with today and upcoming');
  // Move one date and end a schedule under ⋯.
  await upcoming.getByRole('button', { name: 'More for Leave the flat' }).click();
  await upcoming.getByRole('button', { name: 'Move this date…' }).click();
  const move = page.getByRole('dialog', { name: 'Move “Leave the flat”' });
  await move.getByLabel('Date', { exact: true }).fill(localDate(9));
  await move.getByRole('button', { name: 'Save' }).click();
  await expect(move).toHaveCount(0);
  await expect(upcoming.getByRole('listitem')).toHaveCount(1);
  page.once('dialog', (dialog) => void dialog.accept());
  await upcoming.getByRole('button', { name: 'More for Leave the flat' }).click();
  await upcoming.getByRole('button', { name: 'End schedule…' }).click();
  await expect(page.getByRole('list', { name: 'Upcoming' })).toHaveCount(0);
  // Start what is due today: a normal execution, linked to this date.
  await todayList.getByRole('button', { name: 'Start Leave the flat' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(run.getByRole('heading', { name: 'Travel Leave the flat', level: 2 })).toBeVisible();
  // Phone (13.17): the Steps come first; history and sharing are folded away.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSidewaysScroll()).toBe(true);
  await expect(run.locator('details.run-more')).not.toHaveAttribute('open');
  await expect(run.getByRole('region', { name: 'Execution history' })).toBeHidden();
  await expectAccessible(page, 'run view on a phone, started from Today');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '← Home' }).click();
  // The date shows its execution (Continue) instead of a second Start; Active does not repeat it.
  await expect(page.getByRole('list', { name: 'Today' })).toContainText('In progress — started by Ada Admin');
  await expect(page.getByRole('list', { name: 'Active' })).toHaveCount(0);
  await page.getByRole('list', { name: 'Today' }).getByRole('link', { name: 'Continue Leave the flat' }).click();
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' })).toBeVisible();
  // Aborted: the date is open again (Start), nothing was completed.
  await page.getByRole('button', { name: '← Home' }).click();
  await expect(page.getByRole('list', { name: 'Today' }).getByRole('button', { name: 'Start Leave the flat' })).toBeVisible();

  // A standalone Reminder (14.1, 14.2): repeating yearly, responsible person, Complete, who and Undo.
  await page.getByRole('button', { name: 'New reminder' }).click();
  const newReminder = page.getByRole('dialog', { name: 'New reminder' });
  await newReminder.getByLabel('What').fill('Pay annual tax');
  await newReminder.getByLabel('On fixed dates').check();
  await newReminder.getByLabel('Unit', { exact: true }).selectOption({ label: 'years' });
  await expect(newReminder).toContainText('Dates stay fixed, even when one is done late.');
  await newReminder.getByLabel('First date').fill(localDate(0));
  await newReminder.getByLabel('Responsible').selectOption({ label: 'Ada Admin' });
  await newReminder.getByLabel('1 month before').check();
  await expectAccessible(page, 'new reminder dialog');
  await newReminder.getByRole('button', { name: 'Create reminder' }).click();
  await expect(newReminder).toHaveCount(0);
  const taxToday = page.getByRole('list', { name: 'Today' }).getByRole('listitem').filter({ hasText: 'Pay annual tax' });
  await expect(taxToday).toContainText('Reminder · Every year');
  await expect(taxToday).toContainText('Assigned to Ada Admin');
  // Filters: assigned to me shows it, shared hides it.
  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(taxToday).toHaveCount(0);
  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(taxToday).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await taxToday.getByRole('button', { name: 'Complete Pay annual tax' }).click();
  const doneList = page.getByRole('list', { name: 'Recently done' });
  await expect(doneList).toContainText('Completed by Ada Admin');
  await expect(taxToday).toHaveCount(0);
  await expectAccessible(page, 'home with recently done');
  await doneList.getByRole('button', { name: 'Undo Pay annual tax' }).click();
  await expect(taxToday).toHaveCount(1);
  // Skip shows what happens next; the history keeps it.
  await taxToday.getByRole('button', { name: 'More for Pay annual tax' }).click();
  await taxToday.getByRole('button', { name: 'Skip…' }).click();
  const skip = page.getByRole('dialog', { name: /^Skip “Pay annual tax”/ });
  await expect(skip).toContainText('the next dates are not affected');
  await skip.getByLabel('Reason').fill('Paid in advance');
  await skip.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(doneList).toContainText('Skipped by Ada Admin');

  // Server admin: the size of Recent (13.13) and the notification providers (13.7).
  await fromMenu(page, 'Server admin');
  await expect(page.getByLabel('Recent Procedures on Home')).toHaveValue('5');
  await page.getByLabel('Recent Procedures on Home').fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Home shows no recent Procedures.' })).toBeVisible();
  const providers = page.getByRole('region', { name: 'Notification providers' });
  await expect(providers).toContainText('Configured (SMTP settings of this server).');
  await expect(providers).toContainText('Telegram');
  await expect(providers).toContainText('Configure the Telegram bot used by this VergissMeinNicht instance.');
  await expect(providers).toContainText('No bot configured yet.');
  await expect(providers).toContainText('Create a bot with @BotFather');
  await expect(providers.getByRole('button', { name: 'Send test message to my Telegram' })).toHaveCount(0);
  await providers.getByLabel('Bot token').fill('not a bot token');
  await providers.getByRole('button', { name: 'Save Telegram settings' }).click();
  await expect(providers.getByRole('alert')).toHaveText('This is not a Telegram bot token.');
  await expect(providers.getByLabel('Bot token')).toHaveValue('');
  await expectAccessible(page, 'server admin page with notification providers');
  await page.goto('/'); // the start page opens the last Workspace's Home
  await expect(page.getByRole('list', { name: 'Pinned' })).toContainText('Leave the flat');
  await expect(page.getByRole('list', { name: 'Recent', exact: true })).toHaveCount(0);
  await fromMenu(page, 'Server admin');
  await expect(page.getByLabel('Recent Procedures on Home')).toHaveValue('0');
  await page.getByLabel('Recent Procedures on Home').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Home shows 5 recent Procedures.' })).toBeVisible();

  // Account → Notifications (13.8): own default reminder time and channels; no provider secrets here.
  await fromMenu(page, 'Profile & settings');
  const notifications = page.getByRole('region', { name: 'Notifications' });
  await expect(notifications.getByLabel('Default reminder time')).toHaveValue('09:00');
  await notifications.getByLabel('Default reminder time').fill('07:30');
  await notifications.getByRole('button', { name: 'Save time' }).click();
  await expect(notifications.getByRole('status')).toHaveText('Saved.');
  await expect(notifications).toContainText('Telegram is not set up on this server.');
  await expect(notifications.getByLabel('Procedure reminders')).toBeChecked();
  await expect(notifications.getByLabel(/token/i)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByLabel('Default reminder time')).toHaveValue('07:30');
  await expectAccessible(page, 'account page with notifications');
  // Unpin again from the list.
  await page.goto('/');
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await card.getByRole('button', { name: 'Unpin Leave the flat' }).click();
  await expect(card.getByRole('button', { name: 'Pin Leave the flat' })).toHaveAttribute('aria-pressed', 'false');

  // Account settings live on their own page.
  await fromMenu(page, 'Profile & settings');

  // Appearance (8.3): the theme choice applies at once and survives a reload.
  const html = page.locator('html');
  await page.getByRole('radio', { name: /^Dark/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expectAccessible(page, 'account page (dark)');
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Dark/ })).toBeChecked();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radio', { name: /^Light/ }).check();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expectAccessible(page, 'account page (light)');
  await page.getByRole('radio', { name: /^System/ }).check();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'light');
  // Memento Mori (8.7) is saved to the account: another browser gets it right after signing in.
  await page.getByRole('radio', { name: /^Memento Mori/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'memento-mori');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expectAccessible(page, 'account page (memento mori)');
  const otherBrowser = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const other = await otherBrowser.newPage();
  await other.goto('/');
  await other.getByLabel('Email').fill('admin@example.org');
  await other.getByLabel('Password').fill(PASSWORD);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'memento-mori');
  await otherBrowser.close();
  await page.getByRole('radio', { name: /^System/ }).check();

  // Critical Steps without holding (8.7): tap, then confirm; Escape backs out.
  await page.getByRole('radio', { name: /^Tap, then confirm/ }).check();
  await expect(page.getByRole('radio', { name: /^Tap, then confirm/ })).toBeChecked();
  await page.goto('/');
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await page.getByRole('list', { name: 'Procedures' }).getByRole('button').first().click();
  await procedure.getByRole('button', { name: 'Start Leave the flat' }).click();
  await procedure.getByRole('button', { name: 'Start now' }).click();
  const tapStove = stepItem('Turn off stove');
  await tapStove.getByRole('button', { name: 'Mark done: Turn off stove (asks to confirm)' }).click();
  const question = tapStove.getByRole('group', { name: 'Confirm: Turn off stove is done?' });
  await expect(question.getByRole('button', { name: '✔ Yes, done' })).toBeFocused();
  await expectAccessible(page, 'run view asking to confirm a critical step');
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(tapStove.getByRole('button', { name: 'Mark done: Turn off stove (asks to confirm)' })).toBeFocused();
  await expect(tapStove).toContainText('Pending');
  await tapStove.getByRole('button', { name: 'Mark done: Turn off stove (asks to confirm)' }).click();
  await question.getByRole('button', { name: '✔ Yes, done' }).click();
  await expect(tapStove).toContainText('Ada Admin ·');

  // Offline (8.5): the router goes off after "Turn off stove". The next change is kept on this device,
  // survives a reload without connection, and is sent once the connection is back — with the device
  // time shown as such next to the server time.
  expect(await page.evaluate('navigator.serviceWorker.ready.then(() => true)')).toBe(true);
  const context = page.context();
  await context.setOffline(true);
  const windows = stepItem('Close windows');
  await windows.getByRole('button', { name: 'Done: Close windows' }).click();
  await expect(windows).toContainText('Saved on this device · not sent yet');
  await expect(page.getByRole('status').filter({ hasText: 'Offline.' })).toContainText('1 change is saved on this device');
  await expect(run.getByRole('button', { name: 'Abort…' })).toBeDisabled();
  await expectAccessible(page, 'run view offline');
  await page.reload();
  await expect(stepItem('Close windows')).toContainText('Saved on this device · not sent yet');
  await expect(run).toContainText('Offline: showing the copy saved on this device');
  await context.setOffline(false);
  await expect(stepItem('Close windows')).toContainText('(offline, device clock', { timeout: 15_000 });
  await expect(page.getByRole('status').filter({ hasText: 'Offline.' })).toHaveCount(0);
  await expect(run.getByRole('button', { name: 'Abort…' })).toBeEnabled();
  // A conflicting offline change is dropped and explained, never forced over someone else's change.
  const otherDevice = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const otherPage = await otherDevice.newPage();
  await otherPage.goto('/');
  await otherPage.getByLabel('Email').fill('admin@example.org');
  await otherPage.getByLabel('Password').fill(PASSWORD);
  await otherPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(otherPage.getByRole('button', { name: /^Menu/ })).toBeVisible();
  await otherPage.goto(page.url());
  await context.setOffline(true);
  await stepItem('Close windows').getByRole('button', { name: 'Undo: Close windows' }).click();
  await expect(stepItem('Close windows')).toContainText('Saved on this device · not sent yet');
  const otherRun = otherPage.getByRole('article');
  await otherRun.getByRole('button', { name: 'Undo: Close windows' }).click();
  await otherRun.getByRole('listitem').filter({ hasText: 'Close windows' }).getByRole('button', { name: 'Skip' }).click();
  await otherRun.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(otherRun.getByRole('listitem').filter({ hasText: 'Close windows' })).toContainText('Skipped');
  await otherDevice.close();
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toContainText('Your offline change to “Close windows” was not applied: Someone else changed this Step', { timeout: 15_000 });
  await expect(stepItem('Close windows')).toContainText('Skipped');
  await page.getByRole('button', { name: 'OK' }).click();
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' })).toBeVisible();
  await fromMenu(page, 'Profile & settings');
  await page.getByRole('radio', { name: /^Press and hold/ }).check();

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

  // A second tab of the same browser shares the session and the device database (13.1).
  const secondTab = await page.context().newPage();
  await secondTab.goto(page.url());
  await expect(secondTab.getByRole('button', { name: /^Menu/ })).toBeVisible();
  await fromMenu(page, 'Sign out');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  // Nothing of the account stays on the device (8.5): saved Runs and queued changes are gone.
  expect(await page.evaluate("indexedDB.databases().then((list) => list.map((db) => db.name))")).not.toContain('vmn-offline');
  // The other tab left the account at once instead of keeping (and possibly sending) its data.
  await expect(secondTab.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await secondTab.close();

  // Sign-in now needs the second factor; the enrollment code's time step is used up, so use the next one.
  await page.getByLabel('Email').fill('admin@example.org');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
  await expectAccessible(page, 'second-factor page');
  const cookiesBeforeCode = await page.context().cookies();
  expect(cookiesBeforeCode.some((cookie) => cookie.name.endsWith('vmn.session_token'))).toBe(false);
  await page.getByLabel('Code from your authenticator app').fill(totp.generate({ timestamp: Date.now() + 30_000 }));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Household', level: 2 })).toBeVisible();

  await fromMenu(page, 'Sign out');
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
  await expect(page.getByRole('heading', { name: 'Household', level: 2 })).toBeVisible();
  await fromMenu(page, 'Profile & settings');
  await expect(page.getByText('Status: Not enabled')).toBeVisible();

  await fromMenu(page, 'Sign out');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(cspViolations).toEqual([]);
});

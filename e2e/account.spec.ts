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

/** The one Settings entry (15.1) holds Profile & settings, Workspace settings, Server admin and sign-out. */
async function fromMenu(page: Page, item: 'Profile & settings' | 'Workspace settings' | 'Server admin' | 'Sign out') {
  await page.getByRole('button', { name: /^Settings/ }).click();
  const role = item === 'Sign out' ? 'button' : 'link';
  await page.getByRole(role, { name: item }).click();
}

/** A named section of a settings area (Profile & settings, Workspace settings, Server admin). */
async function settingsSection(page: Page, area: 'Profile & settings' | 'Workspace settings' | 'Server administration', section: string) {
  await page.getByRole('navigation', { name: area }).getByRole('link', { name: section, exact: true }).click();
}

test('first server admin: bootstrap link, account creation, sign-in, Workspace creation, Procedure authoring with Sections and Steps, export/import/duplicate/restore, starting, executing, completing and aborting Runs, TOTP enrollment, TOTP sign-in and operator TOTP recovery', async ({ page, browser }, testInfo) => {
  // Bootstrap works exactly once per server; the flow runs on one project only.
  test.skip(testInfo.project.name !== 'desktop-chromium', 'bootstrap is single-use per server');
  // One long flow through the whole app (~1 min locally): give slower CI runners room.
  test.setTimeout(420_000);
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
  const menuButton = page.getByRole('button', { name: /^Settings/ });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('admin@example.org')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(menuButton).toBeFocused();
  await fromMenu(page, 'Server admin');
  // Server admin shows one named section at a time (15.1); each has its own address.
  await expect(page.getByRole('navigation', { name: 'Server administration' }).getByRole('link')).toHaveText(['Workspaces', 'Invitations', 'Accounts & recovery', 'Notification providers', 'Server & storage', 'Security log']);
  await expect(page.getByLabel('Email address to invite')).toHaveCount(0);
  // Invitations are managed here (no mail server in this test, so delivery reports a failure).
  await settingsSection(page, 'Server administration', 'Invitations');
  await expect(page).toHaveURL(/\/admin\/invitations$/);
  await page.getByLabel('Email address to invite').fill('Bob@Example.org');
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('status')).toContainText('bob@example.org');
  const pending = page.getByRole('table', { name: 'Pending invitations' });
  await expect(pending.getByRole('cell', { name: 'bob@example.org', exact: true })).toBeVisible();
  await pending.getByRole('button', { name: 'Revoke invitation for bob@example.org' }).click();
  await expect(page.getByText('No pending invitations.')).toBeVisible();
  // Accounts: the admin's own account is listed but offers no disable action (no self-lockout).
  await settingsSection(page, 'Server administration', 'Accounts & recovery');
  const accountRows = page.getByRole('table', { name: 'All accounts' }).getByRole('row');
  await expect(accountRows).toHaveCount(2);
  await expect(accountRows.nth(1)).toContainText('(you)');
  await expect(accountRows.nth(1)).toContainText('Active');
  await expect(accountRows.nth(1).getByRole('button')).toHaveCount(0);
  // Security log (a snapshot when the page opens): newest first, in plain words.
  await settingsSection(page, 'Server administration', 'Security log');
  await page.reload();
  const log = page.getByRole('table', { name: 'Security events' });
  await expect(log.getByRole('row').nth(1)).toContainText('Invitation revoked');
  await expect(log.getByRole('cell', { name: 'Signed in', exact: true })).toBeVisible();
  await expectAccessible(page, 'server admin page');
  // Hide the footer for everyone (8.10): it stays in the HTML, hidden; also after a reload; then back.
  await settingsSection(page, 'Server administration', 'Server & storage');
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
  await settingsSection(page, 'Server administration', 'Workspaces');
  await page.getByLabel('New Workspace name').fill('Household');
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  // Members are a section of Workspace settings; the old address keeps working.
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/members$/);
  await expect(page.getByRole('heading', { name: 'Workspace settings', level: 2 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Workspace' })).toContainText('Household (Admin)');
  await expect(page.getByText('Your role: Admin')).toBeVisible();
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByRole('row')).toHaveCount(2);
  await expect(members.getByRole('cell', { name: 'admin@example.org' })).toBeVisible();
  await expectAccessible(page, 'members page');
  await page.getByLabel('Member email').fill('nobody@example.org');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/no active account/);
  await settingsSection(page, 'Workspace settings', 'General');
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]{36}\/settings$/);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Leave Workspace' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at least one active admin' })).toBeVisible();
  await expect(page.getByText('Your role: Admin')).toBeVisible();
  await expectAccessible(page, 'workspace settings');
  // The tools (15.1): a persistent sidebar on desktop.
  const sections = page.getByRole('navigation', { name: 'Tools' });
  await expect(sections.getByRole('link')).toHaveText(['Today', 'Procedures', 'Reminders', 'Lists', 'Calendar']);
  await sections.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
  await expect(page.getByText('Nothing needs attention right now.')).toBeVisible();
  await expect(sections.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page, 'empty Today');

  // Add (15.1): a chooser with what this person may create; Escape closes it and focus returns.
  const addButton = page.getByRole('button', { name: 'Add', exact: true });
  await addButton.click();
  const chooser = page.getByRole('dialog', { name: 'What would you like to add?' });
  await expect(chooser.getByRole('button')).toHaveText([/^$/, /Procedure.*Reusable steps/, /Reminder.*Remember one thing/, /Grocery list.*Quick shared shopping/]);
  await expectAccessible(page, 'add chooser');
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
  await expect(addButton).toBeFocused();
  await addButton.click();
  await chooser.getByRole('button', { name: /Procedure/ }).click();

  // The builder (15.2) opens at once: no date, no wizard, the global navigation steps aside.
  await expect(page).toHaveURL(/\/procedures\/new$/);
  await expect(sections).toBeHidden();
  const builderState = page.locator('.builder-state');
  await expect(builderState).toHaveText('Not saved yet');
  // Saving without a name: nothing is sent, the field says what is missing, nothing typed is lost.
  await page.getByPlaceholder('Add a step…').fill('Close windows');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(page.getByLabel('Procedure name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Please enter a title.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Step 1: Close windows/ })).toBeVisible();
  await expect(page).toHaveURL(/\/procedures\/new$/);
  await expectAccessible(page, 'builder with a validation error');
  await page.getByLabel('Procedure name').fill('Leave the house');
  await expect(builderState).toHaveText(/Unsaved changes/);
  // Leaving with unsaved changes asks first; declining stays, with everything in place.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('not saved');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Back to Procedures' }).click();
  await expect(page).toHaveURL(/\/procedures\/new$/);
  await expect(page.getByLabel('Procedure name')).toHaveValue('Leave the house');
  // Description, icon and tags are under Details.
  await page.getByText('Details', { exact: true }).click();
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
  // The first Section exists already ("Steps"); rename it. Enter adds Step after Step.
  await page.getByRole('button', { name: 'More for section Steps' }).click();
  await page.getByRole('button', { name: 'Rename or describe…' }).click();
  const sectionDialog = page.getByRole('dialog', { name: 'Section “Steps”' });
  await sectionDialog.getByLabel('Section name').fill('Ground floor');
  await sectionDialog.getByRole('button', { name: 'Apply' }).click();
  const addStepField = page.getByLabel('Add a step to Ground floor');
  await addStepField.fill('Turn off stove');
  await page.keyboard.press('Enter');
  await expect(addStepField).toBeFocused();
  await expect(addStepField).toHaveValue('');
  const outline = page.getByRole('list', { name: 'Ground floor' });
  await expect(outline.getByRole('listitem')).toHaveCount(2);
  // Paste multiple steps: a preview first; problems are named instead of cutting anything.
  await page.getByRole('button', { name: 'Paste multiple steps' }).click();
  const paste = page.getByRole('dialog', { name: 'Paste steps into “Ground floor”' });
  await paste.getByLabel('One step per line').fill(`- Lock the door\n\n2. ${'x'.repeat(201)}`);
  await expect(paste.getByRole('alert')).toContainText('Step 2 is too long: 201 characters, at most 200.');
  await expect(paste.getByRole('button', { name: 'Add 2 steps' })).toBeDisabled();
  await paste.getByLabel('One step per line').fill('- Lock the door\n\n2. Take the keys\n');
  await expect(paste.getByRole('list')).toHaveText('Lock the doorTake the keys');
  await expectAccessible(page, 'paste steps dialog');
  await paste.getByRole('button', { name: 'Add 2 steps' }).click();
  await expect(outline.getByRole('listitem')).toHaveCount(4);
  // Undo takes the pasted Steps back; Delete has Undo as well.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(outline.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'More for step 2: Turn off stove' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(outline.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: '“Turn off stove” deleted.' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(outline.getByRole('listitem')).toHaveText([/Close windows/, /Turn off stove/]);

  // The focused Step editor: a panel next to the outline. An instruction photo (14.3) needs a caption.
  await page.getByRole('button', { name: /^Step 1: Close windows/ }).click();
  const editor = page.getByRole('form', { name: 'Edit step' });
  await expect(editor.getByLabel('Step title')).toBeFocused();
  const chooserEvent = page.waitForEvent('filechooser');
  await editor.getByRole('button', { name: 'Choose photo' }).click();
  await (await chooserEvent).setFiles({ name: 'window.png', mimeType: 'image/png', buffer: photo() });
  await expect(editor.getByRole('button', { name: 'Replace photo' })).toBeVisible();
  await expect(editor.getByText(/Photos in this Workspace: [\d.]+ MB of 100 MB used\.$/)).toBeVisible();
  // Unapplied Step changes are named, and Save procedure waits for them.
  await expect(builderState).toHaveText(/Step has unapplied changes/);
  await expect(page.getByRole('button', { name: 'Save procedure' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Apply or cancel the open step first')).toBeVisible();
  await editor.getByRole('button', { name: 'Apply step' }).click();
  await expect(editor.getByText('Please describe what the photo shows.')).toBeVisible();
  await expectAccessible(page, 'step editor with a validation error');
  await editor.getByLabel('What the photo shows (Step 1)').fill('Blue handle on the left window');
  await expect(editor.getByRole('img', { name: 'Blue handle on the left window' })).toBeVisible();
  await editor.getByRole('button', { name: 'Apply step' }).click();
  await expect(editor).toHaveCount(0);
  // Focus returns to the Step in the outline.
  await expect(page.getByRole('button', { name: /^Step 1: Close windows/ })).toBeFocused();
  await expect(outline.getByRole('listitem').first().getByRole('img', { name: 'Has an instruction image' })).toBeVisible();

  // Cancel discards only what was not applied — after asking.
  await page.getByRole('button', { name: /^Step 2: Turn off stove/ }).click();
  await editor.getByLabel('Step title').fill('Something else');
  page.once('dialog', (dialog) => void dialog.accept());
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(outline.getByRole('listitem').nth(1)).toContainText('Turn off stove');
  // Rules: Critical with its explanation; reason policies under Advanced rules. Defaults are unchanged.
  await page.getByRole('button', { name: /^Step 2: Turn off stove/ }).click();
  await expect(editor.getByRole('switch', { name: 'Required' })).toBeChecked();
  await expect(editor.getByRole('switch', { name: 'Critical' })).not.toBeChecked();
  await expect(editor.getByRole('switch', { name: 'Critical' })).toHaveAccessibleDescription(/deliberate confirmation/);
  await editor.getByRole('switch', { name: 'Critical' }).check();
  await expect(editor.getByText('Skip: optional reason · N/A: optional reason')).toBeVisible();
  await editor.getByText('Advanced rules').click();
  await editor.getByLabel('When skipped').selectOption('REQUIRED');
  await expect(editor.getByText('Skip: required reason · N/A: optional reason')).toBeVisible();
  // Step icon with the keyboard only: grouped tiles, arrows move the choice, Enter closes (no submit).
  // A calm panel first (13.16): a few suggested icons, the complete catalog one click away.
  await page.getByRole('button', { name: 'Step icon: No icon — change' }).click();
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
  await expect(page.getByRole('button', { name: 'Step icon: Water — change' })).toBeFocused();
  await expect(editor).toBeVisible();
  // Back to the kitchen icon for the stove (search by name, pick with the pointer).
  await page.getByRole('button', { name: 'Step icon: Water — change' }).click();
  await page.getByLabel('Search icons').fill('kitchen');
  await page.getByTitle('Kitchen', { exact: true }).click();
  await expectAccessible(page, 'builder with the step editor');
  await editor.getByRole('button', { name: 'Apply step' }).click();
  await expect(outline.getByRole('listitem').nth(1)).toContainText('Critical');

  // Preview: the execution layout from the editor's content — no Run exists afterwards.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview' });
  await expect(preview).toContainText('Nothing is started, sent or saved here.');
  await expect(preview.getByRole('listitem').filter({ hasText: 'Turn off stove' })).toContainText('Pending');
  await expect(preview.getByRole('listitem').filter({ hasText: 'Turn off stove' }).getByRole('img', { name: 'Critical' })).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Skip' }).first()).toBeDisabled();
  await expectAccessible(page, 'procedure preview');
  await preview.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
  /** Reads from the API as the signed-in page (string form: the e2e files are type-checked without DOM types). */
  const apiJson = (path: string): Promise<unknown> => page.evaluate(`fetch(${JSON.stringify(path)}).then((response) => response.json())`);
  const workspaceApi = () => page.url().replace(/^.*\/w\/([0-9a-f-]{36})\/.*$/, '/api/workspaces/$1');
  expect(await apiJson(`${workspaceApi()}/runs`)).toMatchObject({ runs: [] });

  // Save: saving, then saved — at the Procedure's own address, with Start and Schedule at hand.
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(page).toHaveURL(/\/procedures\/[0-9a-f-]{36}\/edit$/);
  await expect(builderState).toHaveText(/Saved/);
  await expect(page.getByRole('button', { name: 'Start Leave the house' })).toBeVisible();
  // Phone: a dedicated full-screen Step editor; Preview and Save stay within reach; nothing scrolls sideways.
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  await expect(page.getByRole('button', { name: 'Save procedure' })).toBeInViewport();
  await expectAccessible(page, 'builder at 320 px');
  await page.getByRole('button', { name: /^Step 1: Close windows/ }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save procedure' })).toBeHidden();
  await expect(page.getByLabel('Procedure name')).toBeHidden();
  expect(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  expect((await editor.getByRole('button', { name: 'Apply step' }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expectAccessible(page, 'step editor at 320 px');
  // Back (the phone's button) returns to the outline, not out of the builder.
  await page.goBack();
  await expect(editor).toHaveCount(0);
  await expect(page).toHaveURL(/\/procedures\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByLabel('Procedure name')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Back to the Procedure' }).click();

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

  // Secondary actions are under ⋯ (13.15): Pin, Duplicate, Export, Knot link, Delete; Edit is a button of its own.
  const fromProcedureMenu = async (item: string) => {
    await procedure.getByRole('button', { name: /^More actions for / }).click();
    await procedure.getByRole('button', { name: item, exact: true }).click();
  };
  // On a phone the ⋯ button sits near the left edge: its menu must still open fully on screen.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await procedure.getByRole('button', { name: /^More actions for / }).click();
  for (const item of ['Duplicate', 'Export as archive (with images)']) {
    const box = await procedure.getByRole('button', { name: item, exact: true }).boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  }
  await page.keyboard.press('Escape');
  if (viewport !== null) await page.setViewportSize(viewport);
  // Edit in the builder: rename, move the stove Step to the top with the keyboard/touch alternative, save once.
  const stepIds = async () => {
    const id = /\/procedures\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    const detail = (await apiJson(`${workspaceApi()}/procedures/${id}`)) as { procedure: { sections: { id: string; title: string; steps: { id: string; title: string }[] }[] } };
    return Object.fromEntries(detail.procedure.sections.flatMap((section) => [[`section:${section.title}`, section.id] as const, ...section.steps.map((step) => [step.title, step.id] as const)]));
  };
  const idsBefore = await stepIds();
  await procedure.getByRole('link', { name: 'Edit' }).click();
  await expect(builderState).toHaveText('No changes');
  await page.getByLabel('Procedure name').fill('Leave the flat');
  await page.getByRole('button', { name: 'More for step 2: Turn off stove' }).click();
  await page.getByRole('button', { name: 'Move up' }).click();
  await expect(outline.getByRole('listitem')).toHaveText([/Turn off stove/, /Close windows/]);
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(builderState).toHaveText(/Saved/);
  await page.getByRole('button', { name: 'Back to the Procedure' }).click();
  await expect(procedure.getByRole('heading', { name: 'Travel Leave the flat' })).toBeVisible();
  await expect(steps.nth(0)).toContainText('Turn off stove');
  await expect(steps.nth(1)).toContainText('Close windows');

  // A new Section, then drag "Close windows" (step 2) onto it; duplicate a Step; one save.
  await procedure.getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Add section' }).click();
  const newSection = page.getByRole('dialog', { name: 'Add section' });
  await newSection.getByLabel('Section name').fill('Upstairs');
  await newSection.getByRole('button', { name: 'Add section' }).click();
  const rail = page.getByRole('navigation', { name: 'Sections' });
  await expect(rail.getByRole('button', { name: /Upstairs/ })).toHaveAttribute('aria-current', 'true');
  await rail.getByRole('button', { name: /Ground floor/ }).click();
  await page.getByTitle('Drag step 2').hover();
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await rail.getByRole('button', { name: /Upstairs/ }).hover();
  await rail.getByRole('button', { name: /Upstairs/ }).hover({ position: { x: 20, y: 10 } });
  await page.mouse.up();
  await expect(rail.getByRole('button', { name: /Upstairs/ })).toContainText('1 step');
  await expect(outline.getByRole('listitem')).toHaveText([/Turn off stove/]);
  // Keyboard and touch alternative: move it back with the ⋯ menu, then to Upstairs again through the Step editor.
  await rail.getByRole('button', { name: /Upstairs/ }).click();
  await page.getByRole('button', { name: 'More for step 1: Close windows' }).click();
  await page.getByRole('button', { name: 'Move to another section…' }).click();
  await page.getByRole('dialog', { name: 'Move “Close windows”' }).getByRole('button', { name: 'Move', exact: true }).click();
  await expect(outline.getByRole('listitem')).toHaveText([/Turn off stove/, /Close windows/]);
  await page.getByRole('button', { name: /^Step 2: Close windows/ }).click();
  await editor.getByLabel('Section').selectOption({ label: 'Upstairs' });
  await editor.getByRole('button', { name: 'Apply step' }).click();
  await expect(page.getByRole('list', { name: 'Upstairs' }).getByRole('listitem')).toHaveText([/Close windows/]);
  // Drag Section 2 onto Section 1: Upstairs comes first.
  await page.getByTitle('Drag to reorder: Upstairs').hover();
  await page.mouse.down();
  await page.mouse.move(10, 10);
  await page.getByTitle('Drag to reorder: Ground floor').hover();
  await page.getByTitle('Drag to reorder: Ground floor').hover({ position: { x: 5, y: 5 } });
  await page.mouse.up();
  await expect(rail.getByRole('button')).toHaveText([/Upstairs/, /Ground floor/, /Add section/]);
  // Duplicate, then remove the copy's Section-mate again: a populated Section asks before it is removed, and Undo brings it back.
  await rail.getByRole('button', { name: /Ground floor/ }).click();
  await page.getByRole('button', { name: 'More for step 1: Turn off stove' }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(outline.getByRole('listitem')).toHaveCount(2);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Remove the section “Ground floor” with its 2 steps?');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'More for section Ground floor' }).click();
  await page.getByRole('button', { name: 'Remove section' }).click();
  await expect(rail.getByRole('button')).toHaveText([/Upstairs/, /Add section/]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rail.getByRole('button')).toHaveText([/Upstairs/, /Ground floor/, /Add section/]);
  await rail.getByRole('button', { name: /Ground floor/ }).click();
  await page.getByRole('button', { name: 'More for step 2: Turn off stove' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Save procedure' }).click();
  await expect(builderState).toHaveText(/Saved/);
  // Editing and moving kept every id: the Sections and Steps are still the same ones.
  const idsAfter = await stepIds();
  expect(idsAfter['Turn off stove']).toBe(idsBefore['Turn off stove']);
  expect(idsAfter['Close windows']).toBe(idsBefore['Close windows']);
  expect(idsAfter['section:Ground floor']).toBe(idsBefore['section:Ground floor']);
  await page.getByRole('button', { name: 'Back to the Procedure' }).click();
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
  await procedure.getByRole('link', { name: 'Back to all Procedures' }).click();
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
  for (let i = 0; i < 2; i++) {
    await sections.getByRole('link', { name: 'Procedures' }).click();
    await page.getByRole('list', { name: 'Procedures' }).getByRole('link').first().click();
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
  // Today (15.1) puts unfinished executions first: both under Continue.
  await sections.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
  const activeRuns = page.getByRole('list', { name: 'Continue' });
  await expect(activeRuns.getByRole('listitem')).toHaveCount(2);
  await expect(activeRuns.getByRole('listitem').first()).toContainText('0 of 2 resolved');
  await expectAccessible(page, 'today with unfinished runs');

  // Execute: Done, Skip with a required reason, Undo.
  await activeRuns.getByRole('link').first().click();

  // A second device of the same person follows the Run live (6.1).
  const secondDevice = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const page2 = await secondDevice.newPage();
  await page2.goto('/');
  await page2.getByLabel('Email').fill('admin@example.org');
  await page2.getByLabel('Password').fill(PASSWORD);
  await page2.getByRole('button', { name: 'Sign in' }).click();
  await expect(page2.getByRole('button', { name: /^Settings/ })).toBeVisible();
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
  // The completed history stays reachable: from Today, from the Procedures menu, and at its old address.
  const toHistory = async () => {
    await sections.getByRole('link', { name: 'Today' }).click();
    await page.getByRole('navigation', { name: 'Elsewhere' }).getByRole('link', { name: 'Completed history' }).click();
    await expect(page).toHaveURL(/\/history$/);
  };
  await toHistory();
  await expect(page.getByRole('list', { name: 'Finished' })).toContainText('✔ 2 done');
  await expectAccessible(page, 'completed history');

  // Abort the other execution with a reason.
  await page.getByRole('button', { name: 'Go to Today' }).click();
  await page.getByRole('list', { name: 'Continue' }).getByRole('link').click();
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByLabel('Why is it aborted? (optional)').fill('Plans changed');
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  const aborted = run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' });
  await expect(aborted).toContainText('reason: Plans changed');
  await page.getByRole('button', { name: '← Today' }).click();
  await expect(page.getByRole('list', { name: 'Continue' })).toHaveCount(0);
  await toHistory();
  await expect(page.getByRole('list', { name: 'Finished' }).getByRole('listitem')).toHaveCount(2);
  // The Procedure card tells when it was last completed.
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' }).getByRole('listitem').first()).toContainText('Last completed');

  // Knot links (7.1): an entry link to a Procedure, shown once, that still requires signing in.
  await page.getByRole('list', { name: 'Procedures' }).getByRole('link').first().click();
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

  // Sharing links are a section of Workspace settings (15.1).
  await fromMenu(page, 'Workspace settings');
  await settingsSection(page, 'Workspace settings', 'Sharing links');
  await expect(page).toHaveURL(/\/knots$/);
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
  await card.getByRole('button', { name: 'More actions for Leave the flat' }).click();
  await card.getByRole('button', { name: 'Pin to the top (only for me)' }).click();
  await expect(card.getByRole('img', { name: 'Pinned (only for you)' })).toBeVisible();
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
    // Notifications are folded behind a summary that shows the default ("On the due date").
    await expect(dialog.locator('summary').last()).toHaveText(/Reminders\s*On the due date/);
    await dialog.locator('summary', { hasText: 'Reminders' }).click();
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

  // Today (15.1, 14.2): what is due today, with Start. Upcoming dates are not here — the Calendar has them.
  await sections.getByRole('link', { name: 'Today' }).click();
  const todayList = page.getByRole('list', { name: 'Today' });
  await expect(todayList.getByRole('listitem')).toHaveCount(1);
  await expect(todayList).toContainText('Today');
  await expect(todayList).toContainText('Shared');
  await expect(page.getByRole('list', { name: 'Upcoming' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Continue' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Elsewhere' })).toContainText('1 upcoming — Calendar');
  // Cards are concise: reminders and type are one tap away under ⋯ → Details.
  await expect(todayList).not.toContainText('Procedure · ');
  await todayList.getByRole('button', { name: 'More for Leave the flat' }).click();
  await todayList.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(todayList).toContainText('Procedure · Once');
  await expect(todayList).toContainText('No reminders');
  await expectAccessible(page, 'today with a due procedure');
  // Recently used Procedures (13.13) are with the Procedures now.
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await expect(page.getByRole('navigation', { name: 'Recently used' })).toContainText('Leave the flat');
  // The upcoming date in the Calendar: move it and end its schedule under ⋯.
  await sections.getByRole('link', { name: 'Calendar' }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const upcoming = page.locator('.calendar-agenda');
  if (localDate(4).slice(0, 7) !== localDate(0).slice(0, 7)) await page.getByRole('button', { name: 'Next month' }).click();
  await upcoming.getByRole('button', { name: 'More for Leave the flat' }).last().click();
  await upcoming.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(upcoming).toContainText('Reminders: 1 day before, 3 hours before, on the due date');
  await upcoming.getByRole('button', { name: 'More for Leave the flat' }).last().click();
  await upcoming.getByRole('button', { name: 'Move this date…' }).click();
  const move = page.getByRole('dialog', { name: 'Move “Leave the flat”' });
  await move.getByLabel('Date', { exact: true }).fill(localDate(5));
  await move.getByRole('button', { name: 'Save' }).click();
  await expect(move).toHaveCount(0);
  if (localDate(5).slice(0, 7) !== localDate(4).slice(0, 7)) await page.getByRole('button', { name: 'Next month' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await upcoming.getByRole('button', { name: 'More for Leave the flat' }).last().click();
  await upcoming.getByRole('button', { name: 'End schedule…' }).click();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await sections.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('navigation', { name: 'Elsewhere' })).not.toContainText('upcoming');
  // Start what is due today: a normal execution, linked to this date.
  await todayList.getByRole('button', { name: 'Start Leave the flat' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
  await expect(run.getByRole('heading', { name: 'Travel Leave the flat', level: 2 })).toBeVisible();
  // Phone (13.17): the Steps come first; history and sharing are folded away; the bottom bar steps aside.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSidewaysScroll()).toBe(true);
  await expect(run.locator('details.run-more')).not.toHaveAttribute('open');
  await expect(run.getByRole('region', { name: 'Execution history' })).toBeHidden();
  await expect(page.locator('.tab-bar')).toBeHidden();
  await expectAccessible(page, 'run view on a phone, started from Today');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '← Today' }).click();
  // The date shows its execution under Continue instead of a second Start.
  const continueList = page.getByRole('list', { name: 'Continue' });
  await expect(continueList).toContainText('In progress — started by Ada Admin');
  await expect(continueList.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Today' })).toHaveCount(0);
  await continueList.getByRole('link', { name: 'Continue Leave the flat' }).click();
  await run.getByRole('button', { name: 'Abort…' }).click();
  await run.getByRole('button', { name: 'Abort', exact: true }).click();
  await expect(run.getByRole('status').filter({ hasText: 'Aborted by Ada Admin' })).toBeVisible();
  // Aborted: the date is open again (Start), nothing was completed.
  await page.getByRole('button', { name: '← Today' }).click();
  await expect(page.getByRole('list', { name: 'Today' }).getByRole('button', { name: 'Start Leave the flat' })).toBeVisible();

  // A standalone Reminder (14.1, 15.3) from Add: what and when first; repetition, responsible person and
  // notifications behind summaries that show their (unchanged) defaults.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'What would you like to add?' }).getByRole('button', { name: /Reminder/ }).click();
  await expect(page).toHaveURL(/\/reminders\/new$/);
  const newReminder = page.getByRole('dialog', { name: 'New reminder' });
  await expect(newReminder.getByLabel('What')).toBeFocused();
  await expect(newReminder.locator('summary')).toHaveText([/Notes\s*None/, /Repeat\s*Once/, /Responsible\s*Shared \(anyone\)/, /Reminders\s*On the due date/]);
  await expect(newReminder.getByLabel('On fixed dates')).toBeHidden();
  await newReminder.getByLabel('What').fill('Pay annual tax');
  await newReminder.getByLabel('Date', { exact: true }).fill(localDate(0));
  await newReminder.locator('summary', { hasText: 'Repeat' }).click();
  await newReminder.getByLabel('On fixed dates').check();
  await newReminder.getByLabel('Unit', { exact: true }).selectOption({ label: 'years' });
  await expect(newReminder).toContainText('Dates stay fixed, even when one is done late.');
  await expect(newReminder.locator('summary').nth(1)).toContainText('Every year');
  await newReminder.locator('summary', { hasText: 'Responsible' }).click();
  await newReminder.getByLabel('Responsible').selectOption({ label: 'Ada Admin' });
  await newReminder.locator('summary', { hasText: 'Reminders' }).click();
  await newReminder.getByLabel('1 month before').check();
  await expectAccessible(page, 'new reminder dialog');
  await newReminder.getByRole('button', { name: 'Create reminder' }).click();
  await expect(newReminder).toHaveCount(0);
  // Reminders have their own tool; Scheduled Procedures are not listed there.
  await expect(page).toHaveURL(/\/reminders$/);
  await expect(sections.getByRole('link', { name: 'Reminders' })).toHaveAttribute('aria-current', 'page');
  const reminderToday = page.getByRole('list', { name: 'Today' }).getByRole('listitem');
  await expect(reminderToday).toHaveCount(1);
  await expect(reminderToday).toContainText('Pay annual tax');
  await expect(reminderToday).toContainText('Assigned to Ada Admin');
  await expectAccessible(page, 'reminders');
  await sections.getByRole('link', { name: 'Today' }).click();
  const taxToday = page.getByRole('list', { name: 'Today' }).getByRole('listitem').filter({ hasText: 'Pay annual tax' });
  await expect(taxToday).toContainText('Assigned to Ada Admin');
  // Filters: assigned to me shows it, shared hides it.
  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  await expect(taxToday).toHaveCount(0);
  await page.getByRole('button', { name: 'Assigned to me' }).click();
  await expect(taxToday).toHaveCount(1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  // Done, with Undo right there; completed activity itself is under Reminders → Recently done.
  await taxToday.getByRole('button', { name: 'Complete Pay annual tax' }).click();
  await expect(page.getByRole('status').filter({ hasText: '“Pay annual tax” is done.' })).toBeVisible();
  await expect(taxToday).toHaveCount(0);
  await expectAccessible(page, 'today with an undo notice');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(taxToday).toHaveCount(1);
  await taxToday.getByRole('button', { name: 'Complete Pay annual tax' }).click();
  await sections.getByRole('link', { name: 'Reminders' }).click();
  await page.getByText('Recently done (1)').click();
  const doneList = page.getByRole('list', { name: 'Recently done' });
  await expect(doneList).toContainText('Completed by Ada Admin');
  await doneList.getByRole('button', { name: 'Undo Pay annual tax' }).click();
  const taxReminder = page.getByRole('list', { name: 'Today' }).getByRole('listitem').filter({ hasText: 'Pay annual tax' });
  await expect(taxReminder).toHaveCount(1);
  // Skip shows what happens next; the history keeps it.
  await taxReminder.getByRole('button', { name: 'More for Pay annual tax' }).click();
  await taxReminder.getByRole('button', { name: 'Skip…' }).click();
  const skip = page.getByRole('dialog', { name: /^Skip “Pay annual tax”/ });
  await expect(skip).toContainText('the next dates are not affected');
  await skip.getByLabel('Reason').fill('Paid in advance');
  await skip.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByText('Recently done (1)').click();
  await expect(page.getByRole('list', { name: 'Recently done' })).toContainText('Skipped by Ada Admin');

  // Grocery lists (15.3): a working shared list — name it, add items with optional quantity and unit,
  // tick what is bought, take it back, edit, remove. No Start, no Required/Critical, no Skip or N/A.
  await sections.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('dialog', { name: 'What would you like to add?' }).getByRole('button', { name: /Grocery list/ }).click();
  await expect(page).toHaveURL(/\/lists\/new$/);
  const newList = page.getByRole('dialog', { name: 'New grocery list' });
  await newList.getByLabel('Name').fill('Groceries');
  await newList.getByRole('button', { name: 'Create list' }).click();
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Groceries', level: 2 })).toBeVisible();
  await expect(page.getByText('Nothing on this list yet.')).toBeVisible();
  await expectAccessible(page, 'empty grocery list');
  const itemField = page.getByLabel('Item', { exact: true });
  await itemField.fill('Milk');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByLabel('Unit', { exact: true }).fill('l');
  await page.keyboard.press('Enter');
  const toBuy = page.getByRole('list', { name: 'To buy' });
  await expect(toBuy.getByRole('listitem')).toHaveText([/Milk\s*2 l/]);
  await expect(itemField).toBeFocused();
  await expect(itemField).toHaveValue('');
  // A quantity that is not a number: the message sits at the field and nothing typed is lost.
  await itemField.fill('Bread');
  await page.getByLabel('Quantity', { exact: true }).fill('some');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'The quantity must be a number above 0' })).toBeVisible();
  await expect(page.getByLabel('Quantity', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(itemField).toHaveValue('Bread');
  await expectAccessible(page, 'grocery list with a validation error');
  await page.getByLabel('Quantity', { exact: true }).fill('');
  await page.keyboard.press('Enter');
  await expect(toBuy.getByRole('listitem')).toHaveCount(2);
  for (const text of ['Required', 'Critical', 'Skip', 'Not applicable', 'Start']) await expect(page.getByRole('main').getByRole('button', { name: text })).toHaveCount(0);
  // A second member's device: both see each other's changes without reloading.
  const shopper = await browser.newContext(testInfo.project.use.baseURL === undefined ? {} : { baseURL: testInfo.project.use.baseURL });
  const shopperPage = await shopper.newPage();
  await shopperPage.goto('/');
  await shopperPage.getByLabel('Email').fill('admin@example.org');
  await shopperPage.getByLabel('Password').fill(PASSWORD);
  await shopperPage.getByRole('button', { name: 'Sign in' }).click();
  await expect(shopperPage.getByRole('button', { name: /^Settings/ })).toBeVisible();
  await shopperPage.setViewportSize({ width: 390, height: 844 });
  await shopperPage.goto(page.url());
  // (A click, not check(): the item leaves for the folded Purchased group at once.)
  await shopperPage.getByRole('checkbox', { name: /Milk/ }).click();
  await expect(shopperPage.getByRole('status').filter({ hasText: '“Milk” purchased.' })).toBeVisible();
  // Purchased items move into a group that folds away; the touch target is large enough.
  expect((await shopperPage.getByRole('checkbox', { name: /Bread/ }).locator('xpath=..').boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await shopperPage.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  await expectAccessible(shopperPage, 'grocery list on a phone with an undo notice');
  await expect(page.getByText('Purchased (1)')).toBeVisible({ timeout: 20_000 });
  await expect(toBuy.getByRole('listitem')).toHaveText([/Bread/]);
  await page.getByText('Purchased (1)').click();
  await expect(page.getByRole('list', { name: 'Purchased (1)' })).toContainText('Ada Admin');
  // Undo on the phone: Milk is to buy again, on both devices.
  await shopperPage.getByRole('button', { name: 'Undo' }).click();
  await expect(shopperPage.getByRole('list', { name: 'To buy' }).getByRole('listitem')).toHaveCount(2);
  await expect(toBuy.getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });
  // Both edit the same item: the second edit is refused instead of silently replacing the first.
  await page.getByRole('button', { name: 'More for Bread' }).click();
  await page.getByRole('button', { name: 'Edit…' }).click();
  const editItem = page.getByRole('dialog', { name: 'Edit “Bread”' });
  await shopperPage.getByRole('button', { name: 'More for Bread' }).click();
  await shopperPage.getByRole('button', { name: 'Edit…' }).click();
  const editOnPhone = shopperPage.getByRole('dialog', { name: 'Edit “Bread”' });
  await editOnPhone.getByLabel('Item', { exact: true }).fill('Rye bread');
  await editOnPhone.getByRole('button', { name: 'Save' }).click();
  await expect(editOnPhone).toHaveCount(0);
  await editItem.getByLabel('Item', { exact: true }).fill('White bread');
  await editItem.getByRole('button', { name: 'Save' }).click();
  await expect(editItem.getByRole('alert')).toContainText('Someone else changed this just now.');
  await editItem.getByRole('button', { name: 'Cancel' }).click();
  await expect(toBuy.getByRole('listitem').filter({ hasText: 'Rye bread' })).toHaveCount(1);
  await shopper.close();
  // Remove with Undo; rename; the list shows on Today while something is left to buy.
  await page.getByRole('button', { name: 'More for Rye bread' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(toBuy.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(toBuy.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'More for the list Groceries' }).click();
  await page.getByRole('button', { name: 'Rename list…' }).click();
  await page.getByRole('dialog', { name: 'Rename list' }).getByLabel('Name').fill('Weekly shop');
  await page.getByRole('dialog', { name: 'Rename list' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly shop', level: 2 })).toBeVisible();
  await expectAccessible(page, 'grocery list');
  await sections.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('list', { name: 'To buy' })).toContainText('Weekly shop');
  await expect(page.getByRole('list', { name: 'To buy' })).toContainText('2 to buy');
  await page.getByRole('link', { name: 'Open list Weekly shop' }).click();
  // Delete the list and take that back from the overview.
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'More for the list Weekly shop' }).click();
  await page.getByRole('button', { name: 'Delete list' }).click();
  await expect(page).toHaveURL(/\/lists$/);
  await expect(page.getByText('No lists yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('link', { name: 'Open list Weekly shop' })).toContainText('2 to buy');
  await expectAccessible(page, 'lists');

  // Phone navigation (15.1): four labelled destinations at the bottom; More leads to Reminders, Calendar and history.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sections.getByRole('link')).toHaveText(['Today', 'Procedures', 'Lists', 'More']);
  await expect(sections.getByRole('link', { name: 'Lists' })).toHaveAttribute('aria-current', 'page');
  for (const link of await sections.getByRole('link').all()) expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await sections.getByRole('link', { name: 'More' }).click();
  await expect(page.getByRole('main').getByRole('link')).toHaveText([/Reminders/, /Calendar/, /Completed history/, /VergissMeinNicht/, /AGPL/]);
  await expectAccessible(page, 'more page on a phone');
  await page.getByRole('main').getByRole('link', { name: /Reminders/ }).click();
  await expect(page).toHaveURL(/\/reminders$/);
  await expect(sections.getByRole('link', { name: 'More' })).toHaveAttribute('aria-current', 'page');
  await sections.getByRole('link', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expectAccessible(page, 'add sheet on a phone');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Calendar (14.4): the Occurrences Home shows, with the same actions; planned dates of a series;
  // filters remembered per viewer; arrow keys between days; an agenda that fits a phone.
  await sections.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  const day = page.locator('section[aria-labelledby="calendar-day-heading"]');
  const dayButton = (date: string) => page.locator(`button[data-date="${date}"]`);
  await expect(dayButton(localDate(0))).toHaveAttribute('aria-current', 'date');
  await expect(dayButton(localDate(0))).toHaveAttribute('aria-pressed', 'true');
  await expect(dayButton(localDate(0))).toHaveAccessibleName(/^Today · .+: \d+ entries$/);
  await expect(day).toContainText('Skipped by Ada Admin on ');
  await expect(day).toContainText('Reason: Paid in advance');
  await expect(day.getByRole('button', { name: 'Start Leave the flat' })).toBeVisible();
  await expectAccessible(page, 'calendar month view');
  // Filters are folded away until used; with a remembered filter they open by themselves.
  await page.getByText('Filters', { exact: true }).click();
  await page.getByLabel('Skipped').uncheck();
  await expect(day).not.toContainText('Pay annual tax');
  await page.getByLabel('Skipped').check();
  await page.getByLabel('Type').selectOption({ label: 'Procedures' });
  await expect(day).not.toContainText('Pay annual tax');
  await expect(day).toContainText('Leave the flat');
  await page.reload();
  await expect(page.getByText('Filters · some entries are hidden')).toBeVisible();
  await expect(page.getByLabel('Type')).toHaveValue('PROCEDURE');
  await page.getByLabel('Type').selectOption({ label: 'Reminders and Procedures' });
  await page.getByLabel('Responsible').selectOption({ label: 'Shared' });
  await expect(day).not.toContainText('Pay annual tax');
  await page.getByLabel('Responsible').selectOption({ label: 'Assigned to me' });
  await expect(day).toContainText('Pay annual tax');
  await expect(day).not.toContainText('Leave the flat');
  await page.getByLabel('Responsible').selectOption({ label: 'Anyone' });
  await dayButton(localDate(0)).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dayButton(localDate(1))).toBeFocused();
  await expect(dayButton(localDate(1))).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(dayButton(localDate(0))).toBeFocused();
  // A year ahead: the yearly Reminder is planned there — shown, with nothing to act on.
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Next month' }).click();
  const inAYear = new Date();
  inAYear.setFullYear(inAYear.getFullYear() + 1);
  await expect(page.locator('#calendar-month')).toHaveText(new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(inAYear));
  await dayButton(`${inAYear.getFullYear()}${localDate(0).slice(4)}`).click();
  await expect(day).toContainText('Pay annual tax');
  await expect(day).toContainText('Planned for');
  await expect(day.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const agenda = page.locator('.calendar-agenda');
  await expect(agenda).toContainText('Planned for');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(agenda).toContainText('Leave the flat');
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  await expectAccessible(page, 'calendar agenda at phone width');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(dayButton(localDate(0))).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  if (desktopViewport !== null) await page.setViewportSize(desktopViewport);
  // Undo and Complete from the calendar: Home shows the same.
  await agenda.getByRole('button', { name: 'Undo Pay annual tax' }).click();
  await agenda.getByRole('button', { name: 'Complete Pay annual tax' }).click();
  await expect(agenda).toContainText('Completed by Ada Admin on ');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await sections.getByRole('link', { name: 'Reminders' }).click();
  await page.getByText('Recently done (1)').click();
  await expect(page.getByRole('list', { name: 'Recently done' })).toContainText('Completed by Ada Admin');

  // Server admin: the size of Recent (13.13) and the notification providers (13.7).
  await fromMenu(page, 'Server admin');
  await settingsSection(page, 'Server administration', 'Server & storage');
  await expect(page.getByLabel('Recently used Procedures')).toHaveValue('5');
  await page.getByLabel('Recently used Procedures').fill('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The Procedures page shows no recently used Procedures.' })).toBeVisible();
  await settingsSection(page, 'Server administration', 'Notification providers');
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
  await page.goto('/'); // the start page opens the last Workspace's Today
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await expect(page.getByRole('list', { name: 'Procedures' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Recently used' })).toHaveCount(0);
  await fromMenu(page, 'Server admin');
  await settingsSection(page, 'Server administration', 'Server & storage');
  await expect(page.getByLabel('Recently used Procedures')).toHaveValue('0');
  await page.getByLabel('Recently used Procedures').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'The Procedures page shows 5 recently used Procedures.' })).toBeVisible();

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
  await card.getByRole('button', { name: 'More actions for Leave the flat' }).click();
  await card.getByRole('button', { name: 'Unpin', exact: true }).click();
  await expect(card.getByRole('img', { name: 'Pinned (only for you)' })).toHaveCount(0);

  // Profile & settings (15.1): named sections instead of one long page.
  await fromMenu(page, 'Profile & settings');
  await expect(page.getByRole('navigation', { name: 'Profile & settings' }).getByRole('link')).toHaveText(['Notifications', 'Appearance', 'Password & security', 'Confirmations']);
  await expect(page.getByRole('radio', { name: /^Dark/ })).toHaveCount(0);
  await settingsSection(page, 'Profile & settings', 'Appearance');
  await expect(page).toHaveURL(/\/account\/appearance$/);

  // Appearance (8.3): the theme choice applies at once and survives a reload.
  const html = page.locator('html');
  await page.getByRole('radio', { name: /^Dark/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 14, 16)');
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
  await settingsSection(page, 'Profile & settings', 'Confirmations');
  await page.getByRole('radio', { name: /^Tap, then confirm/ }).check();
  await expect(page.getByRole('radio', { name: /^Tap, then confirm/ })).toBeChecked();
  await page.goto('/');
  await sections.getByRole('link', { name: 'Procedures' }).click();
  await page.getByRole('list', { name: 'Procedures' }).getByRole('link').first().click();
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
  await expect(otherPage.getByRole('button', { name: /^Settings/ })).toBeVisible();
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
  await settingsSection(page, 'Profile & settings', 'Confirmations');
  await page.getByRole('radio', { name: /^Press and hold/ }).check();

  // Enable TOTP: password, QR code + key, confirmation code, recovery codes.
  await settingsSection(page, 'Profile & settings', 'Password & security');
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
  await expect(secondTab.getByRole('button', { name: /^Settings/ })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();

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
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible();
  await fromMenu(page, 'Profile & settings');
  await settingsSection(page, 'Profile & settings', 'Password & security');
  await expect(page.getByText('Status: Not enabled')).toBeVisible();

  await fromMenu(page, 'Sign out');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(cspViolations).toEqual([]);
});

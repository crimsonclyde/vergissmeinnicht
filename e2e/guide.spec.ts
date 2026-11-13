import { crc32, deflateSync } from 'node:zlib';
import { checkPhoneRecipe, checkRecipeSourcePreservation } from './phone-recipe.ts';
import { checkClockWeather, expectSharedSkySurface } from './clock-weather.ts';
import {checkPhoneJournal} from './phone-journal.ts';
import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { hashPassword } from '../packages/auth/src/password-hashing.ts';
import { openDatabase } from '../packages/database/src/connection.ts';
import { createUserRepository } from '../packages/database/src/user-repository.ts';
import { enableCoreTools, insertLegacyProcedure, insertLegacyRun, insertLegacyWorkspace } from '../packages/database/src/test-support.ts';
import { normalizeEmail } from '../packages/domain/src/user.ts';
import { DEFAULT_PLACE_PREFERENCES } from '../packages/domain/src/places.ts';
import { guideServerEnv } from '../playwright.config.ts';
import { expectAccessible } from './a11y.ts';

/** Separate disposable users still share a loopback client: honor the real sign-in limit. */
async function signInGuide(page: Page) {
  const password = await page.getByLabel('Password').inputValue();
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = page.waitForResponse(response => response.url().endsWith('/api/auth/sign-in') && response.request().method() === 'POST');
    await page.getByRole('button', {name:'Sign in',exact:true}).click();
    const result = await response;
    if (result.status() !== 429) { expect(result.ok()).toBe(true); return; }
    if (attempt === 2) throw new Error('Guide sign-in remained throttled after Retry-After');
    const delay = Math.min(60_000, Math.max(1000, Number(result.headers()['retry-after'] ?? 60) * 1000));
    await page.waitForTimeout(delay);
    await page.getByLabel('Password').fill(password);
  }
}

test('Management pages use Memento Mori and preserve the Workspace theme', async ({ page }) => {
  const email = `settings-theme-${randomUUID()}@example.org`;
  const password = 'a fictional settings theme passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Settings reviewer', emailVerified: true, status: 'ACTIVE', serverAdmin: true });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
    workspaceId = insertLegacyWorkspace(database, { name: 'Settings studio', adminUserId: user.id }).id;
    enableCoreTools(database, workspaceId, user.id);
  } finally { database.close(); }
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await signInGuide(page);
  await expect(page).toHaveURL(`/w/${workspaceId}`);
  const html = page.locator('html');
  const settings = page.getByRole('button', { name: /^Settings/ });
  async function openSettings(name: string | RegExp) {
    await settings.click();
    await page.getByRole('link', { name, exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'memento-mori');
  }

  await openSettings('Profile & settings');
  await page.getByRole('navigation', { name: 'Profile & settings' }).getByRole('link', { name: 'Appearance', exact: true }).click();
  await page.getByRole('radio', { name: /^Triora/ }).check();
  await expect(html).toHaveAttribute('data-theme', 'memento-mori');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#141111');
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(html).toHaveAttribute('data-place', 'it');
  await openSettings('Workspace settings');
  await expect(html).not.toHaveAttribute('data-place', 'it');
  await page.goBack();
  await expect(html).toHaveAttribute('data-place', 'it');
  await openSettings(/^Server admin/);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'memento-mori');
  await expect(page.getByRole('navigation', { name: 'Server administration' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(html).toHaveAttribute('data-place', 'it');
});

// Direct fixture setup is limited to the disposable Playwright database; browser commands use real APIs.
test('Guide preserves routes, preferences, themes and private opt-in weather across desktop and phone', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const email = `guide-${randomUUID()}@example.org`;
  const password = 'a fictional guide review passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Guide reviewer', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
    workspaceId = insertLegacyWorkspace(database, { name: 'Fictional Guide studio', adminUserId: user.id }).id;
    enableCoreTools(database, workspaceId, user.id);
    const enableTool = database.sqlite.prepare('INSERT INTO workspace_tools (workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,?,1,?,?)');
    for (const tool of ['MOON', 'RECIPES', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'BRING', 'JOURNAL']) {
      enableTool.run(workspaceId, tool, Date.now(), user.id);
    }
    database.sqlite.prepare('UPDATE workspaces SET location=? WHERE id=?').run(JSON.stringify({ name: 'Fictional studio', latitude: 48.14, longitude: 11.58, timeZone: 'Europe/Berlin', elevation: null }), workspaceId);
    const procedure = insertLegacyProcedure(database, { workspaceId, userId: user.id, title: 'Close the Northstar studio', steps: [{ title: 'Check the windows' }, { title: 'Switch off the workbench' }, { title: 'Set the alarm' }] });
    insertLegacyRun(database, { workspaceId, procedureId: procedure.id, user });
  } finally { database.close(); }
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Content Security Policy')) errors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page);
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  await page.goto(`/w/${workspaceId}`);
  const shell = page.locator('.shell');
  await expect(shell).toHaveAttribute('data-layout', 'guide');
  await expect(page.getByRole('heading', { name: /^Dashboard/ })).toBeVisible();
  expect(requests.filter(url => url.includes('/api/account/weather/forecast'))).toEqual([]);
  const post = async (path: string, body: unknown) => page.evaluate(async ({ path, body }) => { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }, { path, body });
  expect((await post('/api/account/preferences', { theme: 'space-guide', navigationOrder: ['LISTS', 'CALENDAR', 'PROCEDURES'] })).status).toBe(200);
  const list = await post(`/api/workspaces/${workspaceId}/lists`, { title: 'Groceries in space' });
  expect(list.status).toBe(201);
  const listId = (list.data as { list: { id: string } }).list.id;
  expect((await post(`/api/workspaces/${workspaceId}/lists/${listId}/items`, { title: 'Tea bags' })).status).toBe(201);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'space-guide');
  const nav = page.getByRole('navigation', { name: 'Tools', exact: true });
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('link', { name: 'Profile & settings', exact: true })).toBeVisible();
  await expectAccessible(page, 'Guide top settings menu');
  await page.keyboard.press('Escape');
  // The menu bar is the desktop navigation; the phone project checks the bar and drawer below.
  if ((page.viewportSize()?.width ?? 0) > 900) {
    // The menu bar (42): Dashboard, then one drop-down per family; the person's order counts inside each.
    await expect(nav.getByRole('link')).toHaveText(['Dashboard']);
    await expect(nav.getByRole('button')).toHaveText(['Plan', 'Shop & cook', 'House']);
    const plan = nav.getByRole('button', { name: 'Plan', exact: true });
    const shop = nav.getByRole('button', { name: 'Shop & cook', exact: true });
    const house = nav.getByRole('button', { name: 'House', exact: true });
    await plan.click();
    await expect(plan).toHaveAttribute('aria-expanded', 'true');
    const planMenu = nav.getByRole('list', { name: 'Plan', exact: true });
    await expect(planMenu.getByRole('link')).toHaveText(['Calendar', 'Procedures', 'Reminders', 'Completed history']);
    await expectAccessible(page, 'Menu bar with an open menu');
    // Like a Mac menu bar: once a menu is open, pointing at a neighbour opens that one instead.
    await shop.hover();
    await expect(planMenu).toBeHidden();
    await expect(nav.getByRole('list', { name: 'Shop & cook', exact: true }).getByRole('link')).toHaveText(['Lists', 'Bring', 'Recipes']);
    await house.hover();
    await expect(nav.getByRole('list', { name: 'House', exact: true }).getByRole('link')).toHaveText(['Notes', 'Documents', 'Contacts', 'Maintenance']);
    await expect(nav.getByRole('link', { name: 'Equipment', exact: true })).toHaveCount(0);
    await page.mouse.click(5, 600);
    await expect(house).toHaveAttribute('aria-expanded', 'false');
    // Keyboard: Down opens and enters a menu, Left/Right move between menus, Escape returns to the title.
    await plan.focus();
    await page.keyboard.press('ArrowDown');
    await expect(planMenu.getByRole('link', { name: 'Calendar', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(planMenu.getByRole('link', { name: 'Completed history', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(nav.getByRole('list', { name: 'Shop & cook', exact: true }).getByRole('link', { name: 'Lists', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(shop).toBeFocused();
    await expect(shop).toHaveAttribute('aria-expanded', 'false');
    await shop.click(); await nav.getByRole('link', { name: 'Recipes', exact: true }).click();
    await expect(page).toHaveURL(`/w/${workspaceId}/recipes`);
    await expect(shop).toHaveAttribute('data-current', 'true');
    await expect(nav.getByRole('list', { name: 'Shop & cook', exact: true })).toBeHidden();
    await page.goBack(); await expect(page).toHaveURL(`/w/${workspaceId}`);
    await shop.click(); await nav.getByRole('link', { name: 'Lists', exact: true }).click();
    await expect(page).toHaveURL(`/w/${workspaceId}/lists`);
    await expectAccessible(page, 'Guide List working page');
    await page.goBack(); await expect(page).toHaveURL(`/w/${workspaceId}`);
  }
  // Phones: Dashboard, the two favourites and All tools; the drawer holds every tool in the same families.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Guide test requires a viewport');
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(nav.getByRole('link')).toHaveText(['Dashboard', 'Lists', 'Calendar']);
  const allTools = nav.getByRole('button', { name: 'All tools', exact: true });
  await allTools.click();
  const drawer = page.getByRole('dialog', { name: 'All tools', exact: true });
  await expect(drawer.getByRole('heading', { level: 3 })).toHaveText(['Plan', 'Shop & cook', 'House', 'Instruments']);
  await expect(drawer.getByRole('link', { name: 'Equipment', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('link', { name: 'Lists', exact: true })).toBeVisible();
  await expect.poll(() => drawer.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
  await expect(drawer.locator('img')).toHaveCount(0);
  await expectAccessible(page, 'Tool drawer');
  mkdirSync(process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42', { recursive: true });
  await page.screenshot({ path: `${process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42'}/chooser-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(allTools).toBeFocused();
  // A swipe up from the bar opens it too.
  const bar = await nav.boundingBox();
  if (!bar) throw new Error('Phone bar is missing');
  await page.evaluate(`(() => {
    const element = document.querySelector('.tab-bar');
    const touch = (clientY) => new Touch({ identifier: 1, target: element, clientX: 160, clientY });
    element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(${bar.y + 20})] }));
    element.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [touch(${bar.y - 80})] }));
  })()`);
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'Recipes', exact: true }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/recipes`);
  await expect(drawer).toBeHidden();
  await expect(allTools).toHaveAttribute('data-current', 'true');
  await page.goBack(); await expect(page).toHaveURL(`/w/${workspaceId}`);
  await page.setViewportSize(viewport);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expectAccessible(page, `Guide Today ${width}`);
  }
  mkdirSync(process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42'}/today-${testInfo.project.name}.png`, fullPage: true });
  await page.goto('/account/appearance');
  await page.getByRole('button', { name: 'Fictional Guide studio', exact: true }).click();
  const layoutForm = page.locator('.guide-form');
  await layoutForm.getByLabel('Card background', { exact: true }).selectOption('starfield');
  await layoutForm.getByRole('slider').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 28; i++) await page.keyboard.press('ArrowRight');
  await layoutForm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(layoutForm.getByRole('status')).toHaveText('Saved for this Workspace.');
  await layoutForm.getByLabel('Card background', { exact: true }).selectOption('forest');
  await layoutForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(layoutForm.getByLabel('Card background', { exact: true })).toHaveValue('starfield');
  await layoutForm.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(layoutForm.getByRole('slider')).toHaveValue('50');
  await layoutForm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(layoutForm.getByRole('slider')).toHaveValue('28');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.evaluate('window.scrollTo(0,0)');
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expectAccessible(page, `Compact Appearance at ${width}`);
  }
  await page.goto(`/w/${workspaceId}`);
  await expect(shell).toHaveAttribute('data-card-style', 'starfield');
  await page.goto('/account/appearance');
  await page.getByRole('button', { name: 'Fictional Guide studio', exact: true }).click();
  await expect(layoutForm.getByRole('slider')).toHaveValue('28');
  await layoutForm.getByLabel('Sidebar (Existing interface)', { exact: true }).check();
  await layoutForm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(layoutForm.getByRole('status')).toHaveText('Saved for this Workspace.');
  await page.goto(`/w/${workspaceId}`);
  await expect(shell).toHaveAttribute('data-layout', 'classic');
  await page.goto('/account/appearance');
  await page.getByRole('button', { name: 'Fictional Guide studio', exact: true }).click();
  await layoutForm.getByLabel('Top bar (Galactic Guide)', { exact: true }).check();
  await layoutForm.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(layoutForm.getByRole('status')).toHaveText('Saved for this Workspace.');
  await page.goto(`/w/${workspaceId}`);
  await expect(shell).toHaveAttribute('data-layout', 'guide');
  await page.route('**/api/account/weather/forecast?*', route => route.fulfill({ json: { forecast: { provider: 'OPEN_METEO', current: { condition: 'SNOW', temperature: -1 }, days: [{ date: '2026-11-03', condition: 'SNOW', min: -3, max: 2, precipitationProbabilityMax: 40, precipitationSum: 1.2, windSpeedMax: 14 }] }, horizon: 1, history: [], location: { name: 'Fictional studio', timeZone: 'Europe/Berlin' }, fetchedAt: new Date().toISOString(), stale: false, fellBackFrom: null, unit: 'C', showTomorrow: false } }));
  expect((await post('/api/account/today', { layout: { version: 1, density: 'COMPACT', cards: [
    { id: 'clock', visible: true, size: 'NORMAL', options: { hour24: false } },
    { id: 'weather', visible: true, size: 'NORMAL', options: {} },
    { id: 'toBuy', visible: true, size: 'NORMAL', options: { lists: 3 } },
  ] } })).status).toBe(200);
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByRole('link', { name: 'Weather in Fictional studio' })).toBeVisible();
  await checkClockWeather(page, workspaceId, testInfo.project.name === 'guide-desktop-chromium');
  for (const theme of ['system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland', 'space-guide']) {
    expect((await post('/api/account/preferences', { theme })).status).toBe(200);
    const paints = new Set<string>();
    for (const opacity of [0, 50, 100]) {
      if (theme.startsWith('places-')) {
        expect((await post(`/api/account/places/${workspaceId}`, { preferences: { ...DEFAULT_PLACE_PREFERENCES, cardOpacity: opacity } })).status).toBe(200);
      } else {
        expect((await post('/api/account/workspace-preferences/guide', { workspaceId, guide: { cardOpacity: opacity } })).status).toBe(200);
      }
      await page.reload();
      await expect(page.getByRole('navigation', { name: 'Tools', exact: true })).toBeVisible();
      await expect(page.locator('.today-instruments')).toHaveCSS('--sky-card-opacity', `${opacity}%`);
      await expectSharedSkySurface(page);
      paints.add(await page.locator('.today-instruments').evaluate(node => node.ownerDocument.defaultView?.getComputedStyle(node).backgroundColor ?? 'missing'));
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
        await expectAccessible(page, `Guide theme ${theme}, opacity ${opacity}, width ${width}`);
        if (process.env.VMN_REVIEW_SCREENSHOTS && testInfo.project.name === 'guide-desktop-chromium' && ['space-guide', 'tokyo-nights', 'witch-forest'].includes(theme)) {
          const top = await page.locator('.today-instruments').boundingBox();
          const bottom = await page.locator('.today-moon').boundingBox();
          if (top === null || bottom === null) throw new Error('Missing sky cards');
          await page.screenshot({ path: `${process.env.VMN_REVIEW_SCREENSHOTS}/${theme}-${opacity}-${width}.png`, clip: { x: top.x, y: top.y, width: top.width, height: bottom.y + bottom.height - top.y } });
        }
      }
    }
    expect(paints.size, `${theme}: opacity must change the actual card paint`).toBe(3);
  }
  for (const layout of ['classic', 'guide']) {
    expect((await post('/api/account/workspace-preferences/guide', { workspaceId, guide: { layout, cardStyle: 'glass', cardOpacity: 50 } })).status).toBe(200);
    await page.reload();
    await expect(shell).toHaveAttribute('data-layout', layout);
    await expectSharedSkySurface(page);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      await expectAccessible(page, `Sky cards in ${layout} at ${width}`);
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.shell').evaluate(node => (node as unknown as { getAnimations(options: { subtree: boolean }): { playState: string }[] }).getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.guide-art').first()).toBeHidden();
  await expect(page.locator('.today-instruments .instrument-picture').first()).toBeHidden();
  await expect(page.locator('.today-moon .celestial-art')).toBeHidden();
  await page.emulateMedia({ forcedColors: 'none' });
  mkdirSync(process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42', { recursive: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: `${process.env.VMN_REVIEW_SCREENSHOTS ?? 'assets/screenshots/release-42'}/guide-${testInfo.project.name}.png`, fullPage: true });
  expect((await post('/api/account/workspace-preferences/guide', { workspaceId, guide: { images: false, cardOpacity: 0 } })).status).toBe(200);
  await page.reload();
  await expect(shell).toHaveAttribute('data-guide-images', 'false');
  await expect(page.locator('.guide-art')).toHaveCount(0);
  await expect(shell).toHaveCSS('background-image', 'none');
  await expectAccessible(page, 'No decorative images and transparent card background');
  expect((await post('/api/account/workspace-preferences/guide', { workspaceId, guide: { cardOpacity: 100 } })).status).toBe(200);
  await page.reload();
  await expect(shell).toHaveCSS('--guide-card-opacity', '100%');
  await expectAccessible(page, 'Solid card background');
  expect(errors).toEqual([]);
  expect(requests.filter(url => !url.startsWith('http://127.0.0.1:3101/'))).toEqual([]);
  expect((await post('/api/account/workspace-preferences/guide', { workspaceId, guide: null })).status).toBe(200);
});

test('Celestial instrument preserves astronomy and reflows across themes at 320px through desktop', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const email = `celestial-${randomUUID()}@example.org`;
  const password = 'a fictional celestial review passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Celestial reviewer', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
    workspaceId = insertLegacyWorkspace(database, { name: 'Fictional observatory', adminUserId: user.id }).id;
    database.sqlite.prepare("INSERT INTO workspace_tools (workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'MOON',1,?,?)").run(workspaceId, Date.now(), user.id);
    database.sqlite.prepare('UPDATE workspaces SET location=? WHERE id=?').run(JSON.stringify({ name: 'Göggingen', latitude: 48.33, longitude: 10.87, timeZone: 'Europe/Berlin', elevation: null }), workspaceId);
  } finally { database.close(); }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Pin the astronomy civil date: some real dates legitimately have no moonrise or moonset.
  await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
  await page.goto('/');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page);
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  await page.goto(`/w/${workspaceId}`);
  const card = page.getByRole('region', { name: 'Celestial', exact: true });
  await expect(card).toBeVisible();
  await expect(card.locator('time')).toHaveCount(4);
  for (const label of ['Sunrise', 'Sunset', 'Moonrise', 'Moonset', 'Illumination', 'Next full moon']) await expect(card).toContainText(label);
  for (const theme of ['light', 'dark', 'tokyo-nights', 'witch-forest', 'places-de', 'space-guide']) {
    const answer = await page.evaluate(async theme => fetch('/api/account/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) }).then(r => r.status), theme);
    expect(answer).toBe(200); await page.reload(); await expect(card).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      const instrument = card.locator('.celestial-instrument');
      expect(await instrument.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const sun = await card.locator('.celestial-sun').boundingBox();
      const moon = await card.locator('.celestial-moon').boundingBox();
      const art = await card.locator('.celestial-art').boundingBox();
      if (sun === null || moon === null || art === null) throw new Error('Missing celestial layout');
      expect(sun.x).toBeLessThan(moon.x);
      if (width <= 390) { expect(sun.y).toBeGreaterThanOrEqual(art.y + art.height); expect(moon.y).toBe(sun.y); }
      if (theme === 'light' || width === 320) await expectAccessible(page, `Celestial ${theme} ${width}`);
      if (theme === 'space-guide') await card.screenshot({ path: `/tmp/celestial-${width}-${testInfo.project.name}.png` });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await card.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(card.locator('.celestial-art')).toBeHidden();
  await expect(card).toContainText('Sunrise'); await expect(card).toContainText('Moonrise');
  expect(errors).toEqual([]);
});

test('Notes and personal Journal preserve Markdown, originals, privacy and recoverable drafts',async({page},testInfo)=>{
 test.setTimeout(180_000);page.setDefaultTimeout(15_000);
 if(testInfo.project.name.includes('mobile'))await page.setViewportSize({width:320,height:720});
 const email=`notes-${randomUUID()}@example.org`;const password='a fictional notebook passphrase';const database=openDatabase(guideServerEnv.DATABASE_PATH);let workspaceId:string;
 try{const user=await createUserRepository(database).create({email:normalizeEmail(email),displayName:'Notebook reviewer',emailVerified:true,status:'ACTIVE',serverAdmin:false});database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());workspaceId=insertLegacyWorkspace(database,{name:'Fictional notebook studio',adminUserId:user.id}).id;enableCoreTools(database,workspaceId,user.id);}finally{database.close();}
 const errors:string[]=[];const requests:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await signInGuide(page);await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 await page.goto(`/w/${workspaceId}`);
 await page.evaluate(async id=>{const response=await fetch(`/api/workspaces/${id}/tools`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'JOURNAL',enabled:true,expectedRevision:(await fetch(`/api/workspaces/${id}`).then(response=>response.json()) as {toolsRevision:number}).toolsRevision})});if(!response.ok)throw new Error('tool fixture '+response.status+' '+await response.text());},workspaceId);
 await page.reload();await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.getByRole('button',{name:/Journal entry — Personal/})).toBeVisible();await page.getByRole('button',{name:/Note — Workspace/}).click();
 if(testInfo.project.name.includes('mobile')){await checkPhoneJournal(page,testInfo,workspaceId);return;}
 // One-screen editor (40): title, Markdown editor and the details panel side by side.
 await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect(page.getByLabel('Title',{exact:true})).toBeFocused();
 await page.getByLabel('Title',{exact:true}).fill('A portable garden note');
 const editor=page.locator('.milkdown .ProseMirror');await expect(editor).toBeVisible();
 await expect(page.getByRole('button',{name:'Visual',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Markdown source',exact:true})).toHaveAttribute('aria-pressed','false');
 await expect(page.getByRole('group',{name:'Text formatting',exact:true})).toBeVisible();
 await expect(page.getByLabel('Notebook',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('notes-new-entry.png'),fullPage:true});
 await page.screenshot({path:testInfo.outputPath('notes-writing-viewport.png')});
 await editor.fill('Written visually.');await editor.press('ControlOrMeta+a');
 await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(editor.locator('strong')).toHaveText('Written visually.');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(editor.locator('strong')).toHaveCount(0);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(editor.locator('strong')).toHaveText('Written visually.');
 await page.getByRole('button',{name:'Markdown source',exact:true}).click();
 const source=page.getByLabel('Markdown source',{exact:true});await expect(source).toHaveValue(/\*\*Written visually\.\*\*/);
 await expect(page.getByRole('button',{name:'Markdown source',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('group',{name:'Text formatting',exact:true})).toHaveCount(0);
 const markdown='# Garden\n\n## Materials\n\n- [ ] Bring seeds\n- [x] Find gloves\n\n| Item | Amount |\n| --- | --- |\n| Seeds | 2 |\n\n```javascript\nconst seeds = 2;\n```\n';
 await page.getByLabel('Notebook',{exact:true}).fill('Garden');
 await page.getByLabel('Tags',{exact:true}).fill('seeds');await page.getByLabel('Tags',{exact:true}).press('Enter');
 await expect(page.getByRole('button',{name:'Remove tag seeds',exact:true})).toBeVisible();
 await expectAccessible(page,'Entry details panel');await expect(source).toHaveValue(/Written visually/);
 await source.fill(markdown);await page.getByRole('button',{name:'Visual',exact:true}).click();await expect(page.getByRole('cell',{name:'Seeds',exact:true})).toBeVisible();await expectAccessible(page,'Visual Markdown editor');await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(source).toHaveValue(/const seeds = 2/);await expect(source).toHaveValue(/Bring seeds/);
 await expect(async()=>{const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/journal/attachments'));await page.getByLabel('Upload original image',{exact:true}).setInputFiles({name:'garden.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64')});expect((await response).status()).toBe(201);}).toPass({timeout:15000,intervals:[500,1000,2000]});
 await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();await expectAccessible(page,'Notes editor');
 await page.screenshot({path:testInfo.outputPath('notes-editor.png'),fullPage:true});
 // A saved note opens to read: rendered Markdown, checklist progress, the notebook and tag named in words.
 await page.reload();await expect(page.getByRole('heading',{name:'A portable garden note',exact:true})).toBeVisible();
 await expect(page.locator('.nb-prose table')).toContainText('Seeds');await expect(page.locator('.nb-aside')).toContainText('1 of 2 done');
 await expect(page.locator('.nb-labels')).toContainText('Garden');await expect(page.locator('.nb-labels')).toContainText('#seeds');
 await expectAccessible(page,'Notes reading view');await page.screenshot({path:testInfo.outputPath('notes-reader.png'),fullPage:true});
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 await page.getByRole('button',{name:'Cancel editing',exact:true}).click();
 await page.getByRole('button',{name:'More actions',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export Markdown',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('notes.zip');
 // The library: the notebook and tag chips filter; the card shows the checklist.
 await page.getByRole('button',{name:'Back to entries',exact:true}).click();
 await expect(page.getByRole('button',{name:/A portable garden note/})).toContainText('1 of 2 done');
 await page.getByRole('button',{name:'Tag seeds',exact:true}).click();await expect(page.getByRole('button',{name:/A portable garden note/})).toBeVisible();
 await page.getByLabel('Search entries',{exact:true}).fill('no such words');await expect(page.getByText('Nothing matches',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Show everything',exact:true}).click();await expect(page.getByRole('button',{name:/A portable garden note/})).toBeVisible();
 await expectAccessible(page,'Notes library');await page.screenshot({path:testInfo.outputPath('notes-library.png'),fullPage:true});
 await page.goto(`/w/${workspaceId}`);await page.getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:/Journal entry — Personal/}).click();
 await expect(page.getByRole('heading',{name:'Your personal Journal',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>fetch('/api/account/journal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:{kind:'note',version:2,title:'Before consent',date:null,body:''},expectedRevision:0,archived:false})}).then(response=>response.status))).toBe(403);
 await page.getByRole('button',{name:'Agree & Continue',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('A personal notebook');await page.getByRole('button',{name:'Markdown source',exact:true}).click();await page.getByLabel('Markdown source',{exact:true}).fill('Only this account.');await page.getByRole('button',{name:'Visual',exact:true}).click();await expect(editor).toContainText('Only this account.');await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/Only this account\./);await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
 await page.getByLabel('Markdown source',{exact:true}).fill('A recoverable private draft.');await expect(page.getByRole('status').filter({hasText:'Draft saved for recovery.'})).toBeVisible();
 page.once('dialog',dialog=>void dialog.accept());await page.reload();await expect(page.getByRole('heading',{name:'Your personal Journal',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Recover saved draft',exact:true}).click();await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue('A recoverable private draft.');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();await expectAccessible(page,'Personal Journal editor');
 for(const theme of ['light','memento-mori','tokyo-nights','witch-forest','places-de','space-guide']){
  expect(await page.evaluate(async theme=>fetch('/api/account/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme})}).then(response=>response.status),theme)).toBe(200);
  await page.reload();await expect(page.getByRole('heading',{name:'A personal notebook',exact:true})).toBeVisible();
  await expectAccessible(page,`Journal ${theme}`);
  if(theme==='memento-mori')await page.screenshot({path:testInfo.outputPath('journal-dark.png'),fullPage:true});
 }
 // The Journal's month timeline: undated pages live in the cards view, Today's page starts a dated one.
 await page.getByRole('button',{name:'Back to entries',exact:true}).click();await expect(page.getByRole('button',{name:'Timeline',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:/Write today's page/})).toBeVisible();await expectAccessible(page,'Journal timeline');
 await page.getByRole('button',{name:'Cards',exact:true}).click();await page.getByRole('button',{name:/A personal notebook/}).click();
 await page.getByRole('button',{name:'Edit',exact:true}).click();
 await page.evaluate('window.scrollTo(0,document.body.scrollHeight)');
 const saveBox=await page.getByRole('button',{name:'Save entry',exact:true}).boundingBox();expect(saveBox?.y).toBeGreaterThanOrEqual(0);expect(saveBox?.y).toBeLessThan(100);
 await page.getByLabel('Notebook',{exact:true}).fill('Personal thoughts');await expect(editor).toContainText('A recoverable private draft.');
 page.once('dialog',dialog=>void dialog.dismiss());await page.getByRole('button',{name:'Cancel editing',exact:true}).click();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('A personal notebook');
 page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Cancel editing',exact:true}).click();await expect(page.getByRole('heading',{name:'A personal notebook',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Tools',exact:true})).toBeVisible();
 expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);expect(errors).toEqual([]);expect(requests.every(url=>url.startsWith(guideServerEnv.PUBLIC_ORIGIN))).toBe(true);
});

test('Recipes preserve originals and transfer ingredients for the requested servings', async ({page},testInfo)=>{
 test.setTimeout(180_000);page.setDefaultTimeout(15_000);
 if(testInfo.project.name.includes('mobile'))await page.setViewportSize({width:320,height:720});
 const email = `recipes-${randomUUID()}@example.org`;
 const password = 'a fictional pancake passphrase';
 const database = openDatabase(guideServerEnv.DATABASE_PATH);
 let workspaceId: string;
 let foreignWorkspaceId: string;
 try {
   const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Recipe reviewer', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
   database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)")
     .run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
   workspaceId = insertLegacyWorkspace(database, { name: 'Fictional kitchen', adminUserId: user.id }).id;
   enableCoreTools(database, workspaceId, user.id);
   foreignWorkspaceId = insertLegacyWorkspace(database, { name: 'Fictional cabin', adminUserId: user.id }).id;
   database.sqlite.prepare("INSERT INTO workspace_tools (workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'RECIPES',1,?,?)")
     .run(foreignWorkspaceId, Date.now(), user.id);
 } finally {
   database.close();
 }
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await signInGuide(page);await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 const listId=await page.evaluate(async id=>{let response=await fetch(`/api/workspaces/${id}/tools`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'RECIPES',enabled:true,expectedRevision:((await fetch(`/api/workspaces/${id}`).then(response=>response.json())) as {toolsRevision:number}).toolsRevision})});if(!response.ok)throw new Error('Recipe tool fixture '+response.status+' '+await response.text());response=await fetch(`/api/workspaces/${id}/lists`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Pancake shopping'})});if(!response.ok)throw new Error('List fixture');return ((await response.json()) as {list:{id:string}}).list.id;},workspaceId);
 await page.goto(`/w/${workspaceId}/recipes`);await page.getByRole('button',{name:'New recipe',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Pancakes for breakfast');
 const ingredient=(count:number)=>page.getByRole('group',{name:`Ingredient ${count}`,exact:true});
 if(testInfo.project.name.includes('mobile')) { await checkPhoneRecipe(page, workspaceId); } else {
 await page.getByLabel('Base recipe servings (optional)', { exact: true }).fill('2');
 await ingredient(1).getByLabel('Ingredient name',{exact:true}).fill('Flour');await ingredient(1).getByLabel('Amount',{exact:true}).fill('125');await ingredient(1).getByLabel('Unit',{exact:true}).fill('g');
 await page.getByRole('button',{name:'Add ingredient',exact:true}).click();await ingredient(2).getByLabel('Ingredient name',{exact:true}).fill('Eggs');await ingredient(2).getByLabel('Amount',{exact:true}).fill('1');
 await page.getByRole('button', { name: 'Add ingredient', exact: true }).click();
 await ingredient(3).getByLabel('Ingredient name', { exact: true }).fill('Salz');
 await ingredient(3).getByLabel('Amount', { exact: true }).fill('etwas');
 await page.getByRole('button',{name:'Markdown source',exact:true}).click();await page.getByLabel('Markdown source',{exact:true}).fill('Mix the batter.\n\nCook in a warm pan.');
 await page.getByText('Images and originals',{exact:true}).click();await expect(async()=>{const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/recipes/attachments'));await page.getByLabel('Upload original image',{exact:true}).setInputFiles({name:'pancakes.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64')});expect((await response).status()).toBe(201);}).toPass({timeout:15000,intervals:[500,1000,2000]});
 await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 await expect(page.getByLabel('Private to this Workspace')).not.toBeChecked();
 await page.getByLabel('Private to this Workspace').check();
 await page.getByRole('button',{name:'Save recipe',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Recipe saved.'})).toBeVisible();await expect(page.getByRole('img',{name:/pancakes.png/})).toBeVisible();
 }
 // Exercise both the image upload action and cover selection in the real editor.
 await page.getByRole('button', { name: 'Manage recipe photos' }).click();
 const photoUpload = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/recipes/attachments'));
 await page.getByLabel('Upload original image', { exact: true }).setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64') });
 const coverResponse = await photoUpload;
 expect(coverResponse.status()).toBe(201);
 const coverId = (await coverResponse.json()).attachment.id as string;
 const coverPicker = page.getByLabel('Cookbook cover photo');
 await coverPicker.selectOption({ label: 'Photo 2' });
 await expect(coverPicker).toHaveValue(`attachments/${coverId}.png`);
 await page.getByRole('button', { name: 'Save recipe', exact: true }).click();
 await expect(page.getByRole('status').filter({ hasText: 'Recipe saved.' })).toBeVisible();
 const placeholderStatus = await page.evaluate(async workspaceId => fetch(`/api/workspaces/${workspaceId}/recipes`, {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ content: { version: 1, title: 'Afternoon tea', private: true, servings: null, ingredients: [{ name: 'Tea', amount: '4', unit: 'tsp', note: '' }], instructions: 'Steep and serve.', tags: ['Drinks'], source: '', prepMinutes: 3, cookMinutes: null }, expectedRevision: 0, archived: false }),
 }).then(response => response.status), workspaceId);
 expect(placeholderStatus).toBe(201);
 const themes = ['system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland', 'space-guide'];
 for (const theme of themes) {
   const result = await page.evaluate(async theme => fetch('/api/account/preferences', {
     method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }),
   }).then(response => response.status), theme);
   expect(result).toBe(200);
   await page.goto(`/w/${workspaceId}/recipes`);
   const pictured = page.getByRole('button', { name: /Pancakes for breakfast/ });
   const unpictured = page.getByRole('button', { name: /Afternoon tea/ });
   await expect(pictured.getByText('Private', { exact: true })).toBeVisible();
   await expect(pictured.getByText('Workspace: Fictional kitchen', { exact: true })).toBeVisible();
   await expect(pictured.locator('.recipe-photo img')).toHaveAttribute('src', new RegExp(coverId + '/thumbnail$'));
   await expect(pictured.locator('.recipe-photo img')).toHaveAttribute('loading', 'lazy');
   await expect(pictured.locator('.recipe-photo')).toHaveAttribute('data-photo', 'loaded');
   await expect(unpictured.locator('.recipe-photo')).toHaveAttribute('data-photo', 'missing');
   expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
   const first = await pictured.boundingBox(), second = await unpictured.boundingBox();
   if (!first || !second) throw new Error('Missing cookbook cards');
   if (testInfo.project.name.includes('mobile')) expect(first.x).toBeCloseTo(second.x);
   else expect(first.y).toBeCloseTo(second.y);
   const photo = await pictured.locator('.recipe-photo').boundingBox();
   const placeholder = await unpictured.locator('.recipe-photo').boundingBox();
   if (!photo || !placeholder) throw new Error('Missing photo frames');
   expect(Math.abs(photo.width / photo.height - 4 / 3)).toBeLessThan(0.01);
   expect(Math.abs(placeholder.width / placeholder.height - 4 / 3)).toBeLessThan(0.01);
   if (['light', 'space-guide'].includes(theme)) {
     await expectAccessible(page, `Cookbook in ${theme}`);
     await page.screenshot({ path: testInfo.outputPath(`cookbook-${theme}.png`), fullPage: true });
   }
 }
 await page.route(`**/recipes/*/attachments/${coverId}/thumbnail`, route => route.fulfill({ status: 404 }));
 await page.reload();
 await expect(page.getByRole('button', { name: /Pancakes for breakfast/ }).locator('.recipe-photo')).toHaveAttribute('data-photo', 'missing');
 await page.unroute(`**/recipes/*/attachments/${coverId}/thumbnail`);
 await page.getByRole('button', { name: /Afternoon tea/ }).click();
 await expect(page.getByRole('button', { name: 'Add recipe photo' })).toBeVisible();
 const shopping = page.getByRole('region', { name: 'Add ingredients to a grocery list' });
 const targetServings = shopping.getByLabel('Shopping for this many servings', { exact: true });
 const addIngredients = shopping.getByRole('button', { name: 'Add ingredients', exact: true });
 await expect(shopping.getByText('This recipe has no serving count. Its ingredient amounts will be added as written.')).toBeVisible();
 await expect(targetServings).toHaveCount(0);
 await addIngredients.click();
 await expect(shopping.getByRole('status')).toHaveText('1 ingredient added.');
 await page.getByRole('button', { name: 'Back to recipes', exact: true }).click();
 const pancakeCard = page.getByRole('button', { name: /Pancakes for breakfast/ });
 await pancakeCard.focus();
 await pancakeCard.press('Enter');
 await expect(page.locator('article').getByText('Workspace: Fictional kitchen', { exact: true })).toBeVisible();
 await expect(page.getByText('etwas · Salz', { exact: true })).toBeVisible();
 await targetServings.fill('6');
 await expect(shopping.getByLabel('Ingredient name')).toHaveCount(0);
 await addIngredients.click();
 await expect(shopping.getByRole('status')).toHaveText('3 ingredients added.');
 await expectAccessible(page,'Recipe and grocery transfer');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Export recipe',exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe('recipes.zip');
 await page.screenshot({path:testInfo.outputPath('recipe.png'),fullPage:true});expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
 await page.goto(`/w/${workspaceId}/lists/${listId}`);
 const groceries = page.getByRole('list', { name: 'To buy' }).getByRole('listitem');
 await expect(groceries.filter({ hasText: 'Flour' })).toContainText('375 g');
 await expect(groceries.filter({ hasText: 'Eggs' })).toContainText('3');
 await expect(groceries.filter({ hasText: 'Tea' })).toContainText('4 tsp');
 await expect(groceries.filter({ hasText: 'etwas Salz' })).toHaveCount(1);
 await expect(groceries).toHaveCount(4);
 expect(errors).toEqual([]);
 if(testInfo.project.name.includes('mobile')) await checkRecipeSourcePreservation(page, workspaceId);
 const sharedTitle = `Cabin recipe ${randomUUID().slice(0, 8)}`;
 const sharedStatus = await page.evaluate(async ({ foreignWorkspaceId, sharedTitle }) => fetch(`/api/workspaces/${foreignWorkspaceId}/recipes`, {
   method: 'POST', headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify({ content: { version: 1, title: sharedTitle, servings: 2, ingredients: [{ name: 'Tea', amount: '', unit: '', note: '' }], instructions: 'Steep and serve.', tags: [], source: '', prepMinutes: null, cookMinutes: null }, expectedRevision: 0, archived: false }),
 }).then(response => response.status), { foreignWorkspaceId, sharedTitle });
 expect(sharedStatus).toBe(201);
 await page.goto(`/w/${workspaceId}/recipes`);
 const sharedCard = page.getByRole('button', { name: new RegExp(sharedTitle) });
 await expect(sharedCard.getByText('Public', { exact: true })).toBeVisible();
 await expect(sharedCard.getByText('Workspace: Fictional cabin', { exact: true })).toBeVisible();
 await sharedCard.click();
 await expect(page.locator('article').getByText('Workspace: Fictional cabin', { exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Edit recipe', exact: true })).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('MCP requires MFA and visible consent and supports revoking a scoped user connection',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const email=`mcp-${randomUUID()}@example.org`,password='a fictional assistant review passphrase';const database=openDatabase(guideServerEnv.DATABASE_PATH);let workspaceId:string;
 try{const user=await createUserRepository(database).create({email:normalizeEmail(email),displayName:'Assistant reviewer',emailVerified:true,status:'ACTIVE',serverAdmin:false});database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());workspaceId=insertLegacyWorkspace(database,{name:'Fictional assistant kitchen',adminUserId:user.id}).id;enableCoreTools(database,workspaceId,user.id);}finally{database.close();}
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await signInGuide(page);await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 const client=await page.evaluate(async()=>{const r=await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Fictional AI assistant',redirect_uris:['https://client.example.org/callback'],token_endpoint_auth_method:'none'})});return await r.json() as {client_id:string};});
 const authorization=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example.org/callback',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',scope:'workspaces.read lists.read lists.write lists.covers.write',resource:guideServerEnv.PUBLIC_ORIGIN+'/mcp'});
 // Enroll only the disposable fixture, then start authorization logged out. The request must
 // survive both password and TOTP screens without issuing a code or silently selecting a Workspace.
 const secret=await page.evaluate(async password=>{const r=await fetch('/api/account/mfa/totp/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(!r.ok)throw new Error('Synthetic MFA setup failed');return (await r.json() as {secret:string}).secret;},password);
 const totp=new TOTP({secret});
 const enrolled=await page.evaluate(async code=>{const r=await fetch('/api/account/mfa/totp/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});return r.status;},totp.generate());expect(enrolled).toBe(200);
 await page.context().clearCookies();
 await page.goto('/authorize?'+authorization);await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
 const consentUrl=page.url();expect(new URL(consentUrl).pathname).toBe('/account/connections');expect(new URL(consentUrl).searchParams.has('request')).toBe(true);
 await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await signInGuide(page);
 await expect(page.getByRole('heading',{name:'Two-factor authentication',exact:true})).toBeVisible();expect(page.url()).toBe(consentUrl);
 expect((await page.context().cookies()).some(cookie=>cookie.name.endsWith('vmn.session_token'))).toBe(false);
 await page.getByLabel('Code from your authenticator app').fill(totp.generate({timestamp:Date.now()+30000}));await page.getByRole('button',{name:'Verify',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Connect Fictional AI assistant'})).toBeVisible();expect(page.url()).toBe(consentUrl);
 await expect(page.getByRole('checkbox',{name:'Fictional assistant kitchen',exact:true})).not.toBeChecked();await expect(page.getByRole('button',{name:'Allow connection',exact:true})).toBeDisabled();
 await page.route('https://client.example.org/**',route=>route.fulfill({contentType:'text/plain',body:'Fictional OAuth callback'}));
 await page.getByRole('button',{name:'Decline',exact:true}).click();await expect(page).toHaveURL(/^https:\/\/client\.example\.org\/callback\?error=access_denied/);
 await page.goto('/authorize?'+authorization);await expect(page.getByRole('heading',{name:'Connect Fictional AI assistant'})).toBeVisible();await expectAccessible(page,'MCP consent');
 await page.setViewportSize({width:320,height:850});
 await page.getByRole('checkbox',{name:'Fictional assistant kitchen',exact:true}).check();
 const groceryAccess=page.getByRole('combobox',{name:'Grocery Lists',exact:true});
 await expect(groceryAccess).toHaveValue('read');
 await groceryAccess.selectOption('read-write');
 const coverAccess=page.getByRole('combobox',{name:'List cover images',exact:true});
 await expect(coverAccess).toHaveValue('none');
 await coverAccess.selectOption('write');
 expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
 await page.getByRole('button',{name:'Allow connection',exact:true}).click();await expect(page).toHaveURL(/^https:\/\/client\.example\.org\/callback\?code=/);
 await page.goto(guideServerEnv.PUBLIC_ORIGIN+'/account/connections');
 await expect(page.getByText('Fictional AI assistant',{exact:true})).toBeVisible();
 await expect(page.getByText('Consent saved. No token exchange recorded.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Run local checks',exact:true}).click();
 const report=page.getByRole('textbox',{name:'VMN AI connection report',exact:true});
 await expect(report).toHaveValue(/MCP without sign-in — HTTP 401[\s\S]*VMN browser checks passed/);
 await expect(report).toHaveValue(/token issued: 0\. No exchange recorded: 1/);
 expect(await report.inputValue()).not.toMatch(/Fictional|https?:\/\/|callback/);
 await page.evaluate(`(() => {
   Object.defineProperty(navigator.clipboard,'writeText',{
     value:async value => { document.body.dataset.copiedDiagnostics = value; },
   });
 })()`);
 await page.getByRole('button',{name:'Copy diagnostics',exact:true}).click();
 await expect(page.getByText('Diagnostics copied.',{exact:true})).toBeVisible();
 expect(await page.locator('body').getAttribute('data-copied-diagnostics')).toBe(await report.inputValue());
 const discovery='**/.well-known/oauth-authorization-server';
 await page.route(discovery,route=>route.fulfill({contentType:'text/html',body:'private proxy error page'}));
 await page.getByRole('button',{name:'Run local checks',exact:true}).click();
 await expect(report).toHaveValue(/Discovery metadata is missing or does not match/);
 expect(await report.inputValue()).not.toContain('private proxy error page');
 await page.unroute(discovery);
 await page.getByRole('button',{name:'Manage access',exact:true}).click();
 await page.getByRole('button',{name:'Disconnect',exact:true}).click();
 await expect(page.getByText('Disconnected',{exact:true})).toBeVisible();await page.evaluate('window.scrollTo(0,0)');await expectAccessible(page,'MCP revoked connection');
 await page.setViewportSize({width:320,height:850});expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
});

test('Procedure phone authoring uses staged screens and a uniform bottom action bar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'guide-mobile-chromium', 'focused phone flow; desktop builder has its account regression');
  test.setTimeout(120_000);
  const email = `procedure-phone-${randomUUID()}@example.org`;
  const password = 'fictional phone procedure passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Phone author', emailVerified: true, status: 'ACTIVE', serverAdmin: false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
    workspaceId = insertLegacyWorkspace(database, { name: 'Phone procedure studio', adminUserId: user.id }).id;
    enableCoreTools(database, workspaceId, user.id);
  } finally { database.close(); }
  await page.goto('/');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page);
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  const { checkPhoneProcedure } = await import('./phone-procedure.ts');
  await checkPhoneProcedure(page, workspaceId);
});

test('Reminder and Procedure schedules preserve drafts with shared phone flow controls', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `schedule-flow-${randomUUID()}@example.org`, password = 'fictional schedule review passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email:normalizeEmail(email), displayName:'Schedule reviewer', emailVerified:true, status:'ACTIVE', serverAdmin:false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());
    workspaceId = insertLegacyWorkspace(database,{name:'Schedule studio',adminUserId:user.id}).id;
    enableCoreTools(database,workspaceId,user.id);
  } finally { database.close(); }
  await page.goto('/'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page); await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
  const { checkScheduleFlow } = await import('./phone-schedule.ts');
  await checkScheduleFlow(page, workspaceId, testInfo.project.name.includes('mobile'));
});

function documentPhoto(width = 320, height = 240): Buffer {
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

test('Documents preserve uploads and details through the shared phone flow', async ({ page }, testInfo) => {
  test.setTimeout(180_000); page.setDefaultTimeout(10_000);
  const email = `schedule-flow-${randomUUID()}@example.org`, password = 'fictional schedule review passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email:normalizeEmail(email), displayName:'Schedule reviewer', emailVerified:true, status:'ACTIVE', serverAdmin:false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());
    workspaceId = insertLegacyWorkspace(database,{name:'Schedule studio',adminUserId:user.id}).id;
    enableCoreTools(database,workspaceId,user.id);
    database.sqlite.prepare("INSERT INTO workspace_tools(workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'DOCUMENTS',1,?,?)").run(workspaceId,Date.now(),user.id);
  } finally { database.close(); }
  await page.goto('/'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page); await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
  const mobile = testInfo.project.name.includes('mobile');
  await page.goto(`/w/${workspaceId}/documents/new`);
  const bar = page.getByRole('navigation', { name: 'Document actions' });
  const next = () => bar.getByRole('button', { name: 'Next', exact:true }).click();
  if (mobile) { await expect(bar.getByRole('button', { name:'Next',exact:true })).toBeDisabled(); await expect(page.getByLabel('Title', {exact:true})).toBeHidden(); }
  await page.locator('input[type=file][multiple]').setInputFiles({name:'Receipt.png',mimeType:'image/png',buffer:documentPhoto()});
  await expect(page.getByRole('listitem').filter({hasText:'Uploaded'})).toHaveCount(1);
  if (mobile) await next();
  await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Receipt');
  if (mobile) { await page.getByLabel('Title',{exact:true}).fill('   '); await next(); await expect(page.getByLabel('Title',{exact:true})).toBeFocused(); }
  await page.getByLabel('Title',{exact:true}).fill('Phone receipt');
  if (mobile) await next(); else await page.getByText('More details (type, dates, tags, notes)', {exact:true}).click();
  await page.getByLabel('Notes',{exact:true}).fill('Keep the original bytes');
  await page.getByLabel('Document date',{exact:true}).fill('2026-11-03');
  if (mobile) {
    await bar.getByRole('button',{name:'Back',exact:true}).click();
    await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Phone receipt');
    await next();
    await expect(page.getByLabel('Notes',{exact:true})).toHaveValue('Keep the original bytes');
    page.once('dialog', dialog => dialog.dismiss()); await bar.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(page.getByLabel('Notes',{exact:true})).toHaveValue('Keep the original bytes');
    await page.setViewportSize({width:320,height:600});
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    for (const button of await bar.getByRole('button').all()) { const box=await button.boundingBox(); expect(box?.width).toBeGreaterThanOrEqual(48); expect(box?.height).toBeGreaterThanOrEqual(48); }
    await expectAccessible(page,'Document phone details');
    await page.screenshot({path:'/tmp/vmn-document-phone.png',fullPage:true});
    await page.setViewportSize({width:1100,height:800}); await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Phone receipt');
    await page.setViewportSize({width:390,height:700}); await expect(bar).toBeVisible();
  }
  await page.route(`**/api/workspaces/${workspaceId}/documents`, async route => { if(route.request().method()==='POST') { await route.fulfill({status:500,json:{error:{code:'internal_error'}}}); } else await route.continue(); },{times:1});
  await page.getByRole('button',{name:'Save document',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Notes',{exact:true})).toHaveValue('Keep the original bytes');
  await page.getByRole('button',{name:'Save document',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Phone receipt',level:2})).toBeVisible();
  await page.getByRole('button',{name:'Actions for “Phone receipt”',exact:true}).click();
  await page.getByRole('button',{name:'Edit details',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit details',exact:true});
  const editBar=editor.getByRole('navigation',{name:'Edit details',exact:true});
  await editor.getByLabel('Title',{exact:true}).fill('Revised receipt');
  if(mobile) {
    await expect(editor.getByLabel('Notes',{exact:true})).toBeHidden();
    await editBar.getByRole('button',{name:'Next',exact:true}).click();
  }
  await editor.getByLabel('Notes',{exact:true}).fill('Updated details');
  page.once('dialog',dialog=>dialog.dismiss()); await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Notes',{exact:true})).toHaveValue('Updated details');
  if(mobile) {
    await editBar.getByRole('button',{name:'Back',exact:true}).click();
    await expect(editor.getByLabel('Title',{exact:true})).toHaveValue('Revised receipt');
    await editBar.getByRole('button',{name:'Next',exact:true}).click();
    await page.setViewportSize({width:320,height:600});
    await expectAccessible(page,'Document editing dialog');
    await page.setViewportSize({width:1100,height:800});
    await expect(editor.getByLabel('Title',{exact:true})).toHaveValue('Revised receipt');
    await page.setViewportSize({width:390,height:700});
  }
  await editor.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Revised receipt',level:2})).toBeVisible();
  await page.getByRole('button',{name:'Actions for “Revised receipt”',exact:true}).click();
  await page.getByRole('button',{name:'Move',exact:true}).click();
  const mover=page.getByRole('dialog',{name:'Move “Revised receipt”',exact:true});
  await expect(mover.getByLabel('Move to',{exact:true})).toBeVisible();
  await mover.getByRole('button',{name:'Move',exact:true}).click();
  await expect(mover).toHaveCount(0);

});

test('Remaining tools share phone authoring controls and preserve simple list entry', async ({ page }, testInfo) => {
  test.setTimeout(180_000); page.setDefaultTimeout(10_000);
  const email = `schedule-flow-${randomUUID()}@example.org`, password = 'fictional schedule review passphrase';
  const database = openDatabase(guideServerEnv.DATABASE_PATH);
  let workspaceId: string; let procedureId: string;
  try {
    const user = await createUserRepository(database).create({ email:normalizeEmail(email), displayName:'Schedule reviewer', emailVerified:true, status:'ACTIVE', serverAdmin:false });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());
    workspaceId = insertLegacyWorkspace(database,{name:'Schedule studio',adminUserId:user.id}).id;
    enableCoreTools(database,workspaceId,user.id);
    procedureId=insertLegacyProcedure(database,{workspaceId,userId:user.id,title:'Phone safety check',steps:[{title:'Check the door'}]}).id;
    for (const tool of ['EQUIPMENT','MAINTENANCE','CONTACTS','BRING']) database.sqlite.prepare("INSERT INTO workspace_tools(workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,?,1,?,?)").run(workspaceId,tool,Date.now(),user.id);
  } finally { database.close(); }
  await page.goto('/'); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await signInGuide(page); await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
  const mobile = testInfo.project.name.includes('mobile');
  const cases = [
    {path:'equipment',open:'Add equipment',dialog:'Add equipment',field:/^Name/,value:'Phone kettle',steps:3,save:'Save'},
    {path:'maintenance',open:'More details…',dialog:'New maintenance record',field:/^What/,value:'Phone servicing',steps:2,save:'Save'},
    {path:'contacts',open:'More details…',dialog:'New contact',field:/^Name/,value:'Phone plumber',steps:3,save:'Save'},
    {path:'bring',open:'Add item',dialog:'Add item',field:'What to bring',value:'Phone umbrella',steps:2,save:'Save'},
  ];
  for (const item of cases) {
    await page.goto(`/w/${workspaceId}/${item.path}`);
    await page.getByRole('button',{name:item.open,exact:true}).click();
    const dialog=page.getByRole('dialog',{name:item.dialog,exact:true});
    const bar=dialog.getByRole('navigation',{name:item.dialog,exact:true});
    await dialog.getByLabel(item.field).fill(item.value);
    if(mobile) {
      for(let n=1;n<item.steps;n++) await bar.getByRole('button',{name:'Next',exact:true}).click();
      page.once('dialog',popup=>popup.dismiss()); await bar.getByRole('button',{name:'Cancel',exact:true}).click();
      await expect(dialog).toBeVisible();
      await bar.getByRole('button',{name:'Back',exact:true}).click();
      await bar.getByRole('button',{name:'Next',exact:true}).click();
      await page.setViewportSize({width:320,height:600});
      expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      for(const button of await bar.getByRole('button').all()) {const box=await button.boundingBox();expect(box?.width).toBeGreaterThanOrEqual(48);expect(box?.height).toBeGreaterThanOrEqual(48);}
      expect(await dialog.evaluate(element=>element.scrollWidth <= element.clientWidth)).toBe(true);
      await expectAccessible(page,`${item.path} phone form`);
      await page.locator('html').evaluate(element=>element.setAttribute('data-theme','memento-mori'));
      await expectAccessible(page,`${item.path} phone dark form`);
      await page.screenshot({path:`/tmp/vmn-phone-${item.path}.png`,fullPage:true});
      await page.locator('html').evaluate(element=>element.setAttribute('data-theme','light'));
      await page.setViewportSize({width:1100,height:800});
      await expect(dialog.getByLabel(item.field)).toHaveValue(item.value);
      await page.setViewportSize({width:390,height:700});
    }
    await page.route(`**/api/workspaces/${workspaceId}/${item.path}`,route=>route.fulfill({status:500,json:{error:{code:'internal_error'}}}),{times:1});
    await dialog.getByRole('button',{name:item.save,exact:true}).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button',{name:item.save,exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(item.value,{exact:true}).first()).toBeVisible();
  }
  await page.goto(`/w/${workspaceId}/lists/new`);
  const list=page.getByRole('dialog',{name:'New list',exact:true});
  await list.getByLabel('Name',{exact:true}).fill('Phone groceries');
  await list.getByRole('button',{name:'Create list',exact:true}).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Phone groceries',exact:true})).toBeVisible();
  await expect(page.getByRole('form',{name:'Add an item',exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeVisible();
  await page.goto(`/w/${workspaceId}/lists/new`);
  const todo = page.getByRole('dialog', { name: 'New list', exact: true });
  await todo.getByLabel('List type').selectOption({ label: 'To-do' });
  await todo.getByLabel('Name', { exact: true }).fill('Weekend prep');
  await todo.getByRole('button', { name: 'Create list', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Weekend prep', exact: true })).toBeVisible();
  const addTask = page.getByRole('form', { name: 'Add task', exact: true });
  await expect(addTask.getByLabel('Quantity', { exact: true })).toHaveCount(0);
  await expect(addTask.getByLabel('Unit', { exact: true })).toHaveCount(0);
  await addTask.getByLabel('Task', { exact: true }).fill('Charge the power bank');
  await addTask.getByRole('button', { name: 'Add task', exact: true }).click();
  const task = page.getByRole('list', { name: 'To do', exact: true }).getByRole('checkbox', { name: 'Charge the power bank' });
  await task.click();
  await expect(page.getByText('To-do · 1 of 1 done')).toBeVisible();
  const completed = page.getByRole('list', { name: 'Done (1)', exact: true });
  await expect(completed).toBeHidden();
  await page.getByText('Done (1)', { exact: true }).click();
  await completed.getByRole('checkbox', { name: /Charge the power bank/ }).click();
  await expect(task).toBeVisible();
  await expect(page.getByText('To-do · 0 of 1 done')).toBeVisible();
  await expectAccessible(page, 'To-do list');
  await page.getByRole('button', { name: 'More for the list Weekend prep' }).click();
  await page.getByRole('button', { name: 'List appearance', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'List appearance' });
  const travel = appearance.getByRole('button', { name: 'Travel', exact: true });
  await travel.click();
  await expect(travel).toHaveAttribute('aria-pressed', 'true');
  await appearance.getByLabel('Cover image').setInputFiles({ name: 'cover.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64') });
  await expectAccessible(page, 'List appearance');
  await appearance.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(appearance).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download original cover' })).toBeVisible();
  await page.getByRole('button', { name: 'More for the list Weekend prep' }).click();
  await page.getByRole('button', { name: 'List appearance', exact: true }).click();
  await appearance.getByRole('button', { name: 'Repair preview', exact: true }).click();
  await expect(appearance.getByText('Cover preview repaired.')).toBeVisible();
  await appearance.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: 'Lists', exact: true }).click();
  await page.getByRole('combobox', { name: 'Show lists' }).selectOption({ label: 'To-do' });
  const weekend = page.getByRole('link', { name: 'Open list Weekend prep' });
  await expect(weekend.locator('img')).toBeVisible();
  await expect.poll(() => weekend.locator('img').evaluate(image => Number(Reflect.get(image, 'naturalWidth')))).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'Open list Phone groceries' })).toHaveCount(0);
  const find = page.getByRole('searchbox', { name: 'Find a list' });
  await find.fill('not this one');
  await expect(weekend).toHaveCount(0);
  await find.clear();
  await expect(weekend).toBeVisible();
  await expectAccessible(page, 'Lists overview');
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 700 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  }

  const runId=await page.evaluate(async ({workspaceId,procedureId})=>{ const r=await fetch(`/api/workspaces/${workspaceId}/runs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({procedureId})});if(!r.ok)throw new Error('Run fixture');return (await r.json() as {run:{id:string}}).run.id; },{workspaceId,procedureId});
  await page.goto(`/w/${workspaceId}/runs/${runId}`);
  await expect(page.getByRole('button',{name:'Done: Check the door',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Done: Check the door',exact:true}).click();
  await expectAccessible(page,'Phone Run execution');
  if(mobile) { await page.setViewportSize({width:320,height:700}); expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true); }
  await page.goto(`/w/${workspaceId}/calendar`); await expectAccessible(page,'Calendar after authoring');
  await page.goto(`/w/${workspaceId}`); await expectAccessible(page,'Today after authoring');
});

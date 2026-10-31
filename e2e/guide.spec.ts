import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../packages/auth/src/password-hashing.ts';
import { openDatabase } from '../packages/database/src/connection.ts';
import { createUserRepository } from '../packages/database/src/user-repository.ts';
import { enableCoreTools, insertLegacyWorkspace } from '../packages/database/src/test-support.ts';
import { normalizeEmail } from '../packages/domain/src/user.ts';
import { DEFAULT_GUIDE_PREFERENCES } from '../packages/domain/src/preferences.ts';
import { guideServerEnv } from '../playwright.config.ts';
import { expectAccessible } from './a11y.ts';

// Direct fixture setup is limited to the disposable Playwright database; browser commands use real APIs.
test('Guide preserves routes, preferences, themes and private opt-in weather across desktop and phone', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
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
  } finally { database.close(); }
  const requests: string[] = []; const errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Content Security Policy')) errors.push(message.text()); });
  await page.goto('/');
  await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
  await page.goto(`/w/${workspaceId}`);
  const shell = page.locator('.shell');
  await expect(shell).toHaveAttribute('data-layout', 'guide');
  await expect(page.getByRole('heading', { name: /^Today/ })).toBeVisible();
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
  await expect(nav.getByRole('link')).toHaveText(['Today', 'Lists', 'Calendar']);
  await page.getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('link', { name: 'Profile & settings', exact: true })).toBeVisible();
  await expectAccessible(page, 'Guide top settings menu');
  await page.keyboard.press('Escape');
  const guideButton = page.getByRole('button', { name: 'Guide', exact: true });
  await guideButton.click();
  const dialog = page.getByRole('dialog', { name: 'Guide', exact: true });
  await expect(dialog.getByRole('link', { name: 'Equipment', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Lists', exact: true })).toBeVisible();
  await expectAccessible(page, 'Guide chooser');
  mkdirSync('assets/screenshots/release-42', { recursive: true });
  await page.screenshot({ path: `assets/screenshots/release-42/chooser-${testInfo.project.name}.png`, fullPage: true });
  await page.keyboard.press('Escape'); await expect(guideButton).toBeFocused();
  await guideButton.click(); await dialog.getByRole('link', { name: 'Lists', exact: true }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}/lists`);
  await expectAccessible(page, 'Guide List working page');
  await page.goBack(); await expect(page).toHaveURL(`/w/${workspaceId}`);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expectAccessible(page, `Guide Today ${width}`);
  }
  mkdirSync('assets/screenshots/release-42', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `assets/screenshots/release-42/today-${testInfo.project.name}.png`, fullPage: true });
  await page.goto('/account/appearance');
  const form = page.locator('.guide-appearance');
  await form.getByLabel('Card background', { exact: true }).selectOption('starfield');
  await form.getByRole('slider').focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < 28; i++) await page.keyboard.press('ArrowRight');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form.getByRole('status')).toHaveText('Interface settings saved.');
  await page.reload(); await expect(form.getByRole('slider')).toHaveValue('28');
  await page.evaluate('navigator.serviceWorker.ready.then(() => true)');
  await page.context().setOffline(true);
  await page.reload();
  await expect(shell).toHaveAttribute('data-card-style', 'starfield');
  await expect(form.getByRole('slider')).toHaveValue('28');
  await expect(page.getByRole('navigation', { name: 'Tools', exact: true }).getByRole('link')).toHaveText(['Today', 'Lists', 'Calendar']);
  await page.context().setOffline(false);
  await form.getByLabel('Interface', { exact: true }).selectOption('classic');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(shell).toHaveAttribute('data-layout', 'classic');
  await form.getByLabel('Interface', { exact: true }).selectOption('guide');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(shell).toHaveAttribute('data-layout', 'guide');
  await page.route('**/api/account/weather/forecast?*', route => route.fulfill({ json: { forecast: { provider: 'OPEN_METEO', current: { condition: 'SNOW', temperature: -1 }, days: [{ date: '2026-10-31', condition: 'SNOW', min: -3, max: 2 }] }, horizon: 1, location: { name: 'Fictional studio', timeZone: 'Europe/Berlin' }, fetchedAt: new Date().toISOString(), stale: false, fellBackFrom: null, unit: 'C', showTomorrow: false } }));
  expect((await post('/api/account/today', { layout: { version: 1, density: 'COMPACT', cards: [
    { id: 'clock', visible: true, size: 'NORMAL', options: { hour24: false } },
    { id: 'weather', visible: true, size: 'NORMAL', options: {} },
    { id: 'toBuy', visible: true, size: 'NORMAL', options: { lists: 3 } },
  ] } })).status).toBe(200);
  await page.goto(`/w/${workspaceId}`);
  await expect(page.getByRole('button', { name: /Snow.*Open forecast/ })).toBeVisible();
  await page.getByRole('button', { name: /Snow.*Open forecast/ }).click();
  await expect(page.getByRole('dialog', { name: 'Weather', exact: true })).toContainText('Fictional studio');
  await expectAccessible(page, 'expanded weather'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open clock and date' }).click();
  await expect(page.getByRole('dialog')).toContainText(/20\d\d/); await page.keyboard.press('Escape');
  for (const theme of ['system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places-de', 'places-it', 'places-uk', 'places-scotland', 'space-guide']) {
    expect((await post('/api/account/preferences', { theme })).status).toBe(200); await page.reload();
    await expect(page.getByRole('button', { name: 'Guide', exact: true })).toBeVisible();
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expectAccessible(page, `Guide theme ${theme}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.shell').evaluate(node => (node as unknown as { getAnimations(options: { subtree: boolean }): { playState: string }[] }).getAnimations({ subtree: true }).filter(a => a.playState === 'running').length)).toBe(0);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.guide-art').first()).toBeHidden();
  await page.emulateMedia({ forcedColors: 'none' });
  mkdirSync('assets/screenshots/release-42', { recursive: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: `assets/screenshots/release-42/guide-${testInfo.project.name}.png`, fullPage: true });
  expect((await post('/api/account/preferences', { guide: { ...DEFAULT_GUIDE_PREFERENCES, images: false, cardOpacity: 0 } })).status).toBe(200);
  await page.reload();
  await expect(shell).toHaveAttribute('data-guide-images', 'false');
  await expect(page.locator('.guide-art')).toHaveCount(0);
  await expect(shell).toHaveCSS('background-image', 'none');
  await expectAccessible(page, 'No decorative images and transparent card background');
  expect((await post('/api/account/preferences', { guide: { ...DEFAULT_GUIDE_PREFERENCES, cardOpacity: 100 } })).status).toBe(200);
  await page.reload();
  await expect(shell).toHaveCSS('--guide-card-opacity', '100%');
  await expectAccessible(page, 'Solid card background');
  expect(errors).toEqual([]);
  expect(requests.filter(url => !url.startsWith('http://127.0.0.1:3101/'))).toEqual([]);
  expect((await post('/api/account/preferences', { guide: DEFAULT_GUIDE_PREFERENCES })).status).toBe(200);
});

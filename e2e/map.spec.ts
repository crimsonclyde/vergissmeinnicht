import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { hashPassword } from '../packages/auth/src/password-hashing.ts';
import { openDatabase } from '../packages/database/src/connection.ts';
import { insertLegacyWorkspace } from '../packages/database/src/test-support.ts';
import { createUserRepository } from '../packages/database/src/user-repository.ts';
import { normalizeEmail } from '../packages/domain/src/user.ts';
import { serverEnv } from '../playwright.config.ts';

test('Map preserves a link draft, adds coordinates and keeps the list usable without tiles', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'mobile-chromium';
  if (phone) {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
  }
  const email = `map-${randomUUID()}@example.org`;
  const password = 'a fictional map review passphrase';
  const database = openDatabase(serverEnv.DATABASE_PATH);
  let workspaceId: string;
  try {
    const user = await createUserRepository(database).create({ email: normalizeEmail(email), displayName: 'Map reviewer', emailVerified: true,
      status: 'ACTIVE', serverAdmin: true });
    database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)")
      .run(randomUUID(), user.id, user.id, await hashPassword(password), Date.now(), Date.now());
    workspaceId = insertLegacyWorkspace(database, { name: 'Casa Nostra', adminUserId: user.id }).id;
    database.sqlite.prepare("INSERT INTO workspace_tools (workspace_id,tool,enabled,updated_at,updated_by_user_id) VALUES(?,'MAP',1,?,?)")
      .run(workspaceId, Date.now(), user.id);
  } finally { database.close(); }

  await page.route('**/map-assets/region.pmtiles', route => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}`);
  if (phone) {
    expect(await page.evaluate<boolean>(`fetch('/api/account/preferences', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: 'memento-mori' })
    }).then(response => response.ok)`)).toBe(true);
  }
  await page.goto(`/w/${workspaceId}/map`);
  if (phone) await expect(page.locator('html')).toHaveAttribute('data-theme', 'memento-mori');
  await expect(page.getByRole('heading', { name: 'Marauder’s Map' })).toBeVisible();
  await expect(page.getByText('Basemap unavailable.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Map', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Full screen', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Gerbontina');
  const editor = page.locator('form.vmn-map-editor');
  await editor.getByLabel('Category').selectOption('urbex');
  await page.getByLabel('Locality (optional)').fill('Creppo');
  await page.getByLabel('Add a location').selectOption('link');
  await editor.getByRole('textbox', { name: 'Open original link', exact: true }).fill('https://maps.app.goo.gl/mock-unresolved');
  await page.getByRole('button', { name: 'Save place', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gerbontina', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open original link', exact: true }).first()).toHaveAttribute('href', 'https://maps.app.goo.gl/mock-unresolved');
  await page.getByRole('button', { name: 'Edit place', exact: true }).click();
  await page.getByLabel('Add a location').selectOption('coordinates');
  await page.getByLabel('WGS 84 decimal latitude, longitude').fill('44.00166, 7.71564');
  await page.getByRole('button', { name: 'Save place', exact: true }).click();
  await page.getByRole('button', { name: 'Coordinates', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Coordinates' });
  await expect(sheet.getByText('44.00166, 7.71564')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.getByText('My visit · private', { exact: true }).click();
  await page.getByRole('button', { name: 'Want to go', exact: true }).click();
  await page.getByRole('button', { name: 'Record visit', exact: true }).click();
  await expect(page.getByText('Visited · date unspecified', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to browse' }).click();
  if (phone) await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Want to go', exact: true }).click();
  await expect(page.getByRole('button', { name: /Gerbontina/ }).last()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search places, towns or tags' }).fill('no match');
  await expect(page.getByText('No matching places', { exact: true })).toBeVisible();
  expect(await page.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);
  await page.getByRole('button', { name: 'Import preview', exact: true }).click();
  await page.getByRole('textbox', { name: 'Place JSON', exact: true }).fill(JSON.stringify([
    { name: 'Gerbontina', details: { locality: 'Creppo' } },
    { name: 'Case Bondazzo', details: { locality: 'Bregalla', sources: [{ url: 'https://example.org/route' }] } },
  ]));
  await page.getByRole('button', { name: 'Review draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gerbontina · Possible match', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save reviewed places', exact: true }).click();
  await expect(page.getByText('Saved 1. 0 could not be confirmed.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open saved place', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Case Bondazzo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to browse' }).click();
  await page.getByRole('button', { name: 'Add place', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Reviewed address');
  await page.getByLabel('Address', { exact: true }).fill('Via Roma 2, Soldano');
  await page.getByLabel('Add a location').selectOption('address');
  let lookups = 0;
  await page.route('**/map/address-search', async route => {
    expect(route.request().postDataJSON()).toEqual({ query: 'Reviewed address, Via Roma 2, Soldano', consent: true });
    lookups++;
    await route.fulfill({ json: { candidates: [{ label: 'Via Roma 2, Soldano', latitude: 43.82, longitude: 7.65,
      approximate: true, sourceUrl: 'https://www.openstreetmap.org/node/123' }] } });
  });
  expect(lookups).toBe(0);
  await expect(page.getByText('Find sends this search to Photon (komoot).', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Find location', exact: true }).click();
  await page.getByRole('button', { name: 'Use this location', exact: true }).click();
  await expect(page.getByLabel('WGS 84 decimal latitude, longitude')).toHaveValue('43.82, 7.65');
  await expect(page.getByRole('checkbox', { name: 'Approximate area', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Save place', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reviewed address', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Coordinates', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Coordinates' }).getByText('43.82, 7.65')).toBeVisible();
  expect(lookups).toBe(1);

});

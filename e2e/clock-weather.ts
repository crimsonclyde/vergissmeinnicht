import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { expectAccessible } from './a11y.ts';

/** Called inside a signed-in disposable Guide fixture; all weather is intercepted sample data. */
export async function checkClockWeather(page: Page, workspaceId: string, screenshots: boolean) {
  expect(await page.locator('.today [data-card]').evaluateAll(nodes => nodes.slice(0,3).map(node => node.getAttribute('data-card')))).toEqual(['clock','weather','moon']);
  await expect(page.locator('[data-card="hero"]')).toBeVisible();
  await page.getByRole('link', { name: /Snow.*Open forecast/ }).click();
  await expect(page).toHaveURL('/weather');
  await expect(page.getByRole('heading', { name: 'Weather', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.instrument-weather')).toContainText('Fictional studio');
  await expectAccessible(page, 'dedicated Weather');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(`/w/${workspaceId}`);
  await page.getByRole('link', { name: 'Open clock and date', exact: true }).first().click();
  await expect(page).toHaveURL('/clock');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const modes = page.getByRole('group', { name: 'Clock mode' });
  await modes.getByRole('button', { name: 'Stopwatch', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Record lap' }).click();
  await expect(page.locator('.instrument-laps li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.locator('.instrument-time').innerText();
  await page.waitForTimeout(1100);
  await expect(page.locator('.instrument-time')).toHaveText(paused);
  await modes.getByRole('button', { name: 'Timer', exact: true }).click();
  await page.getByLabel('Custom minutes (1–1440)').fill('0');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await page.getByLabel('Custom minutes (1–1440)').fill('1');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.locator('.instrument-caption')).toHaveText('Running');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('link', { name: 'Open clock and date', exact: true }).first().click();
  await expect(page.locator('.instrument-caption')).toHaveText('Running');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByLabel('Custom minutes (1–1440)').fill('25');
  await page.getByLabel('Custom minutes (1–1440)').blur();
  await modes.getByRole('button', { name: 'Stopwatch', exact: true }).click();
  await expect(page.locator('.instrument-laps li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await modes.getByRole('button', { name: 'Clock', exact: true }).click();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expectAccessible(page, `Clock screen ${width}`);
  }
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.goto('/account/today');
  const clock = page.locator('.today-settings-card').filter({ has: page.getByText('Clock & date', { exact: true }) }).getByRole('checkbox').first();
  // Save through the real account endpoint and wait for each confirmed mutation.
  const setClock = async (checked: boolean) => {
    const saved = page.waitForResponse(response => response.url().endsWith('/api/account/today') && response.request().method() === 'POST');
    await clock.setChecked(checked); expect((await saved).ok()).toBe(true);
  };
  await setClock(false);
  await page.goto(`/w/${workspaceId}`);
  await expect(page.locator('[data-card="clock"]')).toHaveCount(0);
  await expect(page.locator('[data-card="weather"]')).toBeVisible();
  await page.goto('/account/today'); await setClock(true);
  await page.reload(); await expect(clock).toBeChecked();

  const setInstrument = async (name: string, checked: boolean) => {
    const response = page.waitForResponse(response => response.url().endsWith('/api/account/today') && response.request().method() === 'POST');
    await page.locator('.today-settings-card').getByLabel(name, { exact: true }).setChecked(checked);
    expect((await response).ok()).toBe(true);
  };
  await setInstrument('Celestial', false);
  await setInstrument('Weather', false);
  let automaticForecasts = 0;
  const track = (request: { url(): string }) => { if (request.url().includes('/api/account/weather/forecast')) automaticForecasts++; };
  page.on('request', track);
  await page.goto(`/w/${workspaceId}`);
  await expect(page.locator('[data-card="clock"]')).toBeVisible();
  await expect(page.locator('[data-card="moon"]')).toHaveCount(0);
  await expect(page.locator('[data-card="weather"]')).toHaveCount(0);
  expect(automaticForecasts).toBe(0);
  await page.goto('/account/today');
  await page.getByRole('link', { name: 'Open Weather', exact: true }).click();
  await expect(page.locator('.instrument-weather')).toBeVisible();
  expect(automaticForecasts).toBe(1); // Explicit opening is allowed without enabling the Today tile.
  page.off('request', track);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL('/account/today');
  await setInstrument('Celestial', true);
  await setInstrument('Weather', true);

  if (screenshots) {
    const directory = 'assets/screenshots/readme-2026-11-03';
    mkdirSync(directory, { recursive: true });
    const theme = async (value: string) => {
      const status = await page.evaluate(async value => (await fetch('/api/account/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: value }) })).status, value);
      expect(status).toBe(200);
    };
    for (const value of ['space-guide', 'memento-mori']) {
      await theme(value); await page.setViewportSize({ width: 1440, height: 1100 });
      await page.goto(`/w/${workspaceId}`); await expect(page.locator('[data-card="weather"]')).toBeVisible();
      await page.screenshot({ path: `${directory}/today-${value}.png`, fullPage: true });
      await page.getByRole('link', { name: 'Open clock and date', exact: true }).first().click();
      await page.screenshot({ path: `${directory}/clock-${value}.png`, fullPage: true });
      await page.goto('/weather'); await expect(page.locator('.instrument-weather')).toBeVisible();
      await page.screenshot({ path: `${directory}/weather-${value}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 1000 }); await page.goto('/clock');
    await page.getByRole('button', { name: 'Timer', exact: true }).click();
    await page.screenshot({ path: `${directory}/timer-phone.png`, fullPage: false });
    await page.goto('/account/today');
    await expect(page.getByRole('list', { name: 'Cards', exact: true })).toBeVisible();
    await page.locator('.today-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/personalize-phone.png`, fullPage: false });
  }
  await page.goto(`/w/${workspaceId}`);
}

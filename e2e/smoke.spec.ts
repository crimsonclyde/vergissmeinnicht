import { expect, test } from '@playwright/test';

test('production server serves the web app and API from one origin', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vergissmeinnicht' })).toBeVisible();
  // AGPL-3.0 §13: every page offers the source code, also before signing in.
  await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute('href', 'https://github.com/crimsonclyde/vergissmeinnicht');

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
});

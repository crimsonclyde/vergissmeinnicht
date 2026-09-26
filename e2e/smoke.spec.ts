import { expect, test } from '@playwright/test';

test('production server serves the web app and API from one origin', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Vergissmeinnicht' })).toBeVisible();

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
});

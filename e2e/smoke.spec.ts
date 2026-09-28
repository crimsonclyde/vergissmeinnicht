import { expect, test } from '@playwright/test';

test('production server serves the web app and API from one origin', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'VergissMeinNicht' })).toBeVisible();
  // AGPL-3.0 §13: every page offers the source code, also before signing in.
  // Located regardless of visibility: the account flow may hide the footer (admin setting) meanwhile.
  const footer = page.locator('footer.app-footer');
  await expect(footer).toHaveText('VergissMeinNicht (VMN) with 🖤 by CrimsonClyde - Licence: AGPL-3.0');
  await expect(footer.locator('a', { hasText: 'VergissMeinNicht (VMN)' })).toHaveAttribute('href', 'https://github.com/crimsonclyde/vergissmeinnicht');
  await expect(footer.locator('a', { hasText: 'AGPL-3.0' })).toHaveAttribute('href', 'https://www.gnu.org/licenses/agpl-3.0.html');
  await expect(footer.locator('[role="img"][aria-label="love"]')).toHaveText('🖤');

  // Licenses of the bundled third-party packages (10.4).
  const notices = await request.get('/third-party-notices.txt');
  expect(notices.ok()).toBe(true);
  expect(await notices.text()).toMatch(/react@\d+\.\d+\.\d+ \(MIT\)/);

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });
});

import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('Old Forest stays decorative, responsive and static when requested', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('vmn.theme', 'witch-forest'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  // Auth resolution remounts the public scene; Chromium may retry the same in-flight image.
  // Check the asset variants, so a desktop image fetched on a phone still fails this assertion.
  await expect.poll(() => [...new Set(requests.filter((url) => /old-forest-.*\.webp/.test(url)))]).toEqual([expect.stringMatching(test.info().project.name === 'mobile-chromium' ? /old-forest-portrait/ : /old-forest-(wide|medium)/)]);
  const forest = page.locator('.forest');
  await expect(forest).toHaveAttribute('aria-hidden', 'true');
  await expect(forest).toHaveCSS('pointer-events', 'none');
  expect(await forest.locator('*').count()).toBeLessThan(30);
  expect(await page.locator('.forest-fireflies span').count()).toBe(10);
  expect(await forest.evaluate((node) => (node as unknown as { getAnimations(options: { subtree: boolean }): { playState: string }[] }).getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);

  for (const [width, height] of [[320, 740], [375, 812], [430, 932], [768, 1024], [1024, 768], [1440, 1000], [2560, 1080], [844, 390]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.locator('.forest-art').evaluate((image) => (image as unknown as { currentSrc: string }).currentSrc)).toMatch(width <= 600 ? /old-forest-portrait/ : /old-forest-(wide|medium)/);
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(requests.some((url) => url.includes('/api/account/weather'))).toBe(false);
  expect(requests.filter((url) => !url.startsWith('http://127.0.0.1:3100/'))).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.forest-fog-far')).toHaveCSS('animation-name', 'wf-drift');
  await page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));");
  await expect(forest).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('.forest-fog-far')).toHaveCSS('animation-play-state', 'paused');
  await page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));");
  await expect(forest).toHaveAttribute('data-paused', 'false');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(forest).toHaveCSS('display', 'none');
  await expect(page.locator('.public-main')).toHaveCSS('text-shadow', 'none');
});

test('other themes do not load the Old Forest images or personal location', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('vmn.theme', 'light'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('.forest')).toHaveCount(0);
  expect(requests.filter((url) => /old-forest|old-ivy|\/api\/account\/weather/.test(url))).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { expectAccessible } from './a11y.ts';

test('Places landscape is responsive, private before sign-in and still when requested', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.addInitScript(() => localStorage.setItem('vmn.theme', 'places-it'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const scene = page.locator('.place-scene');
  await expect(scene).toHaveAttribute('aria-hidden', 'true');
  await expect(scene).toHaveCSS('pointer-events', 'none');
  for (const [width,height] of [[320,740],[390,844],[1440,1000],[2560,1080],[844,390]] as const) {
    await page.setViewportSize({ width,height });
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    await expect.poll(() => scene.locator('.place-art').evaluate(image => (image as unknown as {currentSrc:string}).currentSrc)).toMatch(width <= 600 ? /landscape-(phone|portrait)/ : /landscape-(wide|small)/);
  }
  expect(await scene.evaluate(element => (element as unknown as {getAnimations(options:{subtree:boolean}):{playState:string}[]}).getAnimations({subtree:true}).filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.setViewportSize({width:320,height:740});
  await expectAccessible(page,'Places sign-in on a narrow phone');
  expect(requests.filter(url=>url.includes('/api/account/')||url.includes('/api/workspaces/'))).toEqual([]);
  expect(requests.filter(url=>!url.startsWith('http://127.0.0.1:3100/'))).toEqual([]);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(scene.locator('.place-mist')).toHaveCSS('animation-name','place-drift');
  await page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));");
  await expect(scene).toHaveAttribute('data-paused','true');
  await expect(scene.locator('.place-mist')).toHaveCSS('animation-play-state','paused');
  await page.emulateMedia({forcedColors:'active'});
  await expect(scene).toHaveCSS('display','none');
  await expect(page.locator('.public-main')).toHaveCSS('text-shadow','none');
});

test('other themes load no Places artwork or private Places data', async ({page})=>{
  const requests:string[]=[];page.on('request',request=>requests.push(request.url()));
  await page.addInitScript(()=>localStorage.setItem('vmn.theme','light'));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.locator('.place-scene')).toHaveCount(0);
  expect(requests.filter(url=>/landscape-|\/api\/account\/places/.test(url))).toEqual([]);
});

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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
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
 const email=`notes-${randomUUID()}@example.org`;const password='a fictional notebook passphrase';const database=openDatabase(guideServerEnv.DATABASE_PATH);let workspaceId:string;
 try{const user=await createUserRepository(database).create({email:normalizeEmail(email),displayName:'Notebook reviewer',emailVerified:true,status:'ACTIVE',serverAdmin:false});database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());workspaceId=insertLegacyWorkspace(database,{name:'Fictional notebook studio',adminUserId:user.id}).id;enableCoreTools(database,workspaceId,user.id);}finally{database.close();}
 const errors:string[]=[];const requests:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 await page.goto(`/w/${workspaceId}`);
 await page.evaluate(async id=>{const response=await fetch(`/api/workspaces/${id}/tools`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'JOURNAL',enabled:true,expectedRevision:(await fetch(`/api/workspaces/${id}`).then(response=>response.json()) as {toolsRevision:number}).toolsRevision})});if(!response.ok)throw new Error('tool fixture '+response.status+' '+await response.text());},workspaceId);
 await page.reload();await page.getByRole('button',{name:'Add',exact:true}).click();await expect(page.getByRole('button',{name:/Journal entry — Personal/})).toBeVisible();await page.getByRole('button',{name:/Note — Workspace/}).click();
 await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();await page.getByLabel('Title',{exact:true}).fill('A portable garden note');
 const editor=page.locator('.milkdown .ProseMirror');await expect(editor).toBeVisible();await editor.fill('Written visually.');await page.getByRole('button',{name:'Markdown source',exact:true}).click();
 const source=page.getByLabel('Markdown source',{exact:true});await expect(source).toHaveValue(/Written visually/);
 const markdown='# Garden\n\n## Materials\n\n- [ ] Bring seeds\n- [x] Find gloves\n\n| Item | Amount |\n| --- | --- |\n| Seeds | 2 |\n\n```javascript\nconst seeds = 2;\n```\n';
 await source.fill(markdown);await page.getByRole('button',{name:'Visual',exact:true}).click();await expect(page.getByRole('cell',{name:'Seeds',exact:true})).toBeVisible();await expectAccessible(page,'Visual Markdown editor');await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(source).toHaveValue(/const seeds = 2/);await expect(source).toHaveValue(/Bring seeds/);
 await page.getByText('Images and originals',{exact:true}).click();await page.getByLabel('Upload original image',{exact:true}).setInputFiles({name:'garden.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64')});
 await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();await expectAccessible(page,'Notes editor');
 await page.screenshot({path:testInfo.outputPath('notes-editor.png'),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Export Markdown',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('notes.zip');
 await page.getByRole('button',{name:'Back to entries',exact:true}).click();await page.goto(`/w/${workspaceId}`);await page.getByRole('button',{name:'Add',exact:true}).click();await page.getByRole('button',{name:/Journal entry — Personal/}).click();
 await expect(page.getByRole('heading',{name:'Your personal Journal',exact:true})).toBeVisible();
 expect(await page.evaluate(async()=>fetch('/api/account/journal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:{kind:'note',version:2,title:'Before consent',date:null,body:''},expectedRevision:0,archived:false})}).then(response=>response.status))).toBe(403);
 await page.getByRole('button',{name:'Agree & Continue',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('A personal notebook');await page.getByRole('button',{name:'Markdown source',exact:true}).click();await page.getByLabel('Markdown source',{exact:true}).fill('Only this account.');await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
 await page.getByLabel('Markdown source',{exact:true}).fill('A recoverable private draft.');await expect(page.getByRole('status').filter({hasText:'Draft saved for recovery.'})).toBeVisible();
 page.once('dialog',dialog=>void dialog.accept());await page.reload();await expect(page.getByRole('heading',{name:'Your personal Journal',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Recover saved draft',exact:true}).click();await page.getByRole('button',{name:'Markdown source',exact:true}).click();await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue('A recoverable private draft.');
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();await expectAccessible(page,'Personal Journal editor');
 for(const theme of ['light','memento-mori','tokyo-nights','witch-forest','places-de','space-guide']){
  expect(await page.evaluate(async theme=>fetch('/api/account/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme})}).then(response=>response.status),theme)).toBe(200);
  await page.reload();await expect(page.getByLabel('Title',{exact:true})).toHaveValue('A personal notebook');
  await expectAccessible(page,`Journal ${theme}`);
  if(theme==='memento-mori')await page.screenshot({path:testInfo.outputPath('journal-dark.png'),fullPage:true});
 }
 if(testInfo.project.name.includes('mobile'))await page.setViewportSize({width:320,height:720});
 expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true);expect(errors).toEqual([]);expect(requests.every(url=>url.startsWith(guideServerEnv.PUBLIC_ORIGIN))).toBe(true);
});

test('Recipes preserve originals and transfer ingredients for the requested servings', async ({page},testInfo)=>{
 test.setTimeout(180_000);page.setDefaultTimeout(15_000);
 if(testInfo.project.name.includes('mobile'))await page.setViewportSize({width:320,height:720});
 const email=`recipes-${randomUUID()}@example.org`;const password='a fictional pancake passphrase';const database=openDatabase(guideServerEnv.DATABASE_PATH);let workspaceId:string;
 try{const user=await createUserRepository(database).create({email:normalizeEmail(email),displayName:'Recipe reviewer',emailVerified:true,status:'ACTIVE',serverAdmin:false});database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());workspaceId=insertLegacyWorkspace(database,{name:'Fictional kitchen',adminUserId:user.id}).id;enableCoreTools(database,workspaceId,user.id);}finally{database.close();}
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 const listId=await page.evaluate(async id=>{let response=await fetch(`/api/workspaces/${id}/tools`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'RECIPES',enabled:true,expectedRevision:((await fetch(`/api/workspaces/${id}`).then(response=>response.json())) as {toolsRevision:number}).toolsRevision})});if(!response.ok)throw new Error('Recipe tool fixture '+response.status+' '+await response.text());response=await fetch(`/api/workspaces/${id}/lists`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Pancake shopping'})});if(!response.ok)throw new Error('List fixture');return ((await response.json()) as {list:{id:string}}).list.id;},workspaceId);
 await page.goto(`/w/${workspaceId}/recipes`);await page.getByRole('button',{name:'New recipe',exact:true}).click();await page.getByLabel('Title',{exact:true}).fill('Pancakes for breakfast');
 const ingredient=(count:number)=>page.getByRole('group',{name:`Ingredient ${count}`,exact:true});
 await ingredient(1).getByLabel('Ingredient name',{exact:true}).fill('Flour');await ingredient(1).getByLabel('Amount',{exact:true}).fill('125');await ingredient(1).getByLabel('Unit',{exact:true}).fill('g');
 await page.getByRole('button',{name:'Add ingredient',exact:true}).click();await ingredient(2).getByLabel('Ingredient name',{exact:true}).fill('Eggs');await ingredient(2).getByLabel('Amount',{exact:true}).fill('1');
 await page.getByRole('button',{name:'Markdown source',exact:true}).click();await page.getByLabel('Markdown source',{exact:true}).fill('Mix the batter.\n\nCook in a warm pan.');
 await page.getByText('Images and originals',{exact:true}).click();await expect(async()=>{const response=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/recipes/attachments'));await page.getByLabel('Upload original image',{exact:true}).setInputFiles({name:'pancakes.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64')});expect((await response).status()).toBe(201);}).toPass({timeout:15000,intervals:[500,1000,2000]});
 await expect(page.getByLabel('Markdown source',{exact:true})).toHaveValue(/attachments\/[0-9a-f-]+\.png/);
 await page.getByRole('button',{name:'Save recipe',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Recipe saved.'})).toBeVisible();await expect(page.getByRole('img',{name:/pancakes.png/})).toBeVisible();
 await page.getByLabel('Shopping for this many servings',{exact:true}).fill('4');await expect(ingredient(1).getByLabel('Amount',{exact:true})).toHaveValue('250');await expect(ingredient(2).getByLabel('Amount',{exact:true})).toHaveValue('2');
 await page.getByRole('button',{name:'Add selected ingredients',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'2 ingredients added.'})).toBeVisible();await expectAccessible(page,'Recipe and grocery transfer');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Export recipe',exact:true}).click();expect((await downloadPromise).suggestedFilename()).toBe('recipes.zip');
 await page.screenshot({path:testInfo.outputPath('recipe.png'),fullPage:true});expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
 await page.goto(`/w/${workspaceId}/lists/${listId}`);await expect(page.getByRole('list',{name:'To buy'})).toContainText('Flour');await expect(page.getByRole('list',{name:'To buy'})).toContainText('250');await expect(page.getByRole('list',{name:'To buy'}).getByRole('listitem')).toHaveCount(2);expect(errors).toEqual([]);
});

test('MCP requires visible consent and supports revoking a scoped user connection',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const email=`mcp-${randomUUID()}@example.org`,password='a fictional assistant review passphrase';const database=openDatabase(guideServerEnv.DATABASE_PATH);let workspaceId:string;
 try{const user=await createUserRepository(database).create({email:normalizeEmail(email),displayName:'Assistant reviewer',emailVerified:true,status:'ACTIVE',serverAdmin:false});database.sqlite.prepare("INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,'credential',?,?,?,?)").run(randomUUID(),user.id,user.id,await hashPassword(password),Date.now(),Date.now());workspaceId=insertLegacyWorkspace(database,{name:'Fictional assistant kitchen',adminUserId:user.id}).id;enableCoreTools(database,workspaceId,user.id);}finally{database.close();}
 await page.goto('/');await page.getByLabel('Email').fill(email);await page.getByLabel('Password').fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:/^Settings/})).toBeVisible();
 const client=await page.evaluate(async()=>{const r=await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Fictional AI assistant',redirect_uris:['https://client.example.org/callback'],token_endpoint_auth_method:'none'})});return await r.json() as {client_id:string};});
 const authorization=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://client.example.org/callback',response_type:'code',code_challenge:'a'.repeat(43),code_challenge_method:'S256',scope:'workspaces.read lists.read lists.write',resource:guideServerEnv.PUBLIC_ORIGIN+'/mcp'});
 await page.goto('/authorize?'+authorization);await expect(page.getByRole('heading',{name:'Connect Fictional AI assistant'})).toBeVisible();await expectAccessible(page,'MCP consent');
 await page.getByRole('checkbox',{name:'Fictional assistant kitchen',exact:true}).check();await page.getByRole('checkbox',{name:'Add grocery items',exact:true}).check();await page.route('https://client.example.org/**',route=>route.fulfill({contentType:'text/plain',body:'Fictional OAuth callback'}));
 await page.getByRole('button',{name:'Allow connection',exact:true}).click();await expect(page).toHaveURL(/^https:\/\/client.example.org\/callback\?code=/);
 await page.goto(guideServerEnv.PUBLIC_ORIGIN+'/account/connections');await expect(page.getByText('Fictional AI assistant',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Revoke connection',exact:true}).click();await expect(page.getByText('Revoked',{exact:true})).toBeVisible();await page.evaluate('window.scrollTo(0,0)');await expectAccessible(page,'MCP revoked connection');
 await page.setViewportSize({width:320,height:850});expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
});

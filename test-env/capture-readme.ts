/** README gallery: the running app, an isolated fictional Workspace, authorized APIs only. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const root = resolve(import.meta.dirname, '..');
const origin = 'http://127.0.0.1:3200';
const password = /Password for every demo account:\s*(\S+)/.exec(readFileSync(resolve(root, '.var/test-env/credentials.txt'), 'utf8'))?.[1];
if (password === undefined) throw new Error('Requires the isolated test-env seed');
const only = process.env.VMN_CAPTURE_ONLY?.split(',');
const output = resolve(root, 'assets/screenshots/readme-2026-10-28'); mkdirSync(output, { recursive: true });
const sharp = createRequire(resolve(root, 'packages/media/package.json'))('sharp') as typeof import('../packages/media/node_modules/sharp/lib/index.js');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
const page = await context.newPage(); page.setDefaultTimeout(20_000);
const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.name));
const checks: object[] = [];
try {
 await page.goto(origin); await page.getByLabel('Email', { exact: true }).fill('admin@vmn.test'); await page.getByLabel('Password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('combobox', { name: 'Workspace', exact: true }).waitFor();
 const api = async (path: string, body?: unknown) => page.evaluate(async ({ path, body }) => {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) { const error = await response.json() as { error: string; field?: string }; throw new Error(`Fictional demo request failed (${response.status}, ${error.error}, ${error.field ?? ''}) at ${path.split('?')[0]}`); }
  const text = await response.text(); return text === '' ? null : JSON.parse(text);
 }, { path, body });
 let workspace = (await api('/workspaces')).workspaces.find((row: { name: string }) => row.name === 'Northstar studio');
 const fresh = workspace === undefined;
 if (fresh) workspace = (await api('/workspaces', { name: 'Northstar studio' })).workspace;
 const base = `/workspaces/${workspace.id}`; const home = `/w/${workspace.id}`;
 for (const tool of ['PROCEDURES','REMINDERS','LISTS','CALENDAR','DOCUMENTS','CONTACTS','MAINTENANCE','EQUIPMENT','JOURNAL','BRING','MOON']) {
  const current = await api(`${base}/tools`); if (!current.tools.includes(tool)) await api(`${base}/tools`, { tool, enabled: true, expectedRevision: current.revision });
 }
 const day = (delta = 0) => { const date = new Date(); date.setDate(date.getDate() + delta); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
 if ((await api(`${base}/lists`)).lists.length === 0) {
  const step = (title: string, description = '') => ({ title, description, required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' });
  const existingProcedures = (await api(`${base}/procedures`)).procedures;
  const procedure = async (title: string, description: string, sections: { title: string; steps: ReturnType<typeof step>[] }[]) => existingProcedures.find((row: { title: string }) => row.title === title) ?? (await api(`${base}/procedures`, { title, description, icon: 'checklist', sections })).procedure;
  await procedure('Open the studio', 'A clear start for everyone sharing the space.', [{ title: 'Welcome', steps: [step('Unlock and check the entrance'),step('Open the blinds'),step('Check the day’s bookings')] }, { title: 'Ready to work', steps: [step('Switch on the workstations'),step('Prepare the shared table')] }]);
  const closing = await procedure('Close for the day', 'Leave the workspace ready for the next person.', [{ title: 'Workstations', steps: [step('Back up today’s work','Check that the shared drive has finished syncing.'),step('Clear the shared table'),step('Switch off the equipment','Power down monitors, lights and workshop tools. Leave the network running.')] },{ title: 'Before you leave', steps: [step('Check the windows'),step('Set the alarm'),step('Lock the entrance')] }]);
  await procedure('Prepare the field kit', 'Everything checked before a day on location.', [{ title: 'Pack', steps: [step('Charge the batteries'),step('Format the memory cards'),step('Check the tripod and cables'),step('Pack the first-aid kit')] }]);
  const previousRuns = (await api(`${base}/runs?state=ACTIVE`)).runs;
  const run = previousRuns.length ? (await api(`${base}/runs/${previousRuns[0].id}`)).run : (await api(`${base}/runs`, { procedureId: closing.id })).run;
  for (const step of run.sections[0].steps.slice(0,2).filter((row: { state: string }) => row.state === 'PENDING')) await api(`${base}/runs/${run.id}/steps/${step.id}/state`, { expectedState: 'PENDING', state: 'DONE' });
  for (const [title, delta] of [['Check the first-aid kit',0],['Renew the studio insurance',2],['Book the annual safety inspection',4]] as const) await api(`${base}/schedules`, { kind: 'REMINDER', title, date: day(delta), timeZone: 'Europe/Berlin', reminders: [] });
  const list = (await api(`${base}/lists`, { title: 'Supplies for the week' })).list;
  for (const title of ['Coffee beans','Oat milk','Paper towels','Washing-up liquid']) await api(`${base}/lists/${list.id}/items`, { title });
  for (const content of [{ title:'Bring the field kit',from:'Studio',to:'Location',dueDate:day(1),assigneeId:null,notes:'Camera, tripod and charged batteries.' },{ title:'Return the spare keys',from:'Workshop',to:'Studio',dueDate:day(0),assigneeId:null,notes:'' }]) await api(`${base}/bring`, { content, expectedRevision:0 });
  for (const record of [{ name:'Studio projector',manufacturer:'Northstar',model:'P-240',replacementParts:'Air filter NF-24 · Lamp NL-240',customFields:[{label:'Ceiling mount',value:'VESA 100 × 100'}] },{ name:'Coffee machine',manufacturer:'Example Works',model:'Barista 8',replacementParts:'Water filter WF-08 · Cleaning tablets CT-2' },{ name:'Portable power station',manufacturer:'Field Supply',model:'Ranger 600',replacementParts:'USB-C cable 100 W · DC charging lead' }]) await api(`${base}/equipment`, record);
  for (const [title, delta] of [['Clean the projector filter',3],['Test the emergency lighting',7],['Service the coffee machine',12]] as const) await api(`${base}/maintenance`, { title, category:'Studio', date:day(delta) });
  await api(`${base}/contacts`, { name:'Alex Morgan',organisation:'Northstar studio',category:'Team',emails:[{value:'alex@example.org'}] });
  await api(`${base}/journal`, { content:{kind:'note',version:1,title:'A good day in the studio',date:day(),body:'The shared space is ready for tomorrow.\n\nThe field kit is packed, the new projector filter is on the shelf, and the handover notes are up to date.'},expectedRevision:0,archived:false });
  const location = await api(`${base}/location`);
  await api(`${base}/location`,{location:{name:'Munich',latitude:48.14,longitude:11.58,timeZone:'Europe/Berlin'},expectedLocation:location.location});
  const folder = (await api(`${base}/document-folders`, { name:'Studio reference',parentId:null })).folder;
  for (const title of ['Studio handbook','Projector quick guide','Safety inspection']) {
   const bytes = [...readFileSync(resolve(root,'packages/media/src/fixtures/three-pages.pdf'))];
   const fileId = await page.evaluate(async ({ path, bytes, name }) => { const response = await fetch(path,{method:'POST',headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(name)},body:new Uint8Array(bytes)}); if(!response.ok)throw new Error('Fictional upload refused'); return ((await response.json()) as { file: { id: string } }).file.id; },{path:`/api${base}/document-files`,bytes,name:title+'.pdf'});
   await api(`${base}/documents`,{title,folderId:folder.id,fileIds:[fileId],tags:['studio'],notes:'Fictional demo record; pages are a repository test fixture.'});
  }
 }
 await api('/account/workspace-preferences/theme',{workspaceId:workspace.id,theme:null});
 await api('/account/today',{layout:{version:1,density:'COMPACT',cards:[{id:'clock',visible:true,options:{hour24:true}},{id:'moon',visible:false},{id:'weather',visible:false},{id:'progress',visible:false}]}});
 const procedures = (await api(`${base}/procedures`)).procedures;
 const runs = (await api(`${base}/runs?state=ACTIVE`)).runs;
 const run = (await api(`${base}/runs/${runs[0].id}`)).run;
 const closing = procedures.find((row:{title:string})=>row.title==='Close for the day');
 const grocery = (await api(`${base}/lists`)).lists[0];
 const captures: [string,string,number,number,string][] = [
  ['today-memento',home,1440,1000,'memento-mori'],['today-light',home,1440,1000,'light'],
  ['procedures',home+'/procedures',1440,1000,'light'],['builder',home+`/procedures/${closing.id}/edit`,1440,1000,'light'],
  ['equipment',home+'/equipment',1440,1000,'memento-mori'],['documents',home+'/documents',1440,1000,'light'],
  ['journal',home+'/journal',1440,1000,'light'],
  ['run-phone',home+`/runs/${run.id}/sections/${run.sections[0].id}`,390,844,'memento-mori'],
  ['bring-phone',home+'/bring',390,844,'light'],['lists-phone',home+`/lists/${grocery.id}`,390,844,'memento-mori'],
  ['tokyo-nights',home,1440,1000,'tokyo-nights'],['old-forest',home,1440,1000,'witch-forest'],
  ['munich',home,1440,1000,'places-de'],['triora',home,1440,1000,'places-it'],['london',home,1440,1000,'places-uk'],['scotland',home,1440,1000,'places-scotland'],
 ];
 const chosen = only === undefined ? captures : captures.filter(([name]) => only.includes(name));
 if(only !== undefined && chosen.length !== only.length)throw new Error('Unknown capture name');
 for(const [name,path,width,height,theme] of chosen){
  await page.setViewportSize({width,height});await api('/account/preferences',{theme});await page.goto(origin+path);await page.locator('main').waitFor();
  if(name === 'journal')await page.getByRole('button',{name:/A good day in the studio/}).click();
  await page.waitForTimeout(1800); await page.evaluate('document.fonts.ready'); await page.mouse.move(0,0);
  const alerts=await page.getByRole('alert').allTextContents();if(alerts.length)throw new Error(`Alert on ${name}`);
  if(await page.evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error(`Overflow on ${name}`);
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  if(a11y.violations.length)throw new Error(`Accessibility on ${name}: ${a11y.violations.map(row=>row.id).join(', ')}`);
  const png=await page.screenshot({fullPage:false,animations:'disabled'});await sharp(png).webp({quality:87}).toFile(resolve(output,name+'.webp'));
  checks.push({name,theme,viewport:{width,height},overflow:false,axeViolations:0});console.log(`Captured ${name}`);await page.waitForTimeout(2500);
 }
 // The visible choices collapse the legacy id without changing old account/Workspace values.
 await api('/account/preferences',{theme:'dark'});await page.goto(origin+'/account/appearance');
 await expect(page.locator('html')).toHaveAttribute('data-theme','memento-mori');await expect(page.getByRole('radio',{name:/^Memento Mori/})).toBeChecked();
 await expect(page.getByRole('radio',{name:/^Dark/})).toHaveCount(0);await expect(page.getByRole('radio',{name:/^Don't go into the/})).toHaveCount(1);
 await api('/account/workspace-preferences/theme',{workspaceId:workspace.id,theme:'dark'});await page.goto(origin+home);
 await expect(page.locator('html')).toHaveAttribute('data-theme','memento-mori');
 await page.goto(origin+'/account/appearance');
 await expect(page.locator('.workspace-look').filter({hasText:'Northstar studio'}).getByRole('combobox')).toHaveValue('memento-mori');
 const saved = await api('/account/workspace-preferences');
 if(saved.workspacePreferences.themes[workspace.id] !== 'dark')throw new Error('Legacy preference was unexpectedly rewritten');
 await api('/account/workspace-preferences/theme',{workspaceId:workspace.id,theme:null});

 for(const theme of ['light','memento-mori']){
  await api('/account/preferences',{theme});await page.setViewportSize({width:320,height:844});await page.goto(origin+home);await page.waitForTimeout(1000);
  if(await page.evaluate('document.documentElement.scrollWidth > innerWidth'))throw new Error('320px theme overflow');
  const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();if(a11y.violations.length)throw new Error('320px theme accessibility');
  checks.push({name:'minimum-width-'+theme,viewport:{width:320,height:844},overflow:false,axeViolations:0});
 }
 if(pageErrors.length)throw new Error('Browser page errors');
 const previous = only === undefined ? [] : (JSON.parse(readFileSync(resolve(output,'checks.json'),'utf8')) as { checks: object[] }).checks;
 const merged = [...new Map([...previous,...checks].map(row => [(row as { name: string }).name,row])).values()];
 writeFileSync(resolve(output,'checks.json'),JSON.stringify({capturedAt:new Date().toISOString(),fixture:'Northstar studio; isolated test-env only',checks:merged,compatibility:{legacyAccount:true,legacyWorkspace:true},pageErrors:0},null,2)+'\n');
 console.log(`Verified ${checks.length} views`);
} finally {await context.close();await browser.close();}

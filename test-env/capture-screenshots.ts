/** Capture only the isolated fictional demo environment. Never prints credentials or token URLs. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const origin = 'http://127.0.0.1:3200';
const password = /Password for every demo account:\s*(\S+)/.exec(readFileSync(resolve(root, '.var/test-env/credentials.txt'), 'utf8'))?.[1];
if (password === undefined) throw new Error('Missing fictional demo credentials');
const output = resolve(root, process.env.VMN_CAPTURE_DIR ?? '/tmp/vmn-ui-review');
mkdirSync(output, { recursive: true });
const requireMedia = createRequire(resolve(root, 'packages/media/package.json'));
const sharp = requireMedia('sharp') as typeof import('../packages/media/node_modules/sharp/lib/index.js');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('dialog', (dialog) => void dialog.accept());
try {
  await page.goto(origin);
  await page.getByLabel('Email', { exact: true }).fill('admin@vmn.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('combobox', { name: 'Workspace', exact: true }).waitFor();
  const api = async (path: string, method = 'GET', body?: unknown) => page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Demo request failed (${response.status})`);
    const text = await response.text();
    return text === '' ? null : JSON.parse(text);
  }, { path, method, body });
  const workspace = (await api('/workspaces')).workspaces.find((each: { name: string }) => each.name === 'Demo Household');
  if (workspace === undefined) throw new Error('Requires the fictional test-env seed');
  const base = `/workspaces/${workspace.id}`;
  for (const tool of ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE']) {
    const settings = await api(`${base}/tools`);
    if (!settings.tools.includes(tool)) await api(`${base}/tools`, 'POST', { tool, enabled: true, expectedRevision: settings.revision });
  }
  const today = new Date().toISOString().slice(0, 10);
  // Populate through authorized APIs, only when this older demo is missing a feature's seed.
  if ((await api(`${base}/contacts`)).contacts.length === 0) await api(`${base}/contacts`, 'POST', { name: 'Plumber Rossi', organisation: 'Rossi Repairs', category: 'Plumber', phones: [{ value: '+39 0471 123456' }], website: 'https://example.org' });
  if ((await api(`${base}/maintenance/board`)).columns.every((column: { records: unknown[] }) => column.records.length === 0)) {
    const repair = (await api(`${base}/maintenance`, 'POST', { title: 'Annual boiler service', category: 'Heating', date: today })).record;
    await api(`${base}/maintenance/${repair.id}/status`, 'POST', { status: 'IN_PROGRESS', expectedRevision: repair.revision });
    await api(`${base}/maintenance`, 'POST', { title: 'Check smoke alarms', category: 'Safety', date: today });
  }
  if ((await api(`${base}/documents`)).documents.length === 0) {
    const fixture = [...readFileSync(resolve(root, 'packages/media/src/fixtures/three-pages.pdf'))];
    const fileId = await page.evaluate(async ({ path, bytes }) => {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'sample-water-bill.pdf' }, body: new Uint8Array(bytes) });
      if (!response.ok) throw new Error(`Fictional upload failed (${response.status})`);
      return ((await response.json()) as { file: { id: string } }).file.id;
    }, { path: `/api${base}/document-files`, bytes: fixture });
    await api(`${base}/documents`, 'POST', { title: 'Sample water bill', folderId: null, fileIds: [fileId], type: { builtIn: 'bill' }, documentDate: today, year: new Date().getUTCFullYear(), tags: ['sample', 'water'], notes: 'Fictional demo record. Pages are a media-test fixture, not a real bill.' });
  }
  let home = await api(`${base}/home`);
  if (home.progress.completedOccurrencesToday === 0) {
    const schedule = (await api(`${base}/schedules`, 'POST', { title: 'Paid the water bill', date: today, timeZone: 'UTC', reminders: [] })).schedule;
    const history = await api(`${base}/schedules/${schedule.id}`);
    await api(`${base}/occurrences/${history.occurrences[0].id}/complete`, 'POST', {});
  }
  const procedures = (await api(`${base}/procedures`)).procedures;
  const first = procedures[0];
  home = await api(`${base}/home`);
  if (home.progress.completedRunsThisWeek === 0 && first !== undefined) {
    const run = (await api(`${base}/runs`, 'POST', { procedureId: first.id })).run;
    for (const section of run.sections) for (const step of section.steps) await api(`${base}/runs/${run.id}/steps/${step.id}/state`, 'POST', { expectedState: 'PENDING', state: 'DONE' });
    await api(`${base}/runs/${run.id}/complete`, 'POST', {});
  }
  const active = (await api(`${base}/runs?state=ACTIVE`)).runs[0];
  if (active === undefined) throw new Error('Demo requires an active Run');
  const captures = [
    ['today-desktop-light', `/w/${workspace.id}`, 1440, 1000, 'light'],
    ['today-phone-dark', `/w/${workspace.id}`, 390, 844, 'dark'],
    ['builder-desktop-dark', `/w/${workspace.id}/procedures/${first.id}/edit`, 1440, 1000, 'dark'],
    ['run-phone-light', `/w/${workspace.id}/runs/${active.id}`, 390, 844, 'light'],
    ['documents-desktop-light', `/w/${workspace.id}/documents`, 1440, 1000, 'light'],
    ['maintenance-phone-dark', `/w/${workspace.id}/maintenance`, 390, 844, 'dark'],
  ] as const;
  const results: object[] = [];
  for (const [name, path, width, height, theme] of captures) {
    await page.setViewportSize({ width, height });
    await api('/account/preferences', 'POST', { theme: theme });
    await page.goto(`${origin}${path}`);
    await page.locator('main').waitFor();
    await page.waitForTimeout(1500);
    if (await page.getByRole('heading', { name: 'Sign in', exact: true }).count()) throw new Error('Authentication was lost');
    const alerts = await page.getByRole('alert').allTextContents();
    if (alerts.length) throw new Error(`Demo page has an alert: ${name}`);
    const overflow = await page.evaluate(() => { const viewport = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return viewport.document.documentElement.scrollWidth > viewport.innerWidth; });
    if (overflow) throw new Error(`Horizontal overflow: ${name}`);
    const png = await page.screenshot({ fullPage: false });
    await sharp(png).webp({ quality: 90 }).toFile(resolve(output, `${name}.webp`));
    results.push({ name, viewport: { width, height }, theme, overflow, alerts: alerts.length });
    console.log(`Captured ${name}`);
    await page.waitForTimeout(7000); // Keep the normal global request limit in force.
  }
  // Check both themes at the minimum supported width without publishing additional captures.
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 320, height: 768 });
    await api('/account/preferences', 'POST', { theme });
    for (const path of [`/w/${workspace.id}`, `/w/${workspace.id}/settings`, `/w/${workspace.id}/more`]) {
      await page.goto(`${origin}${path}`); await page.waitForTimeout(1500);
      if (await page.evaluate(() => { const viewport = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return viewport.document.documentElement.scrollWidth > viewport.innerWidth; })) throw new Error('320px overflow');
      await page.waitForTimeout(7000);
    }
  }
  await api('/auth/sign-out', 'POST', {});
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  if (await page.evaluate(() => { const viewport = globalThis as unknown as { document: { documentElement: { scrollWidth: number } }; innerWidth: number }; return viewport.document.documentElement.scrollWidth > viewport.innerWidth; })) throw new Error('320px public sign-in overflow');
  writeFileSync(resolve(output, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), build: 'development/optional-tools-review (17.1–17.2)', demo: 'existing test-env seed, harmless progress added through API', captures: results }, null, 2));
} finally { await context.close(); await browser.close(); }

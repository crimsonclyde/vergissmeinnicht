import { expect, type Page, type TestInfo } from '@playwright/test';
import { expectAccessible } from './a11y.ts';

/** Real phone workflow under the ordinary authenticated Notes fixture. */
export async function checkPhoneJournal(page: Page, testInfo: TestInfo, workspaceId: string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async id => {
    const context = await fetch(`/api/workspaces/${id}`).then(r => r.json()) as {toolsRevision: number};
    const response = await fetch(`/api/workspaces/${id}/tools`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'GAMIFICATION',enabled:true,expectedRevision:context.toolsRevision})});
    if (!response.ok) throw new Error('Gamification fixture');
  }, workspaceId);
  await page.reload();
  const bar = page.getByRole('navigation', {name:'Entry actions',exact:true});
  const next = bar.getByRole('button', {name:'Next',exact:true});
  const back = bar.getByRole('button', {name:'Back',exact:true});
  const save = bar.getByRole('button', {name:'Save entry',exact:true});
  const cancel = bar.getByRole('button', {name:'Cancel editing',exact:true});
  const title = page.getByLabel('Title', {exact:true});
  const editor = page.locator('.milkdown .ProseMirror');
  await expect(title).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(save).toHaveCount(0);
  await next.click(); await expect(title).toBeFocused();
  await title.fill('A portable phone note');
  await expectAccessible(page, 'Phone title and reusable icon bar');
  await page.screenshot({path:testInfo.outputPath('phone-title.png'),fullPage:true});
  await next.click(); await expect(editor).toBeVisible();
  await expect(title).toBeHidden();
  await expect(page.getByRole('group',{name:'Editing mode',exact:true})).toHaveCount(0);
  await editor.fill('Written on a phone.'); await editor.press('ControlOrMeta+a');
  await page.getByRole('button',{name:'Bold',exact:true}).click();
  await expect(editor.locator('strong')).toHaveText('Written on a phone.');
  for (const button of await bar.getByRole('button').all()) {
    const box = await button.boundingBox(); expect(box?.width).toBeGreaterThanOrEqual(48); expect(box?.height).toBeGreaterThanOrEqual(48);
  }
  await page.setViewportSize({width:320,height:420});
  await editor.focus();
  let box = await bar.boundingBox(); expect(box?.y).toBeGreaterThanOrEqual(0); expect((box?.y??0)+(box?.height??0)).toBeLessThanOrEqual(421);
  await page.setViewportSize({width:320,height:720});
  await expectAccessible(page, 'Phone visual writing');
  await page.screenshot({path:testInfo.outputPath('phone-write.png'),fullPage:true});
  await next.click();
  await expect(page.getByLabel('Entry date (optional)',{exact:true})).toBeVisible();
  await page.getByLabel('Collection / notebook',{exact:true}).fill('Garden');
  await page.getByLabel('Tags (comma separated)',{exact:true}).fill('morning, garden');
  await page.getByLabel('Pin this entry',{exact:true}).check();
  await back.click(); await expect(editor).toContainText('Written on a phone.');
  await back.click(); await expect(title).toHaveValue('A portable phone note');
  await next.click(); await next.click();
  await expect(page.getByLabel('Collection / notebook',{exact:true})).toHaveValue('Garden');
  // Attachments remain reachable as an optional disclosure, never an extra mandatory step.
  await page.locator('.journal-phone-files > summary').click();
  await page.getByLabel('Upload original image',{exact:true}).setInputFiles({name:'garden.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64')});
  await expectAccessible(page, 'Phone details and optional originals');
  await page.screenshot({path:testInfo.outputPath('phone-details.png'),fullPage:true});
  const path = `/api/workspaces/${workspaceId}/journal`;
  await page.route('**'+path, route => route.request().method()==='POST' ? route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'journal_conflict'})}) : route.continue());
  await save.click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.progress-cheer')).toHaveCount(0);
  await back.click(); await expect(editor).toContainText('Written on a phone.'); await next.click();
  await page.unroute('**'+path);
  await save.click(); await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
  const cheer = page.locator('.progress-cheer'); await expect(cheer).toBeVisible();
  const cheerBox = await cheer.boundingBox(); box = await bar.boundingBox();
  expect((cheerBox?.y??0)+(cheerBox?.height??0)).toBeLessThanOrEqual(box?.y??0);
  await page.getByRole('button',{name:'Dismiss celebration',exact:true}).click();
  await expect(cheer).toHaveCount(0);
  await page.reload(); await expect(editor).toContainText('Written on a phone.');
  await next.click();
  await expect(page.getByLabel('Collection / notebook',{exact:true})).toHaveValue('Garden');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link',{name:'Export Markdown',exact:true}).click();
  expect((await downloadPromise).suggestedFilename()).toBe('notes.zip');
  await cancel.click(); await expect(page.getByRole('button',{name:'Guide',exact:true})).toBeVisible();
  await expect(page.locator('.mobile-action-bar')).toHaveCount(0);
  await page.goto(`/w/${workspaceId}`);await page.getByRole('button',{name:'Add',exact:true}).click(); await page.getByRole('button',{name:/Journal entry — Personal/}).click();
  await page.getByRole('button',{name:'Agree & Continue',exact:true}).click();
  await title.fill('A personal phone entry'); await next.click(); await editor.fill('A private phone thought.'); await next.click();
  await save.click(); await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
  await back.click(); await editor.fill('A recoverable private phone draft.');
  await expect(page.getByRole('status').filter({hasText:'Draft saved for recovery.'})).toBeVisible();
  page.once('dialog', dialog => void dialog.accept()); await page.reload();
  await page.getByRole('button',{name:'Recover saved draft',exact:true}).click();
  await expect(editor).toContainText('A recoverable private phone draft.'); await next.click(); await save.click();
  await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
  for (const theme of ['light','memento-mori','tokyo-nights','witch-forest','places-de','space-guide']) {
    expect(await page.evaluate(async theme => fetch('/api/account/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme})}).then(r=>r.status),theme)).toBe(200);
    await page.reload(); await expect(editor).toContainText('A recoverable private phone draft.');
    await expectAccessible(page, `Staged phone ${theme}`);
    if (theme==='memento-mori') await page.screenshot({path:testInfo.outputPath('phone-dark.png'),fullPage:true});
  }
  await page.setViewportSize({width:390,height:844}); await page.screenshot({path:testInfo.outputPath('phone-390.png'),fullPage:true});
  await expect(page.getByRole('button',{name:'Bold',exact:true})).toBeEnabled();
  await editor.fill('Keep this edit.');await expect(page.getByRole('status').filter({hasText:'Unsaved changes'})).toBeVisible();
  page.once('dialog', dialog => void dialog.dismiss()); await cancel.click(); await expect(editor).toContainText('Keep this edit.');
  page.once('dialog', dialog => void dialog.accept()); await cancel.click();
  await expect(page.getByRole('button',{name:'Guide',exact:true})).toBeVisible();
  expect(await page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')).toBe(true);
  // Opaque syntax is never silently serialized through a lossy phone editor.
  const opaque=':::custom\nKeep this exact source.\n:::';
  const entryId=await page.evaluate(async ({workspaceId,opaque})=>{
    const r=await fetch(`/api/workspaces/${workspaceId}/journal`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:{kind:'note',version:2,title:'Preserved source',date:null,body:opaque},expectedRevision:0,archived:false})});
    if(!r.ok)throw new Error('Opaque fixture');return (await r.json() as {entry:{id:string}}).entry.id;
  },{workspaceId,opaque});
  await page.goto(`/w/${workspaceId}/notes/${entryId}`);
  await expect(page.getByRole('status').filter({hasText:'desktop editor'})).toBeVisible();
  await expect(editor).toHaveCount(0);await expect(page.getByRole('button',{name:'Markdown source',exact:true})).toHaveCount(0);
  await next.click();await page.getByLabel('Collection / notebook',{exact:true}).fill('Preserved');await save.click();
  await expect(page.getByRole('status').filter({hasText:'Entry saved.'})).toBeVisible();
  expect(await page.evaluate(async ({workspaceId,entryId})=>(await fetch(`/api/workspaces/${workspaceId}/journal/${entryId}`).then(r=>r.json()) as {entry:{body:string}}).entry.body,{workspaceId,entryId})).toBe(opaque);
  expect(errors).toEqual([]);
}

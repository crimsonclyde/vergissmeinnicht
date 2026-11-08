import { expect, type Page } from '@playwright/test';
import { expectAccessible } from './a11y.ts';

/** Called after opening a new Recipe and entering its title. Leaves the saved Recipe selected. */
export async function checkPhoneRecipe(page: Page, workspaceId: string) {
  const bar = page.getByRole('navigation', { name: 'Recipe actions' });
  const action = (name: string) => bar.getByRole('button', { name, exact:true });
  const ingredient = (number: number) => page.getByRole('group', { name:`Ingredient ${number}`, exact:true });
  await expect(page.getByLabel('Base recipe servings', { exact:true })).toBeHidden();
  await expectAccessible(page, 'Recipe phone title');
  await page.getByLabel('Title', { exact:true }).fill('   '); await action('Next').click();
  await expect(page.getByLabel('Title', { exact:true })).toBeFocused();
  await page.getByLabel('Title', { exact:true }).fill('Pancakes for breakfast');
  await action('Next').click();
  await action('Next').click();
  await expect(ingredient(1).getByLabel('Ingredient name', { exact:true })).toBeFocused();
  await ingredient(1).getByLabel('Ingredient name', { exact:true }).fill('Flour');
  await ingredient(1).getByLabel('Amount', { exact:true }).fill('125');
  await ingredient(1).getByLabel('Unit', { exact:true }).fill('g');
  await action('Add ingredient').click();
  await ingredient(2).getByLabel('Ingredient name', { exact:true }).fill('Eggs');
  await ingredient(2).getByLabel('Amount', { exact:true }).fill('1');
  await expect(ingredient(1)).toBeHidden();
  await expect(bar.getByRole('button')).toHaveCount(5);
  for (const button of await bar.getByRole('button').all()) { const box = await button.boundingBox(); expect(box?.width).toBe(48); expect(box?.height).toBe(48); }
  await expectAccessible(page, 'Recipe phone ingredients');
  await action('Add ingredient').click();
  await ingredient(3).getByLabel('Ingredient name', { exact:true }).fill('Remove me');
  page.once('dialog', dialog => dialog.accept()); await action('Remove ingredient').click();
  await expect(ingredient(3)).toHaveCount(0);
  await action('Next').click();
  const editor = page.locator('.milkdown .ProseMirror');
  await expect(editor).toBeVisible();
  await editor.fill('Mix the batter. Cook in a warm pan.');
  await expect(page.getByRole('button', { name:'Markdown source', exact:true })).toHaveCount(0);
  await expectAccessible(page, 'Recipe phone instructions');
  await action('Back').click(); await action('Next').click();
  await expect(editor).toContainText('Cook in a warm pan.');
  await page.setViewportSize({width:390,height:500});
  await expect(editor).toContainText('Mix the batter.');
  await action('Next').click();
  await expectAccessible(page, 'Recipe phone details');
  await page.getByText('Images & links', { exact:true }).click();
  await page.getByText('Images and originals', { exact:true }).click();
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1536;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'orange';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const png = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG fixture failed'))));
    Object.defineProperty(navigator.clipboard, 'read', {
      value: async () => [new ClipboardItem({ 'image/png': await png })],
    });
  });
  const uploaded = page.waitForResponse(response => response.request().method()==='POST' && response.url().endsWith('/recipes/attachments'));
  await page.getByRole('button', {name:'Paste copied image',exact:true}).click();
  expect((await uploaded).status()).toBe(201);
  await action('Back').click(); await expect(editor).toContainText('Mix the batter.');
  await expect(editor.locator('img')).toHaveCount(1);
  await action('Next').click();
  page.once('dialog', dialog => dialog.dismiss()); await action('Cancel').click();
  await expect(bar).toBeVisible();
  const endpoint = `**/api/workspaces/${workspaceId}/recipes`;
  await page.route(endpoint, route => route.request().method()==='POST' ? route.fulfill({status:500,contentType:'application/json',body:'{"error":"internal_error"}'}) : route.continue());
  await action('Save recipe').click();
  await expect(page.locator('.recipe-page > [role="alert"]')).toBeVisible();
  await expect(page.getByText('Recipe saved.',{exact:true})).toHaveCount(0);
  await page.unroute(endpoint);
  await page.setViewportSize({width:320,height:720});
  expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  await page.screenshot({path:'/tmp/vmn-recipe-phone-details.png',fullPage:true});
  await action('Save recipe').click();
  await expect(page.getByRole('status').filter({hasText:'Recipe saved.'})).toBeVisible();
  // A fresh read must load the sizing rules without visiting the lazy editor.
  await page.reload();
  await page.getByRole('button', {name:/Pancakes for breakfast/}).click();
  const preview = page.getByRole('img', {name:/recipe-image.png/});
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalHeight)).toBeGreaterThan(288);
  const bounds = await preview.boundingBox();
  expect(bounds?.width).toBeLessThanOrEqual(320);
  expect(bounds?.height).toBeLessThanOrEqual(288);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

export async function checkRecipeSourcePreservation(page: Page, workspaceId: string) {
  const opaque = ':::custom\nKeep these instructions exactly.\n:::';
  const id = await page.evaluate(async ({workspaceId,opaque}) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/recipes`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ content:{version:1,title:'Preserved recipe',servings:2,ingredients:[{name:'Tea',amount:'',unit:'',note:''}],instructions:opaque,tags:[],source:'',prepMinutes:null,cookMinutes:null},expectedRevision:0,archived:false }) });
    if(!response.ok) throw new Error('Recipe fixture failed');
    await fetch('/api/account/preferences', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:'memento-mori'}) });
    return (await response.json() as {recipe:{id:string}}).recipe.id;
  }, {workspaceId,opaque});
  await page.goto(`/w/${workspaceId}/recipes`);
  await page.getByRole('button', {name:/Preserved recipe/}).click();
  await page.getByRole('button', {name:'Edit recipe',exact:true}).click();
  const bar = page.getByRole('navigation', { name:'Recipe actions' });
  const next = bar.getByRole('button', {name:'Next',exact:true});
  await next.click(); await next.click();
  await expect(page.getByRole('status').filter({hasText:'desktop editor'})).toBeVisible();
  await expect(page.locator('.milkdown .ProseMirror')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Markdown source',exact:true})).toHaveCount(0);
  await expectAccessible(page, 'Recipe opaque instructions in dark theme');
  await next.click(); await page.getByLabel('Tags (comma separated)', {exact:true}).fill('preserved');
  await page.screenshot({path:'/tmp/vmn-recipe-phone-dark.png',fullPage:true});
  await bar.getByRole('button', {name:'Save recipe',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Recipe saved.'})).toBeVisible();
  expect(await page.evaluate(async ({workspaceId,id}) => (await fetch(`/api/workspaces/${workspaceId}/recipes/${id}`).then(r=>r.json()) as {recipe:{instructions:string}}).recipe.instructions, {workspaceId,id})).toBe(opaque);
}

import { expect, type Page } from '@playwright/test';
import { expectAccessible } from './a11y.ts';

export async function checkScheduleFlow(page: Page, workspaceId: string, mobile: boolean) {
  page.setDefaultTimeout(10_000);
  if (mobile) await page.setViewportSize({ width:320, height:740 });
  await page.goto(`/w/${workspaceId}/reminders/new`);
  const dialog = page.getByRole('dialog');
  const bar = dialog.getByRole('navigation',{name:'Schedule actions'});
  const next = () => bar.getByRole('button',{name:'Next',exact:true}).click();
  await expect(dialog).toBeVisible();
  if (mobile) {
    await expect(dialog.getByLabel('Date',{exact:true})).toBeHidden();
    await next(); await expect(dialog.getByLabel('What',{exact:true})).toBeFocused();
    await expectAccessible(page,'Phone Reminder title');
  }
  await dialog.getByLabel('What',{exact:true}).fill('Check the water filter');
  if(mobile) await next();
  const date = await dialog.getByLabel('Date',{exact:true}).inputValue();
  await dialog.locator('summary',{hasText:'Repeat'}).click();
  await dialog.getByRole('radio',{name:'On fixed dates',exact:true}).check();
  await dialog.getByLabel('Every',{exact:true}).fill('2');
  await dialog.getByLabel('Unit',{exact:true}).selectOption('WEEK');
  if(mobile) {
    await bar.getByRole('button',{name:'Back',exact:true}).click();
    await expect(dialog.getByLabel('What',{exact:true})).toHaveValue('Check the water filter');
    await next(); await expect(dialog.getByLabel('Every',{exact:true})).toHaveValue('2');
    await dialog.getByLabel('Every',{exact:true}).fill(''); await next();
    await expect(dialog.getByLabel('Every',{exact:true})).toBeFocused();
    await dialog.getByLabel('Every',{exact:true}).fill('2');
    await expectAccessible(page,'Phone Reminder date and repeat');
    await next();
  }
  await dialog.locator('summary',{hasText:'Notes'}).click();
  await dialog.getByRole('textbox',{name:'Notes',exact:true}).fill('Use the spare cartridge.');
  await dialog.locator('summary',{hasText:'Reminders'}).click();
  await dialog.getByLabel('1 day before',{exact:true}).check();
  if(mobile) {
    // The dock lives in the native modal, so real taps and focus work (a body portal would be inert).
    await expect(bar.getByRole('button')).toHaveCount(3);
    for(const button of await bar.getByRole('button').all()) { const box=await button.boundingBox(); expect(box?.width).toBe(48); expect(box?.height).toBe(48); }
    page.once('dialog',d=>d.dismiss()); await bar.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Use the spare cartridge.');
    await page.setViewportSize({width:390,height:500});
    await expectAccessible(page,'Phone Reminder details');
    await page.setViewportSize({width:320,height:740});
    expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
  }
  const endpoint=`**/api/workspaces/${workspaceId}/schedules`;
  await page.route(endpoint,route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'application/json',body:'{"error":"internal_error"}'}):route.continue());
  await dialog.getByRole('button',{name:'Create reminder',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Use the spare cartridge.');
  await page.unroute(endpoint);
  if(mobile) await page.screenshot({path:'/tmp/vmn-schedule-phone.png',fullPage:true});
  await dialog.getByRole('button',{name:'Create reminder',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const schedules = await page.evaluate(async workspaceId => (await fetch(`/api/workspaces/${workspaceId}/schedules`).then(r=>r.json()) as {schedules:{id:string;title:string;description:string;date:string;recurrence:{kind:string;unit:string;interval:number};reminders:unknown[]}[]}).schedules,workspaceId);
  expect(schedules).toHaveLength(1);
  expect(schedules[0]).toMatchObject({title:'Check the water filter',description:'Use the spare cartridge.',recurrence:{kind:'FIXED',unit:'WEEK',interval:2}});
  expect(schedules[0]?.reminders).toHaveLength(2);
  await page.getByRole('button',{name:'More for Check the water filter',exact:true}).click();
  await page.getByRole('button',{name:'Edit schedule…',exact:true}).click();
  await expect(dialog.getByLabel('What',{exact:true})).toHaveValue('Check the water filter');
  if(mobile) await next();
  await expect(dialog.getByLabel('Every',{exact:true})).toHaveValue('2');
  await dialog.getByRole('radio',{name:'After it is done',exact:true}).check();
  await dialog.getByLabel('Every',{exact:true}).fill('6');
  await dialog.getByLabel('Unit',{exact:true}).selectOption('MONTH');
  if(mobile) await next();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const updated = await page.evaluate(async workspaceId => (await fetch(`/api/workspaces/${workspaceId}/schedules`).then(r=>r.json()) as {schedules:{recurrence:unknown}[]}).schedules[0],workspaceId);
  expect(updated?.recurrence).toEqual({kind:'AFTER_COMPLETION',unit:'MONTH',interval:6});

  // Scheduling a Procedure starts with its known title and does not create a Run.
  const procedureId=await page.evaluate(async workspaceId=>{const r=await fetch(`/api/workspaces/${workspaceId}/procedures`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Inspect the boiler',description:'',icon:'checklist',tags:[],sections:[]})});if(!r.ok)throw new Error('Procedure fixture');return(await r.json() as {procedure:{id:string}}).procedure.id;},workspaceId);
  await page.goto(`/w/${workspaceId}/procedures`);
  await page.getByRole('button',{name:'Start Inspect the boiler',exact:true}).click();
  await page.getByRole('button',{name:'Schedule…',exact:true}).click();
  await expect(dialog).toContainText('Nothing starts by itself');
  await expect(dialog.getByLabel('Date',{exact:true})).toHaveValue(date);
  if(mobile){await expect(dialog.getByText('1 of 2',{exact:true})).toBeVisible();await next();}
  await dialog.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(async workspaceId=>(await fetch(`/api/workspaces/${workspaceId}/runs`).then(r=>r.json()) as {runs:unknown[]}).runs,workspaceId)).toEqual([]);
  if(mobile) {
    // Resize a desktop builder's scheduling modal: the modal dock supersedes the background dock.
    await page.setViewportSize({width:1280,height:900});
    await page.goto(`/w/${workspaceId}/procedures/${procedureId}/edit`);
    await page.getByRole('button',{name:'Start Inspect the boiler',exact:true}).click();
    await page.getByRole('button',{name:'Schedule…',exact:true}).click();
    await page.setViewportSize({width:320,height:740});
    await expect(bar).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Procedure actions'})).toBeHidden();
    await bar.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('navigation',{name:'Procedure actions'})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-mobile-action-bar','true');
  }
}

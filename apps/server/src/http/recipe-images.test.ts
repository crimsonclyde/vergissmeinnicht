import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRecipeWithOperation,generateRecipeImage,prepareRecipeMeal} from '@vergissmeinnicht/application';
import type {UserId,WorkspaceId} from '@vergissmeinnicht/domain';
import {openAiRecipeImages} from '../integrations/openai-recipe-images.ts';
import {purgeAttachmentFiles} from '@vergissmeinnicht/database';
import {startTestApp} from './test-harness.ts';
describe('Recipe images and atomic meals',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;
 afterEach(async()=>{await t?.close();});
 it('preserves generated original bytes, prevents duplicate calls, and commits a new pictured recipe with groceries once',async()=>{
  t=await startTestApp();const workspaceId=await t.createWorkspace('Kitchen') as WorkspaceId;await t.post(`/api/workspaces/${workspaceId}/tools`,{tool:'RECIPES',enabled:true},t.admin);
  const who=t.database.sqlite.prepare("SELECT id FROM users WHERE email='admin@example.org'").get() as {id:string};const actor=await t.services.users.findById(who.id as UserId);if(!actor)throw new Error('Missing actor');
  const png=await sharp({create:{width:10,height:10,channels:3,background:'orange'}}).png().withMetadata().toBuffer();const generate=vi.fn(async()=>png);const deps={...t.services.recipeImages,provider:{model:'gpt-image-1.5',generate}};const id=randomUUID();
  const created=await generateRecipeImage(deps,actor,workspaceId,id,'Pancakes on a plate');expect(created.job.status).toBe('SUCCEEDED');expect(created.attachment?.name).toContain('AI-generated-OpenAI');
  expect((await generateRecipeImage(deps,actor,workspaceId,id,'Pancakes on a plate')).duplicate).toBe(true);expect(generate).toHaveBeenCalledTimes(1);
  await expect(generateRecipeImage(deps,actor,workspaceId,id,'Changed prompt')).rejects.toThrow();expect(generate).toHaveBeenCalledTimes(1);
  const file=created.attachment;if(!file)throw new Error('No image');const downloaded=await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${file.id}/original`,t.admin);expect(downloaded.rawPayload.equals(png)).toBe(true);
  const list=(await t.post(`/api/workspaces/${workspaceId}/lists`,{title:'Shopping'},t.admin)).json().list;
  const input={operationId:randomUUID(),recipeId:null,recipeRevision:null,listId:list.id,listRevision:list.revision,servings:4,content:{version:1 as const,title:'Pancakes',servings:2,ingredients:[{name:'Flour',amount:'125',unit:'g',note:''}],instructions:`![AI-generated illustration](attachments/${file.id}.png)\n\nMix and cook.`,tags:[],source:'',prepMinutes:null,cookMinutes:null}};
  await expect(prepareRecipeMeal(t.services.recipes,actor,workspaceId,{...input,listRevision:999})).rejects.toThrow();expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:0});
  const meal=await prepareRecipeMeal(t.services.recipes,actor,workspaceId,input);expect(meal.duplicate).toBe(false);expect((await prepareRecipeMeal(t.services.recipes,actor,workspaceId,input)).duplicate).toBe(true);
  expect((await t.get(`/api/workspaces/${workspaceId}/lists/${list.id}`,t.admin)).json().list.items).toMatchObject([{title:'Flour',quantity:'250',unit:'g'}]);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:1});
  const unbound=await generateRecipeImage(deps,actor,workspaceId,randomUUID(),'Another illustration');await purgeAttachmentFiles(t.database,t.services.recipeAttachments.store,new Date(Date.now()+2*86400000));expect((await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${file.id}/original`,t.admin)).rawPayload.equals(png)).toBe(true);expect(t.database.sqlite.prepare('SELECT attachment_id AS id FROM recipe_image_jobs WHERE id=?').get(unbound.job.id)).toEqual({id:null});
  const createId=randomUUID();const standalone=await createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,input.content);expect((await createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,input.content)).recipeId).toBe(standalone.recipeId);expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:2});await expect(createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,{...input.content,title:'Different'})).rejects.toThrow();
 });
 it('does not call the provider when quota is exhausted; preserves uncertain outcomes without retrying',async()=>{
  t=await startTestApp();const workspaceId=await t.createWorkspace('Kitchen') as WorkspaceId;await t.post(`/api/workspaces/${workspaceId}/tools`,{tool:'RECIPES',enabled:true},t.admin);
  const actor=await t.services.users.findById((t.database.sqlite.prepare("SELECT id FROM users WHERE email='admin@example.org'").get() as {id:UserId}).id);if(!actor)throw new Error('Missing actor');
  const generate=vi.fn(async()=>{throw new Error('Simulated provider timeout');});const deps={...t.services.recipeImages,provider:{model:'gpt-image-1.5',generate}};
  t.database.sqlite.prepare('UPDATE attachment_settings SET default_quota_bytes=0').run();await expect(generateRecipeImage(deps,actor,workspaceId,randomUUID(),'Pancakes')).rejects.toThrow();expect(generate).not.toHaveBeenCalled();
  t.database.sqlite.prepare('UPDATE attachment_settings SET default_quota_bytes=500000000').run();const id=randomUUID();await expect(generateRecipeImage(deps,actor,workspaceId,id,'Pancakes')).rejects.toThrow();expect((await generateRecipeImage(deps,actor,workspaceId,id,'Pancakes')).job.status).toBe('UNCERTAIN');expect(generate).toHaveBeenCalledTimes(1);
 });
 it('uses only the fixed HTTPS image endpoint, bounded options and no redirects',async()=>{
  const png=await sharp({create:{width:2,height:2,channels:3,background:'orange'}}).png().toBuffer();const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{headers:{'content-type':'application/json'}}));
  expect(Buffer.from(await openAiRecipeImages('test-project-secret',fetcher).generate('Pancakes')).equals(png)).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);const [url,options]=fetcher.mock.calls[0]??[];expect(url).toBe('https://api.openai.com/v1/images/generations');expect(options?.redirect).toBe('error');expect(JSON.parse(String(options?.body))).toMatchObject({model:'gpt-image-1.5',n:1,size:'1024x1024',quality:'low',output_format:'png'});
 });
});

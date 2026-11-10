import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createRecipeWithOperation,generateRecipeImage,prepareRecipeMeal} from '@vergissmeinnicht/application';
import type {UserId,WorkspaceId} from '@vergissmeinnicht/domain';
import {openAiRecipeImages} from '../integrations/openai-recipe-images.ts';
import {createRecipeImageJobs,purgeAttachmentFiles} from '@vergissmeinnicht/database';
import {ORIGIN,startTestApp} from './test-harness.ts';
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
 it('reports generation failures through OAuth MCP and saves a confirmed generated cover',async()=>{
  t=await startTestApp({mcpEnabled:true});
  const workspaceId=await t.createWorkspace('Kitchen');
  const foreign=await t.createWorkspace('Other kitchen');
  for(const id of [workspaceId,foreign]){
   expect((await t.post(`/api/workspaces/${id}/tools`,{tool:'RECIPES',enabled:true},t.admin)).statusCode).toBe(200);
  }
  const actor=await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id);
  if(!actor)throw new Error('Missing actor');
  const clientId=randomUUID();
  const redirectUri='https://client.example.org/callback';
  const resource=ORIGIN+'/mcp';
  const scopes=['recipes.read','recipes.write'] as const;
  await t.services.mcp.registerClient(clientId,{client_name:'Generated cover test'});
  const request=await t.services.mcp.begin({clientId,redirectUri,state:null,codeChallenge:'a'.repeat(43),scopes:[...scopes],resource});
  const code=new URL(await t.services.mcp.approve(actor,request,[workspaceId],[...scopes],true)).searchParams.get('code');
  if(!code)throw new Error('Missing authorization code');
  const {access_token}=await t.services.mcp.exchange(clientId,code,'code',redirectUri,resource);
  async function call(name:string,args:object){
   const response=await t.app.inject({
    method:'POST',url:'/mcp',headers:{authorization:'Bearer '+access_token,accept:'application/json, text/event-stream'},
    payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},
   });
   expect(response.statusCode,response.body).toBe(200);
   return response.json().result;
  }
  const args={workspaceId,operationId:randomUUID(),prompt:'Tagliatelle with peas'};
  const disabled=await call('generate_recipe_image',args);
  expect(disabled.isError).toBe(true);
  expect(disabled.content[0].text).toContain('image_disabled');
  const denied=await call('generate_recipe_image',{...args,workspaceId:foreign});
  expect(denied.isError).toBe(true);
  expect(denied.content[0].text).not.toContain('image_disabled');
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipe_image_jobs').get()).toEqual({n:0});

  const png=await sharp({create:{width:10,height:10,channels:3,background:'green'}}).png().toBuffer();
  const generate=vi.fn(async(prompt:string)=>{
   if(prompt==='Simulated timeout')throw new Error('provider-internal-detail');
   return png;
  });
  t.services.recipeImages.provider={model:'gpt-image-1.5',generate};
  const jobs=t.services.recipeImages.jobs;
  t.services.recipeImages.jobs=createRecipeImageJobs(t.database,0,10);
  expect((await call('generate_recipe_image',args)).content[0].text).toContain('image_limit');
  expect(generate).not.toHaveBeenCalled();
  t.services.recipeImages.jobs=jobs;
  const generated=await call('generate_recipe_image',args);
  expect(generated.isError,JSON.stringify(generated)).toBeUndefined();
  const result=JSON.parse(generated.content[0].text);
  expect(result.image.reference).toBe(`attachments/${result.job.attachmentId}.png`);
  const repeated=JSON.parse((await call('generate_recipe_image',args)).content[0].text);
  expect(repeated).toEqual({...result,duplicate:true});
  expect((await call('generate_recipe_image',{...args,prompt:'Changed prompt'})).content[0].text).toContain('image_conflict');
  const content={
   version:1,title:'Tagliatelle with peas',servings:2,ingredients:[{name:'Tagliatelle',amount:'200',unit:'g',note:''}],
   instructions:`Cook the pasta.\n\n${result.image.markdown}`,tags:[],source:'',prepMinutes:null,cookMinutes:null,coverImage:result.image.reference,
  };
  const saved=await call('create_recipe',{workspaceId,operationId:randomUUID(),content,requireImage:true});
  expect(saved.isError,JSON.stringify(saved)).toBeUndefined();
  const {recipeId}=JSON.parse(saved.content[0].text);
  const read=await call('get_recipe',{workspaceId,recipeId});
  expect(JSON.parse(read.content[0].text)).toMatchObject({coverImage:result.image.reference});

  const uncertain={...args,operationId:randomUUID(),prompt:'Simulated timeout'};
  const failure=await call('generate_recipe_image',uncertain);
  expect(failure.isError).toBe(true);
  expect(failure.content[0].text).toContain('image_uncertain');
  expect(failure.content[0].text).not.toContain('provider-internal-detail');
  expect(JSON.parse((await call('generate_recipe_image',uncertain)).content[0].text)).toMatchObject({
   job:{status:'UNCERTAIN'},image:null,duplicate:true,
  });
  expect(generate).toHaveBeenCalledTimes(2);
 });
});

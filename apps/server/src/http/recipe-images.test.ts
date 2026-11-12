import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,describe,expect,it} from 'vitest';
import {authorizeRecipes,createRecipeWithOperation,prepareRecipeMeal,uploadAttachment} from '@vergissmeinnicht/application';
import type {UserId,WorkspaceId} from '@vergissmeinnicht/domain';
import {purgeAttachmentFiles} from '@vergissmeinnicht/database';
import {assistantTools} from '../mcp/tools.ts';
import {ORIGIN,startTestApp} from './test-harness.ts';
describe('Recipe images and atomic meals',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;
 afterEach(async()=>{await t?.close();});
 it('preserves uploaded original bytes and commits a new pictured recipe with groceries once',async()=>{
  t=await startTestApp();const workspaceId=await t.createWorkspace('Kitchen') as WorkspaceId;await t.post(`/api/workspaces/${workspaceId}/tools`,{tool:'RECIPES',enabled:true},t.admin);
  const who=t.database.sqlite.prepare("SELECT id FROM users WHERE email='admin@example.org'").get() as {id:string};const actor=await t.services.users.findById(who.id as UserId);if(!actor)throw new Error('Missing actor');
  const png=await sharp({create:{width:10,height:10,channels:3,background:'orange'}}).png().withMetadata().toBuffer();
  const upload=(name:string)=>uploadAttachment(t.services.recipeAttachments,{actor,scope:{workspaceId},authorize:write=>authorizeRecipes(t.services.recipes,actor,workspaceId,write)},name,(async function*(){yield png;})());
  const file=await upload('pancakes.png');const downloaded=await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${file.id}/original`,t.admin);expect(downloaded.rawPayload.equals(png)).toBe(true);
  const list=(await t.post(`/api/workspaces/${workspaceId}/lists`,{title:'Shopping'},t.admin)).json().list;
  const input={operationId:randomUUID(),recipeId:null,recipeRevision:null,listId:list.id,listRevision:list.revision,servings:4,content:{version:1 as const,title:'Pancakes',servings:2,ingredients:[{name:'Flour',amount:'125',unit:'g',note:''}],instructions:`![Pancakes](attachments/${file.id}.png)\n\nMix and cook.`,tags:[],source:'',prepMinutes:null,cookMinutes:null}};
  await expect(prepareRecipeMeal(t.services.recipes,actor,workspaceId,{...input,listRevision:999})).rejects.toThrow();expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:0});
  const meal=await prepareRecipeMeal(t.services.recipes,actor,workspaceId,input);expect(meal.duplicate).toBe(false);expect((await prepareRecipeMeal(t.services.recipes,actor,workspaceId,input)).duplicate).toBe(true);
  expect((await t.get(`/api/workspaces/${workspaceId}/lists/${list.id}`,t.admin)).json().list.items).toMatchObject([{title:'Flour',quantity:'250',unit:'g'}]);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:1});
  await upload('unused.png');await purgeAttachmentFiles(t.database,t.services.recipeAttachments.store,new Date(Date.now()+2*86400000));expect((await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${file.id}/original`,t.admin)).rawPayload.equals(png)).toBe(true);
  const createId=randomUUID();const standalone=await createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,input.content);expect((await createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,input.content)).recipeId).toBe(standalone.recipeId);expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM recipes').get()).toEqual({n:2});await expect(createRecipeWithOperation(t.services.recipes,actor,workspaceId,createId,{...input.content,title:'Different'})).rejects.toThrow();
 });
 it('offers no server image generator over MCP and keeps covers that an older generator stored',async()=>{
  t=await startTestApp({mcpEnabled:true});
  const workspaceId=await t.createWorkspace('Kitchen');
  expect((await t.post(`/api/workspaces/${workspaceId}/tools`,{tool:'RECIPES',enabled:true},t.admin)).statusCode).toBe(200);
  const actor=await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id);
  if(!actor)throw new Error('Missing actor');
  const clientId=randomUUID();
  const redirectUri='https://client.example.org/callback';
  const resource=ORIGIN+'/mcp';
  const scopes=['recipes.read','recipes.write'] as const;
  await t.services.mcp.registerClient(clientId,{client_name:'Removed generator test'});
  const request=await t.services.mcp.begin({clientId,redirectUri,state:null,codeChallenge:'a'.repeat(43),scopes:[...scopes],resource});
  const code=new URL(await t.services.mcp.approve(actor,request,[workspaceId],[...scopes],true)).searchParams.get('code');
  if(!code)throw new Error('Missing authorization code');
  const {access_token}=await t.services.mcp.exchange(clientId,code,'code',redirectUri,resource);
  async function rpc(method:string,params:object){
   const response=await t.app.inject({
    method:'POST',url:'/mcp',headers:{authorization:'Bearer '+access_token,accept:'application/json, text/event-stream'},
    payload:{jsonrpc:'2.0',id:1,method,params},
   });
   expect(response.statusCode,response.body).toBe(200);
   return response.json();
  }
  const call=async(name:string,args:object)=>(await rpc('tools/call',{name,arguments:args})).result;
  const tools=(await rpc('tools/list',{})).result.tools as {name:string;inputSchema:{properties:Record<string,unknown>};_meta?:Record<string,unknown>}[];
  const tool=(name:string)=>tools.find(entry=>entry.name===name);
  for(const removed of ['generate_recipe_image','set_recipe_image'])expect(tool(removed)).toBeUndefined();
  // ChatGPT sees the upload tool; the recipe writes take only the reference, never a file.
  expect(tool('upload_recipe_image_file')?._meta).toEqual({'openai/fileParams':['file']});
  expect(tool('create_recipe')?._meta??{}).not.toHaveProperty('openai/fileParams');expect(tool('create_recipe')?.inputSchema.properties).not.toHaveProperty('image');
  for(const name of ['create_recipe','prepare_recipe_meal']){const definition=assistantTools.find(entry=>entry.name===name);expect(definition?.fileParams).toBeUndefined();expect(definition?.schema.shape).not.toHaveProperty('image');}
  for(const name of ['upload_recipe_image','open_recipe_image_upload'])expect(tool(name)?._meta).toMatchObject({'openai/visibility':'private'});
  const withImage=await call('create_recipe',{workspaceId,operationId:randomUUID(),content:{version:1,title:'Soup',servings:null,ingredients:[],instructions:'Cook.',tags:[],source:'',prepMinutes:null,cookMinutes:null},image:{download_url:'https://files.oaiusercontent.com/x',file_id:'file-x'}});
  expect(withImage.isError).toBe(true);
  const removed=await rpc('tools/call',{name:'generate_recipe_image',arguments:{workspaceId,operationId:randomUUID(),prompt:'Tagliatelle'}});
  expect(removed.error??removed.result?.isError).toBeTruthy();
  // A cover created by the removed generator is an ordinary attachment with the old file name.
  const png=await sharp({create:{width:10,height:10,channels:3,background:'green'}}).png().toBuffer();
  const wid=workspaceId as WorkspaceId;
  const legacy=await uploadAttachment(t.services.recipeAttachments,{actor,scope:{workspaceId:wid},authorize:write=>authorizeRecipes(t.services.recipes,actor,wid,write)},'AI-generated-OpenAI-gpt-image-1.5-2026-11-01.png',(async function*(){yield png;})());
  const reference=`attachments/${legacy.id}.png`;
  const content={
   version:1,title:'Tagliatelle with peas',servings:2,ingredients:[{name:'Tagliatelle',amount:'200',unit:'g',note:''}],
   instructions:`Cook the pasta.\n\n![AI-generated recipe illustration](${reference})`,tags:[],source:'',prepMinutes:null,cookMinutes:null,coverImage:reference,
  };
  const saved=await call('create_recipe',{workspaceId,operationId:randomUUID(),content,requireImage:true});
  expect(saved.isError,JSON.stringify(saved)).toBeUndefined();
  const {recipeId}=JSON.parse(saved.content[0].text);
  expect(JSON.parse((await call('get_recipe',{workspaceId,recipeId})).content[0].text)).toMatchObject({coverImage:reference});
  expect((await t.get(`/api/workspaces/${workspaceId}/recipes/attachments/${legacy.id}/original`,t.admin)).rawPayload.equals(png)).toBe(true);
 });
});

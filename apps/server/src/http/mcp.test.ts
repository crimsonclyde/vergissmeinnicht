import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {startTestApp,ORIGIN} from './test-harness.ts';
describe('MCP OAuth delegation',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;
 afterEach(async()=>{await t?.close();});
 it('requires explicit cookie consent and PKCE; rotates tokens and commits replay revocation',async()=>{
  t=await startTestApp({mcpEnabled:true});const workspace=await t.createWorkspace('Kitchen');
  const registration=await t.app.inject({method:'POST',url:'/register',headers:{host:'vmn.example.org'},payload:{client_name:'Recipe assistant',redirect_uris:['https://chatgpt.com/oauth/callback'],token_endpoint_auth_method:'none'}});
  expect(registration.statusCode,registration.body).toBe(201);const client=registration.json();
  const verifier=randomBytes(32).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');
  const authorization=await t.app.inject({method:'GET',headers:{host:'vmn.example.org'},url:'/authorize?'+new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge:challenge,code_challenge_method:'S256',scope:'workspaces.read recipes.read lists.write',resource:ORIGIN+'/mcp',state:'test'})});
  expect(authorization.statusCode,authorization.body).toBe(302);const pending=new URL(String(authorization.headers.location)).searchParams.get('request');
  expect((await t.get('/api/account/mcp/requests/'+pending)).statusCode).toBe(401);
  const consent=await t.post('/api/account/mcp/approve',{requestId:pending,allow:true,workspaceIds:[workspace],scopes:['workspaces.read','recipes.read','lists.write']},t.admin);
  expect(consent.statusCode,consent.body).toBe(200);const code=new URL(consent.json().redirect).searchParams.get('code');
  const connections=()=>t.get('/api/account/mcp/',t.admin);
  expect((await t.get('/api/account/mcp/')).statusCode).toBe(401);
  expect((await connections()).json().connections).toMatchObject([{tokenIssued:false}]);
  const exchange=(params:Record<string,string>)=>t.app.inject({method:'POST',url:'/token',headers:{host:'vmn.example.org','content-type':'application/x-www-form-urlencoded'},payload:new URLSearchParams({client_id:client.client_id,...params}).toString()});
  const wrong=await exchange({grant_type:'authorization_code',code:String(code),redirect_uri:client.redirect_uris[0],code_verifier:randomBytes(32).toString('base64url')});expect(wrong.statusCode,wrong.body).toBe(400);
  expect((await exchange({grant_type:'authorization_code',code:String(code),redirect_uri:client.redirect_uris[0],code_verifier:verifier,resource:'https://foreign.example/mcp'})).statusCode).toBe(400);
  const response=await exchange({grant_type:'authorization_code',code:String(code),redirect_uri:client.redirect_uris[0],code_verifier:verifier});expect(response.statusCode,response.body).toBe(200);const tokens=response.json();
  const linked=await connections();
  expect(linked.json().connections).toMatchObject([{tokenIssued:true}]);
  expect(linked.body).not.toContain(tokens.refresh_token);
  const otherAccount=await t.invite('other-connection@example.org','Other account');
  expect((await t.get('/api/account/mcp/',otherAccount)).json()).toEqual({connections:[]});
  expect((await t.services.mcp.verify(tokens.access_token)).grant.workspaceIds).toEqual([workspace]);
  expect(t.database.sqlite.prepare('SELECT hash FROM mcp_tokens').all().some((row:unknown)=>JSON.stringify(row).includes(tokens.access_token))).toBe(false);
  const rpc=(method:string,params:object={},access=tokens.access_token)=>t.app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+access,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method,params}});
  const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});
  expect(initialized.statusCode).toBe(200);
  expect(initialized.json().result.instructions).toContain('ask the user which one to use before reading or writing its records');
  expect(initialized.json().result.instructions).toContain('VMN does not generate images');
  expect(initialized.json().result.instructions).not.toContain('generate_recipe_image');
  expect(initialized.json().result.instructions).toContain('Upload the actual image file with upload_recipe_image_file and recipeId null');
  expect(initialized.json().result.instructions).toContain('Never fabricate image references, file paths or upload success');
  expect(initialized.json().result.instructions).toContain('New Recipes default to public');
  expect(initialized.json().result.instructions).toContain('When several grocery Lists match, ask which one to use and wait for the answer before writing');
  expect((await t.app.inject({method:'POST',url:'/mcp',headers:{cookie:t.admin},payload:{jsonrpc:'2.0',id:1,method:'tools/list'}})).statusCode).toBe(401);
  const sdk=new Client({name:'sdk-interoperability-test',version:'1'});
  const adapter:typeof fetch=async(input,init)=>{const outgoing=new Request(input,init);const body=await outgoing.text();const incoming=await t.app.inject({method:outgoing.method as 'GET'|'POST'|'DELETE',url:new URL(outgoing.url).pathname,headers:Object.fromEntries(outgoing.headers),...(body?{payload:body}:{})});const headers=new Headers();for(const [key,value]of Object.entries(incoming.headers))if(typeof value==='string')headers.set(key,value);return new Response(incoming.statusCode===202?null:incoming.rawPayload,{status:incoming.statusCode,headers});};
  await sdk.connect(new StreamableHTTPClientTransport(new URL(ORIGIN+'/mcp'),{fetch:adapter,requestInit:{headers:{authorization:'Bearer '+tokens.access_token}}}));expect((await sdk.listTools()).tools.map(tool=>tool.name)).toContain('add_grocery_item');expect((await sdk.callTool({name:'list_workspaces',arguments:{}})).isError).not.toBe(true);await sdk.close();
  const tools=await rpc('tools/list');expect(tools.statusCode,tools.body).toBe(200);expect(tools.json().result.tools.map((tool:{name:string})=>tool.name)).toContain('add_grocery_item');expect(tools.json().result.tools.map((tool:{name:string})=>tool.name)).not.toContain('save_recipe');
  expect(tools.json().result.tools).toContainEqual(expect.objectContaining({name:'add_grocery_item',description:expect.stringContaining('ask and wait before calling this tool')}));
  const discovered=await rpc('tools/call',{name:'list_workspaces',arguments:{}});expect(discovered.body).toContain(workspace);
  const list={id:randomUUID()};const createArgs={workspaceId:workspace,listId:list.id,operationId:randomUUID(),title:'Shopping'};expect((await rpc('tools/call',{name:'create_grocery_list',arguments:createArgs})).json().result.isError).not.toBe(true);expect((await rpc('tools/call',{name:'create_grocery_list',arguments:createArgs})).json().result.isError).not.toBe(true);
  const input={workspaceId:workspace,listId:list.id,operationId:randomBytes(16).toString('hex'),itemId:list.id,title:'Milk',quantity:'2',unit:'l'};
  const invalid=await rpc('tools/call',{name:'add_grocery_item',arguments:input});expect(invalid.json().result.isError).toBe(true);
  input.operationId=randomUUID();input.itemId=randomUUID();
  const added=await rpc('tools/call',{name:'add_grocery_item',arguments:input});
  expect(added.json().result.isError,added.body).not.toBe(true);
  expect(JSON.parse(added.json().result.content[0].text)).toEqual({outcome:'APPLIED',duplicate:false});
  const retry=await rpc('tools/call',{name:'add_grocery_item',arguments:input});
  expect(JSON.parse(retry.json().result.content[0].text)).toEqual({outcome:'APPLIED',duplicate:true});
  expect((await rpc('tools/call',{name:'get_grocery_list',arguments:{workspaceId:workspace,listId:list.id}})).json().result.isError).toBe(true);
  expect((await t.get(`/api/workspaces/${workspace}/lists/${list.id}`,t.admin)).json().list.items).toHaveLength(1);
  const other=await t.createWorkspace('Private');expect((await rpc('tools/call',{name:'add_grocery_item',arguments:{...input,workspaceId:other}})).json().result.isError).toBe(true);
  await t.post(`/api/workspaces/${workspace}/tools`,{tool:'LISTS',enabled:false},t.admin);expect((await rpc('tools/call',{name:'add_grocery_item',arguments:{...input,operationId:randomUUID(),itemId:randomUUID()}})).json().result.isError).toBe(true);
  const refreshed=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token});expect(refreshed.statusCode,refreshed.body).toBe(200);
  expect((await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token})).statusCode).toBe(400);
  await expect(t.services.mcp.verify(refreshed.json().access_token)).rejects.toThrow();
 });
 it('is off by default and refuses unknown origins and unsafe clients',async()=>{
  t=await startTestApp();expect((await t.get('/.well-known/oauth-authorization-server')).statusCode).toBe(404);expect((await t.get('/api/account/mcp/status',t.admin)).json()).toEqual({enabled:false});
  await t.close();t=await startTestApp({mcpEnabled:true});
  expect((await t.app.inject({method:'POST',url:'/register',headers:{origin:'https://attacker.example'},payload:{}})).statusCode).toBe(403);
  expect((await t.app.inject({method:'POST',url:'/register',headers:{host:'vmn.example.org'},payload:{redirect_uris:['http://attacker.example/callback'],token_endpoint_auth_method:'none'}})).statusCode).toBe(400);
 });
 it('keeps matching grocery List names isolated across selected and unselected Workspaces',async()=>{
  t=await startTestApp({mcpEnabled:true});
  const first=await t.createWorkspace('MCP test kitchen');
  const second=await t.createWorkspace('MCP test cabin');
  const unselected=await t.createWorkspace('MCP test private');
  async function createShopping(workspaceId:string) {
   const response=await t.post(`/api/workspaces/${workspaceId}/lists`,{title:'Shopping'},t.admin);
   expect(response.statusCode,response.body).toBe(201);
   return response.json().list.id as string;
  }
  const firstList=await createShopping(first);
  const secondList=await createShopping(second);
  const unselectedList=await createShopping(unselected);
  const todo=await t.post(`/api/workspaces/${first}/lists`,{title:'Tasks for this Workspace',kind:'TODO'},t.admin);
  expect(todo.statusCode,todo.body).toBe(201);
  const todoId=todo.json().list.id as string;

  const actor=await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id);
  if(!actor) throw new Error('Missing actor');
  const clientId=randomUUID();
  const redirectUri='https://client.example.org/callback';
  const scopes=['workspaces.read','lists.read','lists.write'] as const;
  await t.services.mcp.registerClient(clientId,{client_name:'Test assistant'});
  const requestId=await t.services.mcp.begin({
   clientId,redirectUri,state:null,codeChallenge:'a'.repeat(43),scopes:[...scopes],resource:ORIGIN+'/mcp',
  });
  const approved=await t.services.mcp.approve(actor,requestId,[first,second],[...scopes],true);
  const code=new URL(approved).searchParams.get('code');
  if(!code) throw new Error('Missing authorization code');
  const {access_token}=await t.services.mcp.exchange(clientId,code,'code',redirectUri,ORIGIN+'/mcp');
  async function call(name:string,args:object) {
   const response=await t.app.inject({
    method:'POST',url:'/mcp',headers:{authorization:'Bearer '+access_token,accept:'application/json, text/event-stream'},
    payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},
   });
   expect(response.statusCode,response.body).toBe(200);
   return response.json().result;
  }
  const resultBody=(result:Awaited<ReturnType<typeof call>>)=>JSON.parse(result.content[0].text);
  const discovered=resultBody(await call('list_workspaces',{}));
  expect(discovered.workspaces.map((workspace:{id:string})=>workspace.id).sort()).toEqual([first,second].sort());
  for(const [workspaceId,listId] of [[first,firstList],[second,secondList]]) {
   expect(resultBody(await call('list_grocery_lists',{workspaceId})).lists).toEqual([
    expect.objectContaining({id:listId,title:'Shopping'}),
   ]);
  }
  const entry={operationId:randomUUID(),itemId:randomUUID(),title:'Fictional tea'};
  expect((await call('get_grocery_list',{workspaceId:unselected,listId:unselectedList})).isError).toBe(true);
  expect((await call('get_grocery_list',{workspaceId:first,listId:secondList})).isError).toBe(true);
  expect((await call('get_grocery_list',{workspaceId:first,listId:todoId})).isError).toBe(true);
  expect((await call('add_grocery_item',{...entry,operationId:randomUUID(),workspaceId:first,listId:todoId})).isError).toBe(true);
  expect((await t.get(`/api/workspaces/${first}/lists/${todoId}`,t.admin)).json().list.items).toEqual([]);
  expect((await call('add_grocery_item',{...entry,operationId:randomUUID(),workspaceId:first,listId:secondList})).isError).toBe(true);
  expect((await call('add_grocery_item',{...entry,operationId:randomUUID(),workspaceId:unselected,listId:unselectedList})).isError).toBe(true);
  expect((await call('add_grocery_item',{...entry,workspaceId:first,listId:firstList})).isError).not.toBe(true);
  for(const [workspaceId,listId,count] of [[first,firstList,1],[second,secondList,0],[unselected,unselectedList,0]] as const) {
   const response=await t.get(`/api/workspaces/${workspaceId}/lists/${listId}`,t.admin);
   expect(response.statusCode,response.body).toBe(200);
   expect(response.json().list.items).toHaveLength(count);
  }
 });
 it('keeps editor and execution rights distinct and rechecks revocation inside mutation transactions',async()=>{
  t=await startTestApp({mcpEnabled:true});const workspace=await t.createWorkspace('Home');const cookie=await t.invite('assistant-user@example.org','User');await t.addMember(workspace,'assistant-user@example.org','USER');
  const actor=await t.services.users.findById((await t.get('/api/auth/session',cookie)).json().user.id);if(!actor)throw new Error('Missing actor');
  // Only server admins may allow a connection (36.24); the Workspace role USER still limits what it can do.
  t.database.sqlite.prepare('UPDATE users SET server_admin = 1 WHERE id = ?').run(actor.id);
  const clientId=randomUUID();await t.services.mcp.registerClient(clientId,{client_name:'Test assistant'});const pending=await t.services.mcp.begin({clientId,redirectUri:'https://client.example.org/callback',state:null,codeChallenge:'a'.repeat(43),scopes:['procedures.read','procedures.write','runs.read','runs.write','lists.write'],resource:ORIGIN+'/mcp'});const approved=await t.services.mcp.approve(actor,pending,[workspace],['procedures.read','procedures.write','runs.read','runs.write','lists.write'],true);const tokens=await t.services.mcp.exchange(clientId,String(new URL(approved).searchParams.get('code')),'code','https://client.example.org/callback',ORIGIN+'/mcp');
  const call=(name:string,input:object)=>t.app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+tokens.access_token,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:input}}});
  const definition=(await t.post(`/api/workspaces/${workspace}/procedures`,{title:'Kitchen',icon:'home',sections:[{title:'Prepare',steps:[{title:'Mix batter',required:false,skipReasonPolicy:'OPTIONAL',notApplicableReasonPolicy:'OPTIONAL'}]}]},t.admin)).json();const procedure=definition.procedure;
  const detail=(await t.get(`/api/workspaces/${workspace}/procedures/${procedure.id}`,t.admin)).json().procedure;
  const edit={workspaceId:workspace,procedureId:procedure.id,sectionId:detail.sections[0].id,expectedRevision:1,title:'Cook pancakes'};
  expect((await call('add_procedure_step',edit)).json().result.isError).toBe(true);
  const run=(await t.post(`/api/workspaces/${workspace}/runs`,{procedureId:procedure.id},cookie)).json().run;
  const input={workspaceId:workspace,runId:run.id,stepId:run.sections[0].steps[0].id,expectedState:'PENDING',operationId:randomUUID()};
  const done=await call('complete_run_step',input);expect(done.json().result.isError,done.body).not.toBe(true);expect((await call('complete_run_step',input)).json().result.isError).not.toBe(true);
  expect((await t.post(`/api/workspaces/${workspace}/members/${actor.id}/role`,{role:'EDITOR'},t.admin)).statusCode).toBe(204);
  const added=await call('add_procedure_step',edit);expect(added.json().result.isError,added.body).not.toBe(true);const current=(await t.get(`/api/workspaces/${workspace}/procedures/${procedure.id}`,t.admin)).json().procedure;expect(current.sections[0].steps).toHaveLength(2);expect(current.sections[0].steps[0].id).toBe(detail.sections[0].steps[0].id);expect((await t.get(`/api/workspaces/${workspace}/runs/${run.id}`,cookie)).json().run.sections[0].steps).toHaveLength(1);
  const verified=await t.services.mcp.verify(tokens.access_token);await t.services.mcp.revokeOwned(actor,verified.grant.id);
  const {withDelegation,hashMcpToken}=await import('@vergissmeinnicht/database');const {changeStepState}=await import('@vergissmeinnicht/application');
  await expect(withDelegation({grantId:verified.grant.id,clientId,userId:actor.id,tokenHash:hashMcpToken(tokens.access_token),scope:'runs.write',tool:'PROCEDURES'},()=>changeStepState(t.services.runs,{actor,workspaceId:workspace as import('@vergissmeinnicht/domain').WorkspaceId,runId:run.id,stepId:input.stepId,to:'PENDING',expectedState:'DONE'}))).rejects.toThrow();
  expect((await call('get_run',{workspaceId:workspace,runId:run.id})).statusCode).toBe(401);
 });

});

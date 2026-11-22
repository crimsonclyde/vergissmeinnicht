import {createAskRepository,openDatabase} from '@vergissmeinnicht/database';
import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import {askTurn,AskError,type AskProvider,type AskProviderResult} from '@vergissmeinnicht/application';
import type {User,WorkspaceId} from '@vergissmeinnicht/domain';
import {startTestApp} from './test-harness.ts';
const result=(text='OK'):AskProviderResult=>({text,output:[],usage:{input:100,output:20}});
const events=(body:string)=>body.trim().split('\n').map(line=>JSON.parse(line));
describe('Ask VMN session, context and billing boundaries',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;
 afterEach(async()=>{await t?.close();});
 async function configure(cap=1000000){const response=await t.post('/api/ask/admin',{enabled:true,lookups:true,cap,model:'gpt-5.4-mini-2026-03-17'},t.admin);expect(response.statusCode,response.body).toBe(200);}
 const turn=(cookie:string,workspaceId:string|null=null,conversationId=randomUUID(),question='How would I ask Gianni in Italian when he can come with his tractor?',requestId=randomUUID())=>t.post('/api/ask/turn',{conversationId,workspaceId,question,requestId},cookie);
 async function setupLookup(){
  const workspace=await t.createWorkspace('Casa Nostra');
  await t.post(`/api/workspaces/${workspace}/tools`,{tool:'JOURNAL',enabled:true},t.admin);
  await t.post(`/api/workspaces/${workspace}/tools`,{tool:'RECIPES',enabled:true},t.admin);
  await t.post(`/api/ask/policy/${workspace}`,{enabled:true},t.admin);
  const member=await t.invite('member@example.org','Gianni');await t.addMember(workspace,'member@example.org','USER');
  const note=await t.post(`/api/workspaces/${workspace}/journal`,{content:{kind:'note',version:2,title:'Oven functions',date:null,body:'Fan at 180°C for the oven; grill for browning.',collection:'Kitchen',tags:[],pinned:false},expectedRevision:0,archived:false},t.admin);
  expect(note.statusCode,note.body).toBe(201);
  return {workspace,member,note:note.json().entry};
 }
 function lookupProvider(calls:unknown[]):AskProvider{return {configured:true,async respond(input,lookup,_signal,delta){calls.push(input);if(lookup)return {...result(''),query:'oven',callId:'call_1',output:[{type:'function_call',name:'search_records',call_id:'call_1',arguments:'{"query":"oven"}'}]};const text=JSON.stringify(input).includes('Fan at 180')?'Use the fan at 180°C.':'No accessible matching record was found.';delta(text);return result(text);}};}
 it('ordinary member asks general question with MCP off and no records or Workspace identifiers sent',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls),captureLogs:true});await configure();const {member,workspace}=await setupLookup();
  expect((await t.get('/mcp')).statusCode).toBe(404);
  const answer=events((await turn(member)).body);expect(answer.at(-1).type).toBe('done');
  expect(calls).toHaveLength(1);expect(JSON.stringify(calls)).not.toContain('Oven functions');expect(JSON.stringify(calls)).not.toContain(workspace);
  expect(t.logs).not.toContain('Gianni in Italian');expect(t.logs).not.toContain('Fan at 180');
  expect((await t.get('/api/ask/admin',member)).statusCode).toBe(403);
 });
 it('finds the oven Note as the member, links to the record, blocks another owner and binds follow-ups',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls)});await configure();const {member,workspace,note}=await setupLookup();const id=randomUUID();
  const response=events((await turn(member,workspace,id,'What did we save about the oven functions in Casa Nostra?')).body);expect(response.at(-1),JSON.stringify(response)).toMatchObject({type:'done',conversation:{sources:[{id:note.id,url:`/w/${workspace}/notes/${note.id}`}],messages:[{role:'user'},{role:'assistant',content:'Use the fan at 180°C.'}]}});
  expect((await t.get(`/api/workspaces/${workspace}/journal/${note.id}`,member)).statusCode).toBe(200);
  expect((await t.get(`/api/ask/conversations/${id}`,t.admin)).statusCode).toBe(403);
  expect((await t.post(`/api/ask/conversations/${id}/delete`,{},t.admin)).statusCode).toBe(403);
  expect(()=>t.database.sqlite.prepare('UPDATE ask_conversations SET workspace_id=NULL WHERE id=?').run(id)).toThrow('immutable chat binding');
  const before=calls.length;expect(events((await turn(member,null,id)).body).at(-1).code).toBe('ask_workspace_changed');expect(calls).toHaveLength(before);
  await t.post(`/api/workspaces/${workspace}/tools`,{tool:'JOURNAL',enabled:false},t.admin);
  expect(events((await turn(member,workspace,id,'Tell me more')).body).at(-1).code).toBe('ask_context_unavailable');expect(calls).toHaveLength(before);
  expect((await t.get(`/api/ask/conversations/${id}`,member)).statusCode).not.toBe(200);
  expect((await t.post(`/api/ask/conversations/${id}/delete`,{},member)).statusCode).toBe(200);
 });
 it('revoked membership and Workspace AI policy prevent reuse before another provider request',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls)});await configure();const {member,workspace}=await setupLookup();const id=randomUUID();await turn(member,workspace,id,'oven');const before=calls.length;
  await t.post(`/api/ask/policy/${workspace}`,{enabled:false},t.admin);expect(events((await turn(member,workspace,id,'more')).body).at(-1).code).toBe('ask_context_unavailable');
  await t.post(`/api/ask/policy/${workspace}`,{enabled:true},t.admin);
  t.database.sqlite.prepare('UPDATE workspaces SET ai_assistants=0 WHERE id=?').run(workspace);
  expect(events((await turn(member,workspace,id,'more')).body).at(-1).code).toBe('ask_context_unavailable');
  expect(calls).toHaveLength(before);
  t.database.sqlite.prepare('UPDATE workspaces SET ai_assistants=1 WHERE id=?').run(workspace);
  t.database.sqlite.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=(SELECT id FROM users WHERE email=?)').run(workspace,'member@example.org');
  expect(events((await turn(member,workspace,id,'more')).body).at(-1).type).toBe('error');expect(calls).toHaveLength(before);
 });
 it('no matching source produces no invented link; excludes private Journal and private Recipes',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls)});await configure();const {member,workspace}=await setupLookup();
  t.database.sqlite.prepare("UPDATE journal_entries SET title='Other appliance', body='No matching content'").run();
  await t.post('/api/account/journal/privacy',{version:1},member);
  const privateEntry=await t.post('/api/account/journal',{content:{kind:'note',version:2,title:'Private oven journal',date:'2026-11-22',body:'SECRET JOURNAL oven',collection:'',tags:[],pinned:false},expectedRevision:0,archived:false},member);
  expect(privateEntry.statusCode,privateEntry.body).toBe(201);
  const privateRecipe=await t.post(`/api/workspaces/${workspace}/recipes`,{content:{version:1,title:'oven secret recipe',private:true,categories:['main'],servings:1,ingredients:[{name:'salt',amount:'1',unit:'g',note:''}],instructions:'SECRET RECIPE',tags:[],source:'',prepMinutes:null,cookMinutes:null},expectedRevision:0,archived:false},t.admin);
  expect(privateRecipe.statusCode,privateRecipe.body).toBe(201);
  const answer=events((await turn(member,workspace,randomUUID(),'oven')).body).at(-1);expect(answer).toMatchObject({type:'done',conversation:{sources:[],messages:[{role:'user'},{role:'assistant',kind:'no_matches',content:expect.stringContaining('No accessible matching')}]}});expect(calls).toHaveLength(1);expect(JSON.stringify(calls)).not.toContain('SECRET JOURNAL');expect(JSON.stringify(calls)).not.toContain('SECRET RECIPE');
 });
 it('atomic reservations admit only one concurrent request near the cap; failures keep full charge and retry ids cannot spend twice',async()=>{
  let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});let calls=0;
  t=await startTestApp({askProvider:{configured:true,async respond(){calls++;await blocked;throw new Error('provider secret diagnostic');}}});await configure(100000);
  const second=await t.invite('second@example.org','Second');
  const first=turn(t.admin);await new Promise<void>(resolve=>setTimeout(resolve,30));const denied=events((await turn(second)).body);expect(denied.at(-1).code).toBe('ask_budget_reached');release();expect(events((await first).body).at(-1).code).toBe('ask_provider_failed');expect(calls).toBe(1);
  expect((await t.get('/api/ask/admin',t.admin)).json().usage).toMatchObject({charge:100000,requests:1,pending:0});expect(events((await turn(second)).body).at(-1).code).toBe('ask_budget_reached');
 });
 it('defaults off, requires CSRF and dedicated credential; retains configuration and external data',async()=>{
  t=await startTestApp({mcpEnabled:true});expect((await t.get('/api/ask/status',t.admin)).json()).toEqual({enabled:false,hasHistory:false,lookups:false});
  expect(events((await turn(t.admin)).body).at(-1).code).toBe('ask_disabled');await configure();expect(events((await turn(t.admin)).body).at(-1).code).toBe('ask_key_missing');
  expect((await t.post('/api/ask/turn',{},t.admin,null)).statusCode).toBe(403);
  expect((await t.get('/api/account/mcp/status',t.admin)).statusCode).toBe(200);
  expect((await t.get('/api/admin/mcp/',t.admin)).statusCode).toBe(200);
 });
 it('reconciles known usage, keeps pending spend across restart, and deletion cannot refund or resurrect history',async()=>{
  t=await startTestApp({askProvider:{configured:true,async respond(){return result();}}});await configure();const id=randomUUID(),requestId=randomUUID();await turn(t.admin,null,id,'hello',requestId);
  const actor=(await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id)) as User;
  expect((await t.get('/api/ask/admin',t.admin)).json().usage.charge).toBe(165);
  expect(events((await turn(t.admin,null,id,'hello',requestId)).body).at(-1).code).toBe('ask_request_used');
  await t.post(`/api/ask/conversations/${id}/delete`,{},t.admin);expect((await t.get('/api/ask/admin',t.admin)).json().usage.charge).toBe(165);
  expect(()=>t.services.ask.repo.save(actor,{id,workspaceId:null,messages:[],sources:[],updatedAt:Date.now()})).toThrow(AskError);
  t.services.ask.repo.reserve(actor,randomUUID(),'2026-11',Date.now()-130000);
  expect(t.services.ask.repo.usage(actor,'2026-11').charge).toBeGreaterThanOrEqual(100000);
  expect(()=>t.services.ask.repo.policy(actor,randomUUID() as WorkspaceId,true)).toThrow();
 });
 it('cancels an in-flight response, keeps unknown usage charged and refuses to resurrect a deleted chat',async()=>{
  let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  t=await startTestApp({askProvider:{configured:true,async respond(_input,_lookup,signal){entered();await new Promise<void>(resolve=>signal.onAbort(resolve));throw new Error('upstream abort');}}});await configure();
  const actor=(await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id)) as User;
  const controller=new AbortController();const id=randomUUID();
  const pending=askTurn(t.services.ask,actor,{conversationId:id,requestId:randomUUID(),workspaceId:null,question:'hello'},{get aborted(){return controller.signal.aborted;},onAbort:listener=>{controller.signal.addEventListener('abort',listener);return()=>controller.signal.removeEventListener('abort',listener);}},()=>{});
  await started;t.services.ask.repo.delete(actor,id);controller.abort();await expect(pending).rejects.toThrow('ask_stopped');
  expect(t.services.ask.repo.usage(actor,new Date().toISOString().slice(0,7))).toMatchObject({charge:100000,pending:0});
  expect(()=>t.services.ask.repo.find(actor,id)).toThrow('ask_not_found');
 });
 it('rechecks changed source visibility and server lookup policy before reusing any stored excerpt',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls)});await configure();const {member,workspace,note}=await setupLookup();const id=randomUUID();await turn(member,workspace,id,'oven');const before=calls.length;
  await t.post(`/api/ask/policy/${workspace}`,{enabled:false},member).then(response=>expect(response.statusCode).toBe(403));
  t.database.sqlite.prepare('UPDATE journal_entries SET revision=revision+1 WHERE id=?').run(note.id);
  expect(events((await turn(member,workspace,id,'more')).body).at(-1).code).toBe('ask_context_unavailable');expect(calls).toHaveLength(before);
  await t.post('/api/ask/admin',{enabled:true,lookups:false,cap:1000000,model:'gpt-5.4-mini-2026-03-17'},t.admin);
  expect(events((await turn(member,workspace,id,'more')).body).at(-1).code).toBe('ask_context_unavailable');expect(calls).toHaveLength(before);
  expect((await t.post('/api/ask/conversations/delete-all',{},member)).statusCode).toBe(200);expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM ask_conversations').get()).toEqual({n:0});
 });

 it('uses public Recipes from the selected Workspace and constructs their authorized detail links',async()=>{
  const calls:unknown[]=[];t=await startTestApp({askProvider:lookupProvider(calls)});await configure();const {workspace,member}=await setupLookup();
  const saved=await t.post(`/api/workspaces/${workspace}/recipes`,{content:{version:1,title:'Oven vegetables',private:false,categories:['main'],servings:1,ingredients:[{name:'salt',amount:'1',unit:'g',note:''}],instructions:'Roast the vegetables.',tags:[],source:'',prepMinutes:null,cookMinutes:null},expectedRevision:0,archived:false},t.admin);expect(saved.statusCode,saved.body).toBe(201);
  const answer=events((await turn(member,workspace,randomUUID(),'oven')).body).at(-1);expect(answer.type).toBe('done');expect(answer.conversation.sources).toContainEqual(expect.objectContaining({kind:'recipe',id:saved.json().recipe.id,url:`/w/${workspace}/recipes?recipe=${saved.json().recipe.id}`}));expect((await t.get(`/api/workspaces/${workspace}/recipes/${saved.json().recipe.id}`,member)).statusCode).toBe(200);
 });
 it('keeps admission and unknown spending authoritative across database connections and restart',async()=>{
  t=await startTestApp();await configure(100000);const other=await t.invite('other-budget@example.org','Other');
  const actor=(await t.services.users.findById((await t.get('/api/auth/session',t.admin)).json().user.id)) as User;
  const otherActor=(await t.services.users.findById((await t.get('/api/auth/session',other)).json().user.id)) as User;
  const month=new Date().toISOString().slice(0,7),id=randomUUID();t.services.ask.repo.reserve(actor,id,month,Date.now()-130000);
  let database=openDatabase(t.database.path);
  try{const repo=createAskRepository(database);expect(()=>repo.reserve(otherActor,randomUUID(),month,Date.now())).toThrow('ask_budget_reached');repo.settle(id,null);repo.settle(id,0);expect(repo.usage(actor,month)).toMatchObject({charge:100000,pending:0});}finally{database.close();}
  database=openDatabase(t.database.path);try{expect(createAskRepository(database).usage(actor,month).charge).toBe(100000);}finally{database.close();}
 });

});

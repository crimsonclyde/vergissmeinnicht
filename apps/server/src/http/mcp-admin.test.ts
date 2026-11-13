import {randomUUID} from 'node:crypto';
import {afterEach,describe,expect,it} from 'vitest';
import type {McpScope} from '@vergissmeinnicht/domain';
import {startTestApp,ORIGIN} from './test-harness.ts';

/** Server admin → AI connections (steps.md 36.24): only server admins allow and manage connections. */
describe('AI connections in Server admin',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;
 afterEach(async()=>{await t?.close();});

 async function pending(scopes:McpScope[]){
  const clientId=randomUUID();await t.services.mcp.registerClient(clientId,{client_name:'Household assistant'});
  const requestId=await t.services.mcp.begin({clientId,redirectUri:'https://client.example.org/callback',state:null,codeChallenge:'a'.repeat(43),scopes,resource:ORIGIN+'/mcp'});
  return {clientId,requestId};
 }
 async function connect(cookie:string,workspaceIds:string[],scopes:McpScope[]){
  const {clientId,requestId}=await pending(scopes);
  const approved=await t.post('/api/account/mcp/approve',{requestId,allow:true,workspaceIds,scopes},cookie);
  expect(approved.statusCode,approved.body).toBe(200);
  const code=new URL(approved.json().redirect).searchParams.get('code');if(!code)throw new Error('Missing code');
  const tokens=await t.services.mcp.exchange(clientId,code,'code','https://client.example.org/callback',ORIGIN+'/mcp');
  return {clientId,tokens,grantId:(await t.services.mcp.verify(tokens.access_token)).grant.id};
 }
 const call=(access:string,name:string,args:object)=>t.app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer '+access,accept:'application/json, text/event-stream'},payload:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}});

 it('lets only a server admin allow a connection; anyone may decline',async()=>{
  t=await startTestApp({mcpEnabled:true});const home=await t.createWorkspace('Home');
  const member=await t.invite('member@example.org','Member');await t.addMember(home,'member@example.org','ADMIN');
  const {requestId}=await pending(['workspaces.read']);
  const refused=await t.post('/api/account/mcp/approve',{requestId,allow:true,workspaceIds:[home],scopes:['workspaces.read']},member);
  expect(refused.statusCode).toBe(403);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM mcp_grants').get()).toEqual({n:0});
  const declined=await t.post('/api/account/mcp/approve',{requestId,allow:false,workspaceIds:[],scopes:[]},member);
  expect(declined.statusCode,declined.body).toBe(200);expect(declined.json().redirect).toContain('error=access_denied');
  const again=await pending(['workspaces.read']);
  expect((await t.post('/api/account/mcp/approve',{requestId:again.requestId,allow:true,workspaceIds:[home],scopes:['workspaces.read']},t.admin)).statusCode).toBe(200);
 });

 it('lists every connection without token material, and refuses everyone but server admins',async()=>{
  t=await startTestApp({mcpEnabled:true});const home=await t.createWorkspace('Home');const office=await t.createWorkspace('Office');
  const {tokens}=await connect(t.admin,[home,office],['workspaces.read','lists.read']);
  const member=await t.invite('member@example.org','Member');await t.addMember(home,'member@example.org','USER');
  expect((await t.get('/api/admin/mcp/')).statusCode).toBe(401);
  expect((await t.get('/api/admin/mcp/',member)).statusCode).toBe(403);
  const listed=await t.get('/api/admin/mcp/',t.admin);expect(listed.statusCode,listed.body).toBe(200);
  expect(listed.json().connections).toMatchObject([{clientName:'Household assistant',owner:{displayName:'Ada'},workspaces:[{id:home,name:'Home'},{id:office,name:'Office'}],scopes:['workspaces.read','lists.read'],revokedAt:null,tokenIssued:true}]);
  expect(listed.body).not.toContain(tokens.access_token);expect(listed.body).not.toContain(tokens.refresh_token);
  await t.close();t=await startTestApp();
  expect((await t.get('/api/admin/mcp/',t.admin)).statusCode).toBe(404);
 });

 it('ends any connection at once and records who did it',async()=>{
  t=await startTestApp({mcpEnabled:true});const home=await t.createWorkspace('Home');
  const second=await t.invite('second-admin@example.org','Second admin');await t.addMember(home,'second-admin@example.org','EDITOR');
  t.database.sqlite.prepare("UPDATE users SET server_admin = 1 WHERE email = 'second-admin@example.org'").run();
  const {tokens,grantId}=await connect(second,[home],['workspaces.read']);
  const member=await t.invite('member@example.org','Member');
  expect((await t.post(`/api/admin/mcp/${grantId}/revoke`,{},member)).statusCode).toBe(403);
  expect((await t.post(`/api/admin/mcp/${randomUUID()}/revoke`,{},t.admin)).statusCode).toBe(403);
  expect((await t.post(`/api/admin/mcp/${grantId}/revoke`,{},t.admin)).statusCode).toBe(200);
  await expect(t.services.mcp.verify(tokens.access_token)).rejects.toThrow();
  expect((await call(tokens.access_token,'list_workspaces',{})).statusCode).toBe(401);
  const events=t.database.sqlite.prepare("SELECT actor_user_id AS actor, subject_id AS subject FROM security_events WHERE type = 'MCP_CONNECTION_CHANGED' AND metadata LIKE '%revoke%'").all();
  const ids=t.database.sqlite.prepare('SELECT id, email FROM users').all() as {id:string;email:string}[];
  expect(events).toEqual([{actor:ids.find(row=>row.email!=='second-admin@example.org'&&row.email!=='member@example.org')?.id,subject:ids.find(row=>row.email==='second-admin@example.org')?.id}]);
 });

});

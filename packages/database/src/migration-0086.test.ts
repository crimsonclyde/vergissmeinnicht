import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect,it} from 'vitest';
import {normalizeEmail} from '@vergissmeinnicht/domain';
import {openDatabase} from './connection.ts';
import {MIGRATIONS_FOLDER,runMigrations} from './migrate.ts';
import {createUserRepository} from './user-repository.ts';
import {createMcpRepository} from './mcp-repository.ts';
import {createAskRepository} from './ask-repository.ts';
import {insertLegacyWorkspace} from './test-support.ts';
it('0086 preserves populated external grants, pending consent, approvals, diagnostics inputs, Daily Planet and backup records; native chat remains off',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vmn-ask-upgrade-')),path=join(dir,'db.sqlite'),before=join(dir,'migrations');cpSync(MIGRATIONS_FOLDER,before,{recursive:true});const meta=join(before,'meta','_journal.json');const journal=JSON.parse(readFileSync(meta,'utf8')) as {entries:{tag:string}[]};journal.entries=journal.entries.filter(e=>e.tag<'0086');writeFileSync(meta,JSON.stringify(journal));let database=openDatabase(path);
 try{
  migrate(database.db,{migrationsFolder:before});const user=await createUserRepository(database).create({email:normalizeEmail('upgrade@example.org'),displayName:'Operator',emailVerified:true,status:'ACTIVE',serverAdmin:true});const home=insertLegacyWorkspace(database,{name:'Casa Nostra',adminUserId:user.id});
  const resource='https://vmn.example.org/mcp';let mcp=createMcpRepository(database,resource);const client=randomUUID();await mcp.registerClient(client,{client_name:'Daily Planet assistant'});
  const request=await mcp.begin({clientId:client,redirectUri:'https://client.example.org/callback',state:null,codeChallenge:'a'.repeat(43),scopes:['workspaces.read','gazette.read','gazette.write'],resource});const approved=await mcp.approve(user,request,[home.id],['workspaces.read','gazette.read','gazette.write'],true);const token=await mcp.exchange(client,String(new URL(approved).searchParams.get('code')),'code','https://client.example.org/callback',resource);
  const pending=await mcp.begin({clientId:client,redirectUri:'https://client.example.org/callback',state:'pending',codeChallenge:'b'.repeat(43),scopes:['workspaces.read'],resource});
  database.sqlite.prepare("INSERT INTO mcp_file_hosts(host,status,refused_count,first_seen_at,last_seen_at,decided_at,decided_by_user_id) VALUES('test.oaiusercontent.com','ALLOWED',1,1,1,1,?)").run(user.id);
  database.sqlite.prepare("INSERT INTO gazette_settings(workspace_id,settings,revision,updated_at,updated_by_user_id) VALUES(?, '{}',1,1,?)").run(home.id,user.id);
  database.sqlite.prepare("INSERT INTO workspace_backup_jobs(id,kind,workspace_id,state,requested_by_user_id,progress_done,progress_total,cancel_requested,created_at) VALUES(?,'EXPORT',?,'FAILED',?,0,0,0,1)").run(randomUUID(),home.id,user.id);
  const tables=['mcp_clients','mcp_grants','mcp_tokens','mcp_authorization_requests','mcp_file_hosts','gazette_settings','workspace_backup_jobs'];const rows=Object.fromEntries(tables.map(name=>[name,database.sqlite.prepare(`SELECT * FROM ${name}`).all()]));database.close();runMigrations(path);database=openDatabase(path);
  for(const name of tables)expect(database.sqlite.prepare(`SELECT * FROM ${name}`).all(),name).toEqual(rows[name]);
  mcp=createMcpRepository(database,resource);expect((await mcp.allConnections(user))[0]).toMatchObject({tokenIssued:true,owner:{id:user.id}});expect(await mcp.request(user,pending)).toBeDefined();
  // The preserved refresh token still exchanges after migration; no new consent or native credential is involved.
  expect(await mcp.exchange(client,token.refresh_token,'refresh',undefined,resource)).toHaveProperty('access_token');
  expect(createAskRepository(database).settings(user)).toMatchObject({enabled:false,lookups:false,cap:0});expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
 }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

import {cpSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {it,expect} from 'vitest';
import {normalizeEmail} from '@vergissmeinnicht/domain';
import {openDatabase} from './connection.ts';
import {MIGRATIONS_FOLDER,runMigrations} from './migrate.ts';
import {createUserRepository} from './user-repository.ts';
import {insertLegacyWorkspace} from './test-support.ts';
it('upgrades populated Release 42 Journals without reinterpreting text or acknowledging privacy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'vmn-notes-upgrade-'));const path=join(dir,'db.sqlite');const migrations=join(dir,'migrations');cpSync(MIGRATIONS_FOLDER,migrations,{recursive:true});
 const journal=JSON.parse(readFileSync(join(migrations,'meta/_journal.json'),'utf8'));journal.entries=journal.entries.filter((entry:{tag:string})=>entry.tag<'0061');writeFileSync(join(migrations,'meta/_journal.json'),JSON.stringify(journal));let database=openDatabase(path);
 try{
  migrate(database.db,{migrationsFolder:migrations});const user=await createUserRepository(database).create({email:normalizeEmail('notes-upgrade@example.org'),displayName:'Existing author',emailVerified:true,status:'ACTIVE',serverAdmin:false});const workspace=insertLegacyWorkspace(database,{name:'Existing Workspace',adminUserId:user.id});
  const body='<script>literal</script>\n**still plain text**';
  for(const table of ['journal_entries','private_journal_entries'])database.sqlite.prepare(`INSERT INTO ${table}(id,kind,version,title,date,body,revision,archived,created_by_user_id,created_by,updated_by_user_id,updated_by,created_at,updated_at,${table==='journal_entries'?'workspace_id':'owner_id'}) VALUES(?,'note',1,'Existing entry','2026-10-31',?,7,1,?,'Existing author',?,'Existing author',123,456,?)`).run(randomUUID(),body,user.id,user.id,table==='journal_entries'?workspace.id:user.id);
  const shared=database.sqlite.prepare('SELECT * FROM journal_entries').get();const personal=database.sqlite.prepare('SELECT * FROM private_journal_entries').get();database.close();runMigrations(path);database=openDatabase(path);
  expect(database.sqlite.prepare('SELECT * FROM journal_entries').get()).toMatchObject(shared as object);expect(database.sqlite.prepare('SELECT * FROM private_journal_entries').get()).toMatchObject(personal as object);
  for(const table of ['journal_entries','private_journal_entries'])expect(database.sqlite.prepare(`SELECT version,body,collection,tags,pinned FROM ${table}`).get()).toEqual({version:1,body,collection:'',tags:'[]',pinned:0});
  expect(database.sqlite.prepare('SELECT count(*) AS n FROM journal_acknowledgements').get()).toEqual({n:0});for(const table of ['journal_revisions','private_journal_revisions'])expect(database.sqlite.prepare(`SELECT revision,content FROM ${table}`).get()).toMatchObject({revision:7,content:expect.stringContaining('still plain text')});
  expect(()=>database.sqlite.prepare('UPDATE journal_entries SET date=NULL').run()).toThrow();expect(()=>database.sqlite.prepare('UPDATE private_journal_entries SET owner_id=?').run(randomUUID())).toThrow();expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
 }finally{database.close();rmSync(dir,{recursive:true,force:true});}
});

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { normalizeEmail } from '@vergissmeinnicht/domain';
import { openDatabase } from './connection.ts';
import { MIGRATIONS_FOLDER, runMigrations } from './migrate.ts';
import { createUserRepository } from './user-repository.ts';
import { insertLegacyWorkspace } from './test-support.ts';

it('0056 preserves populated Equipment and its identity/Trash guards, with no historical awards', async () => {
  const dir=mkdtempSync(join(tmpdir(),'vmn-0056-')),path=join(dir,'db.sqlite'),before=join(dir,'migrations');
  cpSync(MIGRATIONS_FOLDER,before,{recursive:true});
  const journalPath=join(before,'meta','_journal.json');
  const journal=JSON.parse(readFileSync(journalPath,'utf8')) as {entries:{tag:string}[]};
  journal.entries=journal.entries.filter(e=>e.tag<'0056');writeFileSync(journalPath,JSON.stringify(journal));
  let database=openDatabase(path);
  try {
    migrate(database.db,{migrationsFolder:before});
    const user=await createUserRepository(database).create({email:normalizeEmail('upgrade-56@example.org'),displayName:'Upgrade',emailVerified:true,status:'ACTIVE',serverAdmin:true});
    const ws=insertLegacyWorkspace(database,{name:'Existing',adminUserId:user.id}),id=randomUUID();
    database.sqlite.prepare("INSERT INTO equipment_records(id,workspace_id,name,model,serial_number,category_key,location_key,manufacturer_key,sort_key,search_text,created_by_user_id,created_by_display_name,created_at,updated_by_user_id,updated_by_display_name,updated_at) VALUES(?,?, 'Boiler','B-2','SERIAL-56','','','','boiler','boiler',?,'Upgrade',1,?,'Upgrade',1)").run(id,ws.id,user.id,user.id);
    const row=database.sqlite.prepare('SELECT * FROM equipment_records WHERE id=?').get(id) as object;
    database.close();runMigrations(path);database=openDatabase(path);
    expect(database.sqlite.prepare('SELECT * FROM equipment_records WHERE id=?').get(id)).toEqual({...row,replacement_parts:null,custom_fields:null});
    expect(database.sqlite.prepare('SELECT count(*) n FROM progress_awards').get()).toEqual({n:0});
    expect(()=>database.sqlite.prepare('UPDATE equipment_records SET id=? WHERE id=?').run(randomUUID(),id)).toThrow();
    expect(()=>database.sqlite.prepare('DELETE FROM equipment_records WHERE id=?').run(id)).toThrow();
    expect(database.sqlite.pragma('integrity_check',{simple:true})).toBe('ok');expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {database.close();rmSync(dir,{recursive:true,force:true});}
});

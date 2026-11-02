import {markdownAttachments} from '@vergissmeinnicht/domain';
import {createHash} from 'node:crypto';
import {openSync,readSync,closeSync,existsSync,mkdirSync,statSync,linkSync,copyFileSync,chmodSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import Database from 'better-sqlite3';
const KEY=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function attachmentPath(root:string,key:string){if(!KEY.test(key))throw new Error('Invalid attachment object key');return join(root,key);}
export function attachmentObjects(sqlite:Database.Database){
 if(!sqlite.prepare("SELECT name FROM sqlite_master WHERE name='attachments'").get())return [];
 const rows=sqlite.prepare('SELECT original_key AS key,sha256,bytes FROM attachments UNION ALL SELECT preview_key AS key,preview_hash AS sha256,preview_bytes AS bytes FROM attachments UNION ALL SELECT thumbnail_key AS key,thumbnail_hash AS sha256,thumbnail_bytes AS bytes FROM attachments').all() as {key:string;sha256:string;bytes:number}[];return rows;
}
function hash(path:string){const value=createHash('sha256');const buffer=Buffer.allocUnsafe(1<<20);const fd=openSync(path,'r');try{for(let n=readSync(fd,buffer,0,buffer.length,null);n>0;n=readSync(fd,buffer,0,buffer.length,null))value.update(buffer.subarray(0,n));}finally{closeSync(fd);}return value.digest('hex');}
export function verifyAttachmentFiles(sqlite:Database.Database,root:string){for(const file of attachmentObjects(sqlite)){const path=attachmentPath(root,file.key);if(!existsSync(path)||statSync(path).size!==file.bytes||hash(path)!==file.sha256)throw new Error('Attachment backup missing or damaged');}}
export function copyAttachmentFiles(databasePath:string,source:string,destination:string){const sqlite=new Database(databasePath,{readonly:true});try{for(const file of attachmentObjects(sqlite)){const from=attachmentPath(source,file.key);const to=attachmentPath(destination,file.key);if(existsSync(to)){if(statSync(to).size===file.bytes&&hash(to)===file.sha256)continue;throw new Error('Attachment backup damaged');}if(!existsSync(from)||statSync(from).size!==file.bytes||hash(from)!==file.sha256)throw new Error('Attachment original missing or damaged');mkdirSync(destination,{recursive:true,mode:0o700});try{linkSync(from,to);}catch(error){if(!['EXDEV','EPERM','EOPNOTSUPP','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??''))throw error;copyFileSync(from,to);chmodSync(to,0o600);}}}finally{sqlite.close();}}
export function attachmentRoot(databasePath:string){return join(dirname(databasePath),'attachments');}
export function pruneAttachmentBackups(backupDir:string,databases:readonly string[]){const used=new Set<string>();for(const file of databases){const db=new Database(file,{readonly:true});try{for(const item of attachmentObjects(db))used.add(item.key);}finally{db.close();}}const root=join(backupDir,'attachments');if(!existsSync(root))return;for(const key of readdirSync(root))if(KEY.test(key)&&!used.has(key))rmSync(attachmentPath(root,key));}

/** Apply the same unreferenced grace as live cleanup to a backup snapshot, never the live database. */
export function prepareAttachmentSnapshot(databasePath:string,now=new Date()){
 const db=new Database(databasePath);db.pragma('foreign_keys=ON');try{
  if(!db.prepare("SELECT name FROM sqlite_master WHERE name='attachments'").get())return;
  const keep=new Set<string>();
  for(const row of db.prepare('SELECT content FROM journal_drafts').iterate() as Iterable<{content:string}>){for(const ref of markdownAttachments(JSON.parse(row.content).body))keep.add(ref.id);}
  const candidates=db.prepare('SELECT id FROM attachments WHERE policy_key = \'journal\' AND (deleting = 1 OR (at < ? AND NOT EXISTS(SELECT 1 FROM journal_attachment_references WHERE attachment_id=attachments.id) AND NOT EXISTS(SELECT 1 FROM private_journal_attachment_references WHERE attachment_id=attachments.id)))').all(now.getTime()-86400000) as {id:string}[];
  if(db.prepare("SELECT name FROM sqlite_master WHERE name='recipe_attachment_references'").get()){
    const recipeCandidates=db.prepare("SELECT id FROM attachments WHERE policy_key='recipes' AND (deleting=1 OR (at < ? AND NOT EXISTS(SELECT 1 FROM recipe_attachment_references WHERE attachment_id=attachments.id)))").all(now.getTime()-86400000) as {id:string}[];
    candidates.push(...recipeCandidates);
  }
  const remove=db.prepare('DELETE FROM attachments WHERE id = ?');for(const row of candidates)if(!keep.has(row.id))remove.run(row.id);
 }finally{db.close();}
}

import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {uploadAttachment,authorizeJournal} from '@vergissmeinnicht/application';
import type {WorkspaceId} from '@vergissmeinnicht/domain';
import {purgeAttachmentFiles} from '@vergissmeinnicht/database';
import {startTestApp,ORIGIN} from './test-harness.ts';
const note=(body='',revision=0)=>({content:{kind:'note',version:2,title:'Portable note',date:null,body,collection:'Garden',tags:['summer'],pinned:true},expectedRevision:revision,archived:false});
describe('shared attachment service and Journal/Notes integration',()=>{
 let t:Awaited<ReturnType<typeof startTestApp>>;let workspace:string;let member:string;let guest:string;let png:Buffer;
 const shared=()=>`/api/workspaces/${workspace}/journal`;
 const upload=(base:string,cookie:string,bytes=png,name='private image.png')=>t.app.inject({method:'POST',url:base+'/attachments',headers:{cookie,origin:ORIGIN,'content-type':'application/octet-stream','x-file-name':encodeURIComponent(name)},payload:bytes});
 beforeEach(async()=>{t=await startTestApp({captureLogs:true});workspace=await t.createWorkspace('Garden');member=await t.invite('writer@example.org','Writer');guest=await t.invite('reader@example.org','Reader');await t.addMember(workspace,'writer@example.org','USER');await t.addMember(workspace,'reader@example.org','GUEST');await t.post(`/api/workspaces/${workspace}/tools`,{tool:'JOURNAL',enabled:true},t.admin);png=await sharp({create:{width:32,height:20,channels:3,background:'#667744'}}).png().withMetadata().toBuffer();});
 afterEach(async()=>t.close());
 it('enforces versioned acknowledgement before content, drafts and private uploads',async()=>{
  expect((await t.get('/api/account/journal/privacy',member)).json().acknowledged).toBe(false);
  expect((await t.post('/api/account/journal',note(),member)).statusCode).toBe(403);
  expect((await upload('/api/account/journal',member)).statusCode).toBe(403);
  expect((await t.post('/api/account/journal/draft',{draft:{entryId:null,expectedRevision:0,content:note().content,archived:false}},member)).statusCode).toBe(403);
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM private_journal_entries').get()).toEqual({n:0});
  for(let i=0;i<2;i++)expect((await t.post('/api/account/journal/privacy',{version:1},member)).statusCode).toBe(200);
  expect(t.database.sqlite.prepare("SELECT count(*) AS n FROM security_events WHERE type='JOURNAL_PRIVACY_ACKNOWLEDGED'").get()).toEqual({n:1});
  expect((await t.post('/api/account/journal',note(),member)).statusCode).toBe(201);
 });
 it('preserves exact originals, keeps duplicate uploads independent and guards provisional/private files',async()=>{
  await t.post('/api/account/journal/privacy',{version:1},member);
  const first=await upload('/api/account/journal',member);expect(first.statusCode,first.body).toBe(201);const file=first.json().attachment;
  const second=await upload('/api/account/journal',member);expect(second.statusCode,second.body).toBe(201);expect(second.json().attachment.id).not.toBe(file.id);
  const row=t.database.sqlite.prepare('SELECT * FROM attachments WHERE id=?').get(file.id) as {sha256:string;original_key:string;preview_key:string};expect(row.sha256).toBe(createHash('sha256').update(png).digest('hex'));expect(row.original_key).not.toBe(row.preview_key);
  const original=await t.get(`/api/account/journal/attachments/${file.id}/original`,member);expect(original.statusCode).toBe(200);expect(original.rawPayload.equals(png)).toBe(true);expect(original.headers['content-disposition']).toContain('attachment');
  const preview=await t.get(`/api/account/journal/attachments/${file.id}/preview`,member);expect(preview.statusCode).toBe(200);expect((await sharp(preview.rawPayload).metadata()).exif).toBeUndefined();
  await t.services.attachments.store.remove(row.preview_key);
  expect((await t.post(`/api/account/journal/attachments/${file.id}/regenerate`,{},member)).statusCode).toBe(200);
  expect((await t.get(`/api/account/journal/attachments/${file.id}/preview`,member)).statusCode).toBe(200);
  expect((await t.get(`/api/account/journal/attachments/${file.id}/original`,member)).rawPayload.equals(png)).toBe(true);
  for(const cookie of [t.admin,guest])expect((await t.get(`/api/account/journal/attachments/${file.id}/original`,cookie)).statusCode).toBe(404);
  expect((await t.post(shared(),note(`![image](attachments/${file.id}.png)`),member)).statusCode).toBe(403);
  expect((await t.get(shared(),member)).json().entries).toHaveLength(0);
  expect(JSON.stringify((await t.get('/api/admin/attachments',t.admin)).json())).not.toContain('private image.png');
 });
 it('applies shared guest/tool/foreign boundaries and retains originals through edits and revisions',async()=>{
  expect((await upload(shared(),guest)).statusCode).toBe(403);
  const uploaded=await upload(shared(),member);expect(uploaded.statusCode,uploaded.body).toBe(201);const file=uploaded.json().attachment;
  expect((await t.get(`${shared()}/attachments/${file.id}/preview`,guest)).statusCode).toBe(404);
  const created=await t.post(shared(),note(`![Photo](attachments/${file.id}.png)`),member);expect(created.statusCode,created.body).toBe(201);const entry=created.json().entry;
  expect((await t.get(`${shared()}/attachments/${file.id}/original`,guest)).rawPayload.equals(png)).toBe(true);
  expect((await t.post(`${shared()}/${entry.id}`,note('Replaced text',1),member)).statusCode).toBe(200);
  const revisions=await t.get(`${shared()}/${entry.id}/history`,guest);expect(revisions.json().revisions).toHaveLength(2);expect(revisions.json().revisions[1].content.body).toContain(file.id);
  await purgeAttachmentFiles(t.database,t.services.attachments.store,new Date(Date.now()+2*86400000));expect((await t.get(`${shared()}/attachments/${file.id}/original`,guest)).statusCode).toBe(200);
  await t.post(`/api/workspaces/${workspace}/tools`,{tool:'JOURNAL',enabled:false},t.admin);
  for(const cookie of [t.admin,member,guest])expect((await t.get(`${shared()}/attachments/${file.id}/preview`,cookie)).statusCode).toBe(404);
 });
 it('enforces quotas and server-admin settings without disclosing private content',async()=>{
  const actor=(await t.get('/api/auth/session',member)).json().user;
  expect((await t.get('/api/admin/attachments',member)).statusCode).toBe(403);
  expect((await t.post(`/api/admin/attachments/${actor.id}`,{bytes:30_000_000},t.admin)).statusCode).toBe(200);
  const user=await t.services.journal.users.findById(actor.id);if(!user)throw new Error('fixture');
  const outcomes=await Promise.allSettled([1,2,3].map(()=>t.services.attachments.repository.reserve(user,{workspaceId:workspace},22_000_000)));
  const admitted=outcomes.filter(item=>item.status==='fulfilled');expect(admitted.length).toBeGreaterThan(0);expect(admitted.reduce((total,item)=>total+item.value.bytes,0)).toBeLessThanOrEqual(30_000_000);
  for(const outcome of outcomes)if(outcome.status==='fulfilled')await t.services.attachments.repository.release(user,outcome.value.id);
  // Admission must allow a small original under an allowance below the per-file ceiling.
  await t.post(`/api/admin/attachments/${actor.id}`,{bytes:100_000},t.admin);
  const uploaded=await upload(shared(),member);expect(uploaded.statusCode).toBe(201);const file=uploaded.json().attachment;
  await t.post(`/api/admin/attachments/${actor.id}`,{bytes:0},t.admin);expect((await upload(shared(),member)).statusCode).toBe(409);expect((await t.get(`${shared()}/attachments/${file.id}/original`,member)).statusCode).toBe(200);
  expect((await t.get(`${shared()}/attachments/usage`,member)).json().usage.used).toBeGreaterThan(png.length);
  expect((await upload(shared(),member,Buffer.from('<svg><script>alert(1)</script></svg>'),'photo.png')).statusCode).toBe(409);
 });
 it('rechecks tool access after streaming and removes failed upload leases',async()=>{
  const actor=(await t.get('/api/auth/session',member)).json().user;
  const user=await t.services.journal.users.findById(actor.id);if(!user)throw new Error('fixture');
  const id=workspace as WorkspaceId;
  const source=(async function*(){yield png;await t.post(`/api/workspaces/${workspace}/tools`,{tool:'JOURNAL',enabled:false},t.admin);})();
  await expect(uploadAttachment(t.services.attachments,{actor:user,scope:{workspaceId:id},authorize:async write=>{await authorizeJournal(t.services.journal,user,id,write);}},'original.png',source)).rejects.toThrow();
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({n:0});
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachment_reservations').get()).toEqual({n:0});
 });
 it('rejects hostile content and cleans reservation/staging on failure',async()=>{
  for(const content of [Buffer.from('<html>bad</html>'),Buffer.from('<svg/>'),Buffer.from('MZexecutable')])expect((await upload(shared(),member,content)).statusCode).toBe(400);
  expect((await upload(shared(),member,Buffer.alloc(20_000_001))).json().error).toBe('attachment_too_large');
  expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachment_reservations').get()).toEqual({n:0});expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM attachments').get()).toEqual({n:0});
 });
 it('recovers separate drafts, records revisions atomically and exports portable Markdown',async()=>{
  const draft={entryId:null,expectedRevision:0,content:note('# Heading\n\n- [ ] task\n\n| A | B |\n| - | - |\n| 1 | 2 |').content,archived:false};
  expect((await t.post(shared()+'/draft',{draft},member)).statusCode).toBe(200);expect((await t.get(shared()+'/draft',member)).json().draft.content).toEqual(draft.content);
  expect((await t.get(shared()+'/draft',t.admin)).json().draft).toBeNull();
  const created=await t.post(shared(),note(draft.content.body),member);expect(created.statusCode).toBe(201);const entry=created.json().entry;
  expect((await t.get(shared()+'/draft',member)).json().draft).toBeNull();
  const exported=await t.get(`${shared()}/${entry.id}/export`,guest);expect(exported.statusCode,exported.body).toBe(200);expect(exported.body).toContain('- [ ] task');
  const archived=await t.post(shared(),{...note('Archived portable text'),archived:true},member);expect(archived.statusCode).toBe(201);
  const complete=await t.get(shared()+'/export?all=true&q=does-not-match',guest);expect(complete.statusCode).toBe(200);expect(complete.headers['content-type']).toContain('application/zip');expect(complete.rawPayload.includes(Buffer.from(entry.id+'.md'))).toBe(true);expect(complete.rawPayload.includes(Buffer.from(archived.json().entry.id+'.md'))).toBe(true);
  t.database.sqlite.exec("CREATE TRIGGER fail_notes BEFORE INSERT ON security_events WHEN NEW.type='JOURNAL_ENTRY_CHANGED' BEGIN SELECT RAISE(ABORT,'audit failure'); END");
  expect((await t.post(`${shared()}/${entry.id}`,note('not committed',1),member)).statusCode).toBe(500);
  expect((await t.get(`${shared()}/${entry.id}/history`,member)).json().revisions).toHaveLength(1);
 });
});

describe('attachment server backups',()=>{
 it('restores private original bytes and detects corruption',async()=>{
  const {mkdtempSync,readFileSync,writeFileSync,rmSync}=await import('node:fs');const {join}=await import('node:path');const {tmpdir}=await import('node:os');const {backupDatabase,restoreDatabase,verifyDatabase}=await import('../../../../packages/database/src/backup.ts');
  const t=await startTestApp();const dir=mkdtempSync(join(tmpdir(),'vmn-attachment-backup-'));
  try{
   await t.post('/api/account/journal/privacy',{version:1},t.admin);const png=await sharp({create:{width:20,height:10,channels:3,background:'#336688'}}).png().withMetadata().toBuffer();
   const response=await t.app.inject({method:'POST',url:'/api/account/journal/attachments',headers:{cookie:t.admin,origin:ORIGIN,'content-type':'application/octet-stream','x-file-name':'personal.png'},payload:png});expect(response.statusCode,response.body).toBe(201);
   const file=response.json().attachment;await t.post('/api/account/journal',note(`![Personal](attachments/${file.id}.png)`),t.admin);
   const backup=join(dir,'backups','server.sqlite');await backupDatabase(t.database.path,backup,{mediaPath:t.paths.media,documentsPath:t.paths.documents});expect(()=>verifyDatabase(backup)).not.toThrow();
   const target=join(dir,'restored','server.sqlite');restoreDatabase(backup,target,{force:true});const row=t.database.sqlite.prepare('SELECT original_key FROM attachments WHERE id=?').get(file.id) as {original_key:string};
   expect(readFileSync(join(dir,'restored','attachments',row.original_key)).equals(png)).toBe(true);
   const customDocuments=join(dir,'custom-volume','documents');restoreDatabase(backup,join(dir,'custom-db','server.sqlite'),{force:true,documentsPath:customDocuments});
   expect(readFileSync(join(dir,'custom-volume','attachments',row.original_key)).equals(png)).toBe(true);
   writeFileSync(join(dir,'backups','attachments',row.original_key),'tampered');expect(()=>verifyDatabase(backup)).toThrow();
  }finally{await t.close();rmSync(dir,{recursive:true,force:true});}
 });
});

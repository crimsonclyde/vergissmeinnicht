import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { awardProgress } from '../../../../packages/database/src/progress-repository.ts';
import { ORIGIN, startTestApp } from './test-harness.ts';

describe('private progress and Equipment reference details', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string; let user: string; let guest: string; let other: string; let userId: string;
  const base = () => `/api/workspaces/${home}/equipment`;
  const points = async (cookie = user) => (await t.get('/api/account/progress', cookie)).json().points as number;
  beforeAll(async () => {
    t = await startTestApp({ captureLogs: true }); home = await t.createWorkspace('Reference collection');
    user = await t.invite('reference@example.org', 'Ada'); guest = await t.invite('reference-guest@example.org', 'Guest'); other = await t.invite('other-progress@example.org', 'Other');
    await t.addMember(home, 'reference@example.org', 'USER'); await t.addMember(home, 'reference-guest@example.org', 'GUEST');
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'EQUIPMENT', enabled: true }, t.admin);
    userId = (await t.get('/api/auth/session', user)).json().user.id as string;
  });
  afterAll(async () => t.close());

  it('requires a current session, has no person selector and refuses client awards', async () => {
    expect((await t.get('/api/account/progress')).statusCode).toBe(401);
    expect((await t.get(`/api/account/progress?userId=${userId}`, other)).statusCode).toBe(400);
    expect((await t.post('/api/account/progress', { points: 1000 }, user)).statusCode).toBe(404);
    expect(await points()).toBe(0); expect(await points(other)).toBe(0);
    expect((await t.post(base(), { name: 'Forged', points: 1000 }, user)).statusCode).toBe(400);
    expect(await points()).toBe(0);
  });

  it('saves bounded literal details, searches compatible parts, awards once and keeps values out of logs/history', async () => {
    const input = { name: 'Terrace power supply', manufacturer: 'Nordwerk', model: 'PS-24C', replacementParts: 'Filter HCF-18\nCover C-40', customFields: [{ label: 'Finish', value: '<script>literal</script>' }] };
    const created = await t.post(base(), input, user); expect(created.statusCode).toBe(201);
    const record = created.json().record;
    expect(await points()).toBe(10); expect(await points(other)).toBe(0); expect(await points(t.admin)).toBe(0);
    expect((await t.get(`${base()}?q=HCF-18`, guest)).json().records).toHaveLength(1);
    expect((await t.get(`${base()}/${record.id}`, guest)).json().record).toMatchObject(input);
    expect((await t.post(`${base()}/${record.id}/update`, { ...input, expectedRevision: 1 }, user)).statusCode).toBe(200);
    const legacy = await t.post(`${base()}/${record.id}/update`, {name:'Older client',expectedRevision:2},user);
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().record).toMatchObject({replacementParts:input.replacementParts,customFields:input.customFields});
    await t.post(`${base()}/${record.id}/delete`, {}, user); await t.post(`${base()}/${record.id}/restore`, {}, user);
    expect(await points()).toBe(10);
    const history = JSON.stringify(t.database.sqlite.prepare('SELECT metadata FROM audit_events WHERE subject_id=?').all(record.id));
    expect(history).not.toContain('HCF-18'); expect(history).not.toContain('<script>'); expect(t.logs).not.toContain('HCF-18');
    const marks = JSON.stringify(t.database.sqlite.prepare('SELECT * FROM progress_awards').all());
    expect(marks).not.toContain(record.id); expect(marks).not.toContain('Terrace');
  });

  it('rejects guests, other Workspaces, hostile details, lost tools and CSRF without earning anything', async () => {
    const before = await points();
    expect((await t.post(base(), { name: 'Forbidden' }, guest)).statusCode).toBe(403);
    expect((await t.post(base(), { name: 'Foreign' }, other)).statusCode).toBe(404);
    for (const content of [
      { customFields: [{label:'x',value:'a'},{label:'X',value:'b'}] },
      { customFields: [{label:'x',value:'\u202e'}] },
      { customFields: Array.from({length:17}, (_,i)=>({label:String(i),value:'v'})) },
      { customFields: [{label:'x',value:'v',html:true}] },
      { replacementParts: 'x'.repeat(2001) },
    ]) expect((await t.post(base(), { name: 'Bad', ...content }, user)).statusCode).toBe(400);
    expect((await t.app.inject({method:'POST',url:base(),headers:{cookie:user,origin:'https://foreign.invalid','content-type':'application/json'},payload:{name:'CSRF'}})).statusCode).toBe(403);
    expect((await t.app.inject({method:'POST',url:base(),headers:{cookie:user,origin:ORIGIN,'content-type':'application/json'},payload:{name:'ok',customFields:[{label:'x',value:'v'}]}})).statusCode).toBe(201);
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'EQUIPMENT', enabled: false }, t.admin);
    expect((await t.post(base(), { name: 'Disabled' }, user)).statusCode).toBe(404);
    expect(await points()).toBe(before+10);
    await t.post(`/api/workspaces/${home}/tools`, { tool: 'EQUIPMENT', enabled: true }, t.admin);
  });

  it('rolls back the content and award when its audit fails', async () => {
    const before=await points(); const count=t.database.sqlite.prepare('SELECT count(*) n FROM equipment_records').get();
    t.database.sqlite.exec("CREATE TRIGGER progress_test_failure BEFORE INSERT ON audit_events WHEN NEW.type='EQUIPMENT_CREATED' BEGIN SELECT RAISE(ABORT,'test'); END");
    try { expect((await t.post(base(), {name:'Rollback'},user)).statusCode).toBe(500); } finally {t.database.sqlite.exec('DROP TRIGGER progress_test_failure');}
    expect(await points()).toBe(before); expect(t.database.sqlite.prepare('SELECT count(*) n FROM equipment_records').get()).toEqual(count);
  });

  it('keeps the migration identity/Trash guards and checks details even on raw SQL writes', () => {
    const row=t.database.sqlite.prepare('SELECT id,custom_fields FROM equipment_records LIMIT 1').get() as {id:string;custom_fields:string};
    for (const value of ['{}','[1]',JSON.stringify([{label:'x',value:'v',extra:true}]),JSON.stringify([{label:'x',value:'v'.repeat(501)}])]) expect(()=>t.database.sqlite.prepare('UPDATE equipment_records SET custom_fields=? WHERE id=?').run(value,row.id)).toThrow();
    expect(()=>t.database.sqlite.prepare('UPDATE equipment_records SET id=? WHERE id=?').run(randomUUID(),row.id)).toThrow();
    expect(()=>t.database.sqlite.prepare('DELETE FROM equipment_records WHERE id=?').run(row.id)).toThrow();
    expect(t.database.sqlite.prepare('SELECT custom_fields FROM equipment_records WHERE id=?').get(row.id)).toEqual({custom_fields:row.custom_fields});
  });

  it('caps simultaneous real mutation requests and retains the own total after leaving a Workspace', async () => {
    const cookie=await t.invite('concurrent-progress@example.org','Concurrent');
    await t.addMember(home,'concurrent-progress@example.org','USER');
    const id=(await t.get('/api/auth/session',cookie)).json().user.id as string;
    const responses=await Promise.all(Array.from({length:16},(_,i)=>t.post(base(),{name:`Concurrent ${i}`},cookie)));
    expect(responses.every(r=>r.statusCode===201)).toBe(true);
    expect(await points(cookie)).toBe(100);
    t.database.sqlite.prepare('DELETE FROM memberships WHERE workspace_id=? AND user_id=?').run(home,id);
    expect(await points(cookie)).toBe(100);
    expect((await t.post(base(),{name:'After leaving'},cookie)).statusCode).toBe(404);
    expect(await points(cookie)).toBe(100);
  });

  it('deduplicates completions across actors/days, caps UTC-day earnings, and refuses inactive owners', async () => {
    const source=randomUUID(), now=new Date('2030-01-01T12:00:00Z');
    const otherId=(await t.get('/api/auth/session',other)).json().user.id as string;
    t.database.db.transaction(tx=>{
      awardProgress(tx,userId,source,'STEP_STATE_CHANGED',now,{to:'DONE'});
      awardProgress(tx,userId,source,'STEP_STATE_CHANGED',new Date('2030-01-02'),{to:'DONE'});
      awardProgress(tx,otherId,source,'STEP_STATE_CHANGED',now,{to:'DONE'});
      for(let i=0;i<30;i++) awardProgress(tx,userId,randomUUID(),'EQUIPMENT_CREATED',now);
    },{behavior:'immediate'});
    expect(t.database.sqlite.prepare('SELECT sum(points) n FROM progress_awards WHERE at >= ?').get(now.getTime())).toEqual({n:100});
    expect(await points(other)).toBe(0);
    t.database.sqlite.prepare("UPDATE users SET status='DISABLED' WHERE id=?").run(otherId);
    t.database.db.transaction(tx=>awardProgress(tx,otherId,randomUUID(),'EQUIPMENT_CREATED',now));
    expect((await t.get('/api/account/progress',other)).statusCode).toBe(401);
    expect(()=>t.database.sqlite.prepare('INSERT INTO progress_awards VALUES(?,?,?,?)').run('a'.repeat(64),otherId,10,now.getTime())).toThrow();
  });
});

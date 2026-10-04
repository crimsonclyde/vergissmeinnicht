import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeEquipmentContent, type WorkspaceId, type UserId } from '@vergissmeinnicht/domain';
import { ORIGIN, startTestApp } from './test-harness.ts';
describe('Equipment HTTP, transactions and links (16.8)', () => {
    let t: Awaited<ReturnType<typeof startTestApp>>;
    let home: string;
    let other: string;
    let user: string;
    let guest: string;
    let editor: string;
    let outsider: string;
    const base = (workspace = home) => `/api/workspaces/${workspace}`;
    const add = async (name: string, workspace = home) => { const response = await t.post(`${base(workspace)}/equipment`, { name }, t.admin); expect(response.statusCode).toBe(201); return response.json().record as {
        id: string;
        revision: number;
    }; };
    const routes = (id: string) => [
        ['GET', '/equipment', undefined], ['GET', '/equipment/filters', undefined], ['GET', '/equipment/trash', undefined], ['POST', '/equipment', { name: 'Boiler' }],
        ['GET', `/equipment/${id}`, undefined], ['POST', `/equipment/${id}/update`, { name: 'Changed', expectedRevision: 1 }], ['POST', `/equipment/${id}/delete`, {}], ['POST', `/equipment/${id}/restore`, {}], ['GET', `/equipment/${id}/links`, undefined], ['POST', `/equipment/${id}/links`, { target: { type: 'contact', id: randomUUID() } }], ['POST', '/equipment/trash/purge', { all: true }], ['POST', `/equipment-links/${randomUUID()}/delete`, {}],
    ] as const;
    beforeAll(async () => {
        t = await startTestApp({ captureLogs: true });
        user = await t.invite('equipment-user@example.org', 'Uma');
        guest = await t.invite('equipment-guest@example.org', 'Gus');
        editor = await t.invite('equipment-editor@example.org', 'Ed');
        outsider = await t.invite('equipment-outsider@example.org', 'Other');
        home = await t.createWorkspace('Home');
        other = await t.createWorkspace('Other');
        await t.addMember(home, 'equipment-user@example.org', 'USER');
        await t.addMember(home, 'equipment-guest@example.org', 'GUEST');
        await t.addMember(home, 'equipment-editor@example.org', 'EDITOR');
        await t.addMember(other, 'equipment-outsider@example.org', 'ADMIN');
    }, 60000);
    afterAll(async () => t.close());
    it('every disabled route answers 404 for all four roles and 401 without a session; defaults and switches keep data', async () => {
        const before = t.database.sqlite.prepare('SELECT * FROM equipment_records').all();
        for (const cookie of [t.admin, user, editor, guest])
            for (const [method, path, body] of routes(randomUUID())) {
                const response = method === 'GET' ? await t.get(base() + path, cookie) : await t.post(base() + path, body, cookie);
                expect({ path, status: response.statusCode }).toEqual({ path, status: 404 });
            }
        expect((await t.get(base() + '/equipment')).statusCode).toBe(401);
        expect((await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: true }, user)).statusCode).toBe(403);
        expect((await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: true }, t.admin)).statusCode).toBe(200);
        expect(t.database.sqlite.prepare('SELECT * FROM equipment_records').all()).toEqual(before);
        await t.post(base(other) + '/tools', { tool: 'EQUIPMENT', enabled: true }, t.admin);
    });
    it('only a name is required; guests see serials, cannot write; Workspace ids grant nothing', async () => {
        const boiler = await add('Boiler');
        const response = await t.post(`${base()}/equipment/${boiler.id}/update`, { name: 'Boiler', model: 'B-2', serialNumber: 'SECRET-001', location: 'Cellar', manufacturer: 'Müller', category: 'Heating', warrantyExpiry: '2027-12-01', expectedRevision: boiler.revision }, user);
        expect(response.statusCode).toBe(200);
        expect((await t.get(`${base()}/equipment/${boiler.id}`, guest)).json().record).toMatchObject({ serialNumber: 'SECRET-001', model: 'B-2', revision: 2 });
        for (const [method, path, body] of routes(boiler.id))
            if (method === 'POST')
                expect((await t.post(base() + path, body, guest)).statusCode).toBe(403);
        for (const [method, path, body] of routes(boiler.id))
            expect((method === 'GET' ? await t.get(base() + path, outsider) : await t.post(base() + path, body, outsider)).statusCode).toBe(404);
        expect((await t.get(`${base(other)}/equipment/${boiler.id}`, outsider)).statusCode).toBe(404);
        expect(t.logs).not.toContain('SECRET-001');
        expect(JSON.stringify(t.database.sqlite.prepare("SELECT metadata FROM audit_events WHERE subject_type='equipment'").all())).not.toContain('SECRET-001');
    });
    it('refuses stale edits, malformed/extra fields and invalid dates; mutation and audit roll back together', async () => {
        const item = await add('Router');
        expect((await t.post(`${base()}/equipment/${item.id}/update`, { name: 'Updated', expectedRevision: 1 }, editor)).statusCode).toBe(200);
        expect((await t.post(`${base()}/equipment/${item.id}/update`, { name: 'Stale', expectedRevision: 1 }, user)).statusCode).toBe(409);
        expect((await t.get(`${base()}/equipment/${item.id}`, guest)).json().record.name).toBe('Updated');
        for (const body of [{ name: '' }, { name: 'Bad', warrantyExpiry: '2025-02-29' }, { name: 'Bad', location: '\u202E' }, { name: 'Bad', notify: true }])
            expect((await t.post(`${base()}/equipment`, body, user)).statusCode).toBe(400);
        t.database.sqlite.exec("CREATE TRIGGER equipment_test_audit_fail BEFORE INSERT ON audit_events WHEN NEW.type='EQUIPMENT_CREATED' BEGIN SELECT RAISE(ABORT,'test'); END");
        const before = t.database.sqlite.prepare('SELECT * FROM equipment_records').all();
        expect((await t.post(base() + '/equipment', { name: 'Rolled back' }, user)).statusCode).toBe(500);
        expect(t.database.sqlite.prepare('SELECT * FROM equipment_records').all()).toEqual(before);
        t.database.sqlite.exec('DROP TRIGGER equipment_test_audit_fail');
    });
    it('searches literal terms, filters only this Workspace, paginates and excludes Trash', async () => {
        await t.post(base() + '/equipment', { name: 'Percent % _', category: 'Other', location: 'Kitchen' }, user);
        expect((await t.get(base() + '/equipment?q=%25', guest)).json().records.map((r: {
            name: string;
        }) => r.name)).toEqual(['Percent % _']);
        expect((await t.get(base() + '/equipment?manufacturer=Muller', guest)).json().records.map((r: {
            name: string;
        }) => r.name)).toEqual(['Boiler']);
        expect((await t.get(base() + '/equipment?location=Cellar&category=Heating', guest)).json().records).toHaveLength(1);
        const their = await add('Their equipment', other);
        expect((await t.get(base() + '/equipment?q=Their', guest)).json().records).toEqual([]);
        expect(JSON.stringify((await t.get(base() + '/equipment/filters', guest)).json())).not.toContain(their.id);
        for (let index = 0; index < 51; index++)
            await add(`Page ${String(index).padStart(2, '0')}`);
        const first = (await t.get(base() + '/equipment?q=Page', guest)).json();
        expect(first.records).toHaveLength(50);
        expect(first.total).toBe(51);
        const second = (await t.get(base() + `/equipment?q=Page&cursor=${first.nextCursor}`, guest)).json();
        expect(second.records).toHaveLength(1);
        expect(second.records[0].id).not.toBe(first.records[49].id);
        expect((await t.get(base() + '/equipment?cursor=abc', guest)).statusCode).toBe(400);
    });
    it('links Contacts and chronological Maintenance, never names deleted Contacts, enforces both ends and foreign ids', async () => {
        await t.post(base() + '/tools', { tool: 'CONTACTS', enabled: true }, t.admin);
        await t.post(base() + '/tools', { tool: 'MAINTENANCE', enabled: true }, t.admin);
        const equipment = await add('Linked boiler');
        const contact = (await t.post(base() + '/contacts', { name: 'Private technician' }, user)).json().contact;
        const link = (await t.post(`${base()}/equipment/${equipment.id}/links`, { target: { type: 'contact', id: contact.id } }, user)).json().link;
        expect(link.record.title).toBe('Private technician');
        const records = [];
        for (const [title, date] of [['Later service', '2026-10-02'], ['Earlier service', '2025-10-02']]) {
            const maintenance = (await t.post(base() + '/maintenance', { title, date }, user)).json().record;
            records.push(maintenance);
            expect((await t.post(`${base()}/equipment/${equipment.id}/links`, { target: { type: 'maintenance', id: maintenance.id } }, user)).statusCode).toBe(201);
        }
        expect((await t.get(`${base()}/maintenance?equipment=${equipment.id}`, guest)).json().records.map((r: {
            title: string;
        }) => r.title)).toEqual(['Later service', 'Earlier service']);
        const maintenanceLink = (await t.get(`${base()}/maintenance/${records[0].id}/links`, guest)).json().links;
        expect(maintenanceLink).toMatchObject([{ record: { type: 'equipment', title: 'Linked boiler' } }]);
        await t.post(`${base()}/contacts/${contact.id}/delete`, {}, user);
        expect(JSON.stringify((await t.get(`${base()}/equipment/${equipment.id}/links`, guest)).json())).not.toContain('Private technician');
        expect(JSON.stringify(t.database.sqlite.prepare("SELECT metadata FROM audit_events WHERE type='EQUIPMENT_LINK_ADDED'").all())).not.toContain('Private technician');
        await t.post(base() + '/contacts/trash/purge', { contactIds: [contact.id] }, t.admin);
        expect((await t.get(`${base()}/equipment/${equipment.id}/links`, guest)).json().links[0].record).toMatchObject({ title: null, state: 'gone' });
        const foreign = await add('Foreign linked', other);
        expect((await t.post(`${base()}/equipment/${foreign.id}/links`, { target: { type: 'maintenance', id: records[0].id } }, user)).statusCode).toBe(404);
        await t.post(base() + '/tools', { tool: 'CONTACTS', enabled: false }, t.admin);
        expect((await t.get(`${base()}/equipment/${equipment.id}/links`, guest)).json().links.every((l: {
            record: {
                type: string;
            };
        }) => l.record.type !== 'contact')).toBe(true);
        const before = t.database.sqlite.prepare('SELECT * FROM links').all();
        expect((await t.post(`${base()}/equipment-links/${link.id}/delete`, {}, user)).statusCode).toBe(404);
        expect((await t.post(`${base()}/maintenance-links/${link.id}/delete`, {}, user)).statusCode).toBe(404);
        expect(t.database.sqlite.prepare('SELECT * FROM links').all()).toEqual(before);
    });
    it('warranty metadata and Trash never create/change schedules; restores, purge and tool disable preserve other records', async () => {
        const item = await add('Warranty');
        const schedules = t.database.sqlite.prepare('SELECT * FROM schedules').all();
        await t.post(`${base()}/equipment/${item.id}/update`, { name: 'Warranty', warrantyExpiry: '2028-01-31', expectedRevision: 1 }, user);
        expect(t.database.sqlite.prepare('SELECT * FROM schedules').all()).toEqual(schedules);
        await t.post(`${base()}/equipment/${item.id}/delete`, {}, user);
        expect((await t.get(`${base()}/equipment/${item.id}`, guest)).statusCode).toBe(404);
        expect((await t.post(base() + '/equipment/trash/purge', { recordIds: [item.id] }, user)).statusCode).toBe(403);
        expect((await t.post(`${base()}/equipment/${item.id}/restore`, {}, editor)).statusCode).toBe(200);
        const before = t.database.sqlite.prepare('SELECT * FROM equipment_records').all();
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: false }, t.admin);
        expect((await t.get(base() + '/equipment', guest)).statusCode).toBe(404);
        expect(t.database.sqlite.prepare('SELECT * FROM equipment_records').all()).toEqual(before);
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: true }, t.admin);
        await t.post(`${base()}/equipment/${item.id}/delete`, {}, user);
        expect((await t.post(base() + '/equipment/trash/purge', { recordIds: [item.id] }, t.admin)).json().purged).toBe(1);
        expect(t.database.sqlite.prepare('SELECT * FROM schedules').all()).toEqual(schedules);
    });
    it('links existing manuals and receipts without copying files; purging Equipment preserves both originals', async () => {
        await t.post(base() + '/tools', { tool: 'DOCUMENTS', enabled: true }, t.admin);
        const equipment = await add('Manuals boiler');
        const original = readFileSync('packages/media/src/fixtures/three-pages.pdf');
        const documentIds = [];
        for (const title of ['Boiler manual', 'Boiler receipt']) {
            const upload = await t.app.inject({ method: 'POST', url: base() + '/document-files', headers: { cookie: user, origin: ORIGIN, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(title + '.pdf') }, payload: original });
            expect(upload.statusCode).toBe(201);
            const document = (await t.post(base() + '/documents', { title, folderId: null, fileIds: [upload.json().file.id] }, user)).json().document;
            documentIds.push(document.id);
            expect((await t.post(`${base()}/equipment/${equipment.id}/links`, { target: { type: 'document', id: document.id } }, user)).statusCode).toBe(201);
            expect((await t.get(`${base()}/documents/${document.id}/links`, guest)).json().links).toMatchObject([{ record: { type: 'equipment', title: 'Manuals boiler' } }]);
        }
        const files = t.database.sqlite.prepare('SELECT * FROM document_files').all();
        await t.post(`${base()}/equipment/${equipment.id}/delete`, {}, user);
        await t.post(base() + '/equipment/trash/purge', { recordIds: [equipment.id] }, t.admin);
        expect(t.database.sqlite.prepare('SELECT * FROM document_files').all()).toEqual(files);
        for (const id of documentIds)
            expect((await t.get(`${base()}/documents/${id}`, guest)).statusCode).toBe(200);
    });
    it('warranty reminders are ordinary Schedules and remain unchanged by warranty edits or disabling Equipment', async () => {
        const equipment = await add('Scheduled boiler');
        const created = await t.post(base() + '/schedules', { title: 'Warranty ends: Scheduled boiler', date: '2028-01-31', timeZone: 'UTC', recurrence: { kind: 'ONCE' }, reminders: [{ unit: 'MONTHS', amount: 1 }] }, user);
        expect(created.statusCode).toBe(201);
        const schedule = created.json().schedule;
        expect((await t.post(`${base()}/equipment/${equipment.id}/links`, { target: { type: 'schedule', id: schedule.id } }, user)).statusCode).toBe(201);
        const before = t.database.sqlite.prepare('SELECT * FROM schedules WHERE id=?').get(schedule.id);
        await t.post(`${base()}/equipment/${equipment.id}/update`, { name: 'Scheduled boiler', serialNumber: 'SENSITIVE-SERIAL', warrantyExpiry: '2029-03-01', expectedRevision: 1 }, user);
        expect(t.database.sqlite.prepare('SELECT * FROM schedules WHERE id=?').get(schedule.id)).toEqual(before);
        await t.post(base() + '/tools', { tool: 'REMINDERS', enabled: false }, t.admin);
        expect((await t.get(`${base()}/equipment/${equipment.id}/links`, guest)).json().links).toEqual([]);
        await t.post(base() + '/tools', { tool: 'REMINDERS', enabled: true }, t.admin);
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: false }, t.admin);
        expect((await t.get(`${base()}/schedules/${schedule.id}`, guest)).statusCode).toBe(200);
        expect(t.database.sqlite.prepare('SELECT * FROM schedules WHERE id=?').get(schedule.id)).toEqual(before);
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: true }, t.admin);
    });
    it('database integrity forbids foreign link targets, identity rewrites and purging live Equipment', async () => {
        const item = await add('Integrity');
        await t.post(base(other) + '/tools', { tool: 'MAINTENANCE', enabled: true }, t.admin);
        const foreign = (await t.post(base(other) + '/maintenance', { title: 'Foreign work' }, t.admin)).json().record;
        const actor = t.database.sqlite.prepare("SELECT id FROM users WHERE email='equipment-user@example.org'").get() as {
            id: string;
        };
        expect(() => t.database.sqlite.prepare('INSERT INTO links(id,workspace_id,from_type,from_id,to_type,to_id,created_by_user_id,created_by_display_name,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), home, 'equipment', item.id, 'maintenance', foreign.id, actor.id, 'Uma', Date.now())).toThrow();
        expect(() => t.database.sqlite.prepare('UPDATE equipment_records SET workspace_id=? WHERE id=?').run(other, item.id)).toThrow();
        expect(() => t.database.sqlite.prepare('DELETE FROM equipment_records WHERE id=?').run(item.id)).toThrow();
        expect((await t.get(`${base()}/equipment/${item.id}`, guest)).statusCode).toBe(200);
    });
    it('rechecks tool and current role inside direct repository writes', async () => {
        const account = t.database.sqlite.prepare("SELECT id, display_name AS name FROM users WHERE email='equipment-user@example.org'").get() as {
            id: string;
            name: string;
        };
        const actor = { kind: 'user' as const, userId: account.id as UserId, displayName: account.name };
        const input = { workspaceId: home as WorkspaceId, content: normalizeEquipmentContent({ name: 'Race' }), at: new Date() };
        const guard = { actorMay: (role: string) => role !== 'GUEST' };
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: false }, t.admin);
        expect(await t.services.equipment.equipment.create(input, actor, guard)).toEqual({ status: 'tool_disabled' });
        await t.post(base() + '/tools', { tool: 'EQUIPMENT', enabled: true }, t.admin);
        await t.post(`${base()}/members/${account.id}/role`, { role: 'GUEST' }, t.admin);
        expect(await t.services.equipment.equipment.create(input, actor, guard)).toEqual({ status: 'forbidden' });
        await t.post(`${base()}/members/${account.id}/role`, { role: 'USER' }, t.admin);
    });
});

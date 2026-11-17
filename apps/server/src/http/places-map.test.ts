import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXPORTED_TABLES } from '@vergissmeinnicht/database';
import { ORIGIN, startTestApp } from './test-harness.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const point = { role: 'trailhead', preferred: true, newPoint: { label: 'Creppo', latitude: 44.00785, longitude: 7.71568, precision: 'exact' } };

describe('Marauder’s Map', () => {
  let app: Awaited<ReturnType<typeof startTestApp>>;
  let workspace: string; let foreign: string; let guest: string; let user: string; let editor: string;
  const base = (id = workspace) => '/api/workspaces/' + id + '/map';
  const tool = (id: string, enabled: boolean) => app.post('/api/workspaces/' + id + '/tools', { tool: 'MAP', enabled }, app.admin);
  const add = (place: object, actor = editor, workspaceId = workspace, operationId = randomUUID()) => app.post(base(workspaceId) + '/places', { place, operationId }, actor);
  const upload = (type: 'cover' | 'visit', cookie: string) => app.app.inject({
    method: 'POST', url: base() + '/' + type + '-upload', payload: PNG,
    headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'photo.png' },
  });
  beforeEach(async () => {
    app = await startTestApp({ captureLogs: true });
    workspace = await app.createWorkspace('Casa');
    foreign = await app.createWorkspace('Van');
    guest = await app.invite('map-guest@example.org', 'Guest');
    user = await app.invite('map-user@example.org', 'User');
    editor = await app.invite('map-editor@example.org', 'Editor');
    await app.addMember(workspace, 'map-guest@example.org', 'GUEST');
    await app.addMember(workspace, 'map-user@example.org', 'USER');
    await app.addMember(workspace, 'map-editor@example.org', 'EDITOR');
    expect((await app.get(base() + '/places', app.admin)).statusCode).toBe(404);
    expect((await tool(workspace, true)).statusCode).toBe(200);
    await tool(foreign, true);
  });
  afterEach(async () => app.close());

  it('isolates shared data, rejects foreign points and keeps data on tool disable', async () => {
    expect((await add({ name: 'Café' }, guest)).statusCode).toBe(403);
    expect((await add({ name: 'Café' }, user)).statusCode).toBe(403);
    const result = await add({ name: 'Gerbontina', details: { locality: 'Creppo' }, points: [point] });
    expect(result.statusCode, result.body).toBe(200);
    const id = result.json().id as string;
    const saved = (await app.get(base() + '/places/' + id, guest)).json();
    const pointId = saved.points[0].id as string;
    const bruzzi = await add({ name: 'Bruzzi', points: [{ pointId, preferred: true, role: 'trailhead' }] });
    expect(bruzzi.statusCode, bruzzi.body).toBe(200);
    expect((await add({ name: 'Wrong Workspace', points: [{ pointId, role: 'trailhead' }] }, app.admin, foreign)).statusCode).toBe(404);
    expect((await app.get(base(foreign) + '/places/' + id, app.admin)).statusCode).toBe(404);
    expect((await app.get(base() + '/places', guest)).json().places).toHaveLength(2);
    expect((await app.post(base() + '/places/' + id + '/update', { place: { name: 'Revised', points: [{ pointId, role: 'trailhead' }] },
      operationId: randomUUID(), expectedRevision: 4, archived: false }, editor)).statusCode).toBe(409);
    await tool(workspace, false);
    expect((await app.get(base() + '/places/' + id, app.admin)).statusCode).toBe(404);
    expect((await add({ name: 'New' }, editor)).statusCode).toBe(404);
    await tool(workspace, true);
    expect((await app.get(base() + '/places/' + id, guest)).json()).toMatchObject({ name: 'Gerbontina', revision: 1 });
  });

  it('keeps unresolved places searchable, checks preview matches and replays imports only once', async () => {
    const operation = randomUUID();
    const place = { name: 'Case Bondazzo', details: { originalUrl: 'https://maps.app.goo.gl/example', locality: 'Bregalla' } };
    const checked = await app.post(base() + '/import-preview', place, editor);
    expect(checked.json()).toMatchObject({ exact: null, possible: [], unresolved: true });
    expect((await app.get(base() + '/places', guest)).json().places).toHaveLength(0);
    const saved = await add(place, editor, workspace, operation);
    const id = saved.json().id as string;
    expect((await add(place, editor, workspace, operation)).json()).toEqual({ id, duplicate: true });
    expect((await add({ name: 'Altered' }, editor, workspace, operation)).statusCode).toBe(409);
    expect((await add(place)).statusCode).toBe(409);
    expect((await app.post(base() + '/import-preview', place, editor)).json().exact).toBe(id);
    expect((await add({ name: 'Script', details: { website: 'javascript:alert(1)' } })).statusCode).toBe(400);
    expect((await add({ name: 'Outside', points: [{ ...point, newPoint: { ...point.newPoint, latitude: 92 } }] })).statusCode).toBe(400);
    const response = await app.get(base() + '/places?search=bregalla', user);
    expect(response.json().places).toMatchObject([{ id, points: [] }]);
    expect((await app.get(base() + '/places?bounds=43,45,7,8', user)).json().places).toEqual([]);
  });

  it('renames linked tags centrally and keeps archived places away from readers', async () => {
    expect((await app.post(base() + '/tags', { name: 'Rainy day' }, editor)).statusCode).toBe(403);
    const tag = (await app.post(base() + '/tags', { name: 'Rainy day' }, app.admin)).json();
    const place = { name: 'Café', tagIds: [tag.id], details: { locality: 'Triora' }, category: 'food' };
    const id = (await add(place)).json().id as string;
    expect((await app.post(base() + '/tags', { name: 'Rainy afternoons', id: tag.id }, app.admin)).statusCode).toBe(200);
    expect((await app.get(base() + '/places?search=afternoons&town=Triora', guest)).json().places).toMatchObject([{ id, tags: [{ name: 'Rainy afternoons' }] }]);
    const update = (revision: number, archived: boolean) => app.post(base() + '/places/' + id + '/update', { place, operationId: randomUUID(), expectedRevision: revision, archived }, editor);
    expect((await update(1, true)).statusCode).toBe(200);
    expect((await app.get(base() + '/places/' + id, guest)).statusCode).toBe(404);
    expect((await app.get(base() + '/places?archived=true', guest)).statusCode).toBe(403);
    expect((await app.get(base() + '/places?archived=true', editor)).json().places).toMatchObject([{ id, archived: true }]);
    expect((await update(2, false)).statusCode).toBe(200);
    expect((await app.get(base() + '/places/' + id, guest)).statusCode).toBe(200);
  });

  it('serves only bound shared covers and keeps private visits and photos owner-only and outside Workspace backups', async () => {
    expect((await upload('cover', user)).statusCode).toBe(403);
    const cover = await upload('cover', editor);
    expect(cover.statusCode, cover.body).toBe(201);
    const coverId = cover.json().attachment.id as string;
    const id = (await add({ name: 'Café', coverId })).json().id as string;
    const place = base() + '/places/' + id;
    const coverPath = place + '/cover-photo/' + coverId + '/preview';
    expect((await app.get(coverPath, guest)).statusCode).toBe(200);
    expect((await app.get(coverPath.replace(workspace, foreign), app.admin)).statusCode).toBe(404);
    expect((await app.get(place + '/personal', guest)).statusCode).toBe(403);
    expect((await app.post(place + '/personal', { favorite: true, want: false }, user)).json().favorite).toBe(true);
    expect((await app.get(base() + '/places?favorite=true', editor)).json().places).toEqual([]);
    expect((await app.get(base() + '/places?favorite=true', guest)).statusCode).toBe(403);
    const photo = await upload('visit', user);
    expect(photo.statusCode, photo.body).toBe(201);
    const photoId = photo.json().attachment.id as string;
    const visitPath = place + '/visit-photo/' + photoId + '/thumbnail';
    expect((await app.get(visitPath, user)).statusCode).toBe(404);
    expect((await app.post(place + '/visits', { photoIds: [photoId] }, app.admin)).statusCode).toBe(404);
    expect((await app.post(place + '/visits', { photoIds: [photoId], note: 'Private note', rating: 5 }, user)).json().visits).toMatchObject([{ date: null, photoIds: [photoId] }]);
    expect((await app.get(visitPath, user)).statusCode).toBe(200);
    expect((await app.get(visitPath, app.admin)).statusCode).toBe(404);
    expect((await app.get(place + '/personal', app.admin)).json().visits).toEqual([]);
    expect((await add({ name: 'Leaked photo', coverId: photoId })).statusCode).toBe(404);
    const spec = EXPORTED_TABLES.find(table => table.name === 'attachments');
    if (!spec) throw new Error('Missing attachment export policy');
    expect(app.database.sqlite.prepare(spec.select).all(workspace)).toMatchObject([{ id: coverId }]);
    expect(EXPORTED_TABLES.map(table => table.name)).not.toContain('map_visits');
    expect(EXPORTED_TABLES.map(table => table.name)).not.toContain('map_visit_photos');
    expect(app.logs).not.toContain(photoId);
  });
});

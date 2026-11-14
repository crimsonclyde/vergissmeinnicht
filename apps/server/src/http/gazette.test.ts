import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { purgeGazette } from '@vergissmeinnicht/database';
import { defaultGazetteSettings, sampleGazetteEdition, type TimeZoneName } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

const DAY = 86_400_000;
const isoDay = (offset = 0) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

describe('Morning Gazette API (43)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>; let workspace: string; let other: string; let editor: string; let user: string; let guest: string;
  const base = (ws = workspace) => `/api/workspaces/${ws}/gazette`;
  const publish = (cookie: string, body: Record<string, unknown>, ws = workspace) => t.post(`${base(ws)}/editions`, body, cookie);
  beforeEach(async () => {
    t = await startTestApp(); workspace = await t.createWorkspace('Casa'); other = await t.createWorkspace('Van');
    editor = await t.invite('editor@example.org', 'Editor'); user = await t.invite('user@example.org', 'User'); guest = await t.invite('guest@example.org', 'Guest');
    await t.addMember(workspace, 'editor@example.org', 'EDITOR'); await t.addMember(workspace, 'user@example.org', 'USER'); await t.addMember(workspace, 'guest@example.org', 'GUEST');
    // UTC keeps "today" identical in the test and on the server.
    const settings = { ...defaultGazetteSettings('UTC' as TimeZoneName) };
    expect((await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'GAZETTE', enabled: true }, t.admin)).statusCode).toBe(200);
    expect((await t.post(`${base()}/settings`, { settings, expectedRevision: 0 }, t.admin)).statusCode).toBe(200);
  });
  afterEach(() => t.close());

  it('keeps the tool switch, membership, Workspace and role boundaries', async () => {
    const operationId = randomUUID();
    expect((await t.get(`${base(other)}/today`, t.admin)).statusCode).toBe(404);
    expect((await publish(guest, { operationId, content: sampleGazetteEdition(isoDay()), publish: true })).statusCode).toBe(403);
    expect((await publish(user, { operationId, content: sampleGazetteEdition(isoDay()), publish: true })).statusCode).toBe(403);
    expect((await t.post(`${base()}/settings`, { settings: defaultGazetteSettings('UTC' as TimeZoneName), expectedRevision: 1 }, editor)).statusCode).toBe(403);
    const created = await publish(editor, { operationId, content: sampleGazetteEdition(isoDay()), publish: true });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().edition.id;
    expect((await t.get(`${base()}/editions/${isoDay()}`, guest)).json().edition.content.sections).toHaveLength(6);
    // Another Workspace never sees it, not even by id.
    await t.post(`/api/workspaces/${other}/tools`, { tool: 'GAZETTE', enabled: true }, t.admin);
    expect((await t.get(`${base(other)}/editions/id/${id}`, t.admin)).statusCode).toBe(404);
    expect((await t.get(`${base(other)}/today`, t.admin)).json().preview).toBeNull();
    // Switching the tool off hides everything and deletes nothing.
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'GAZETTE', enabled: false }, t.admin);
    expect((await t.get(`${base()}/today`, guest)).statusCode).toBe(404);
    await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'GAZETTE', enabled: true }, t.admin);
    expect((await t.get(`${base()}/today`, guest)).json().preview.id).toBe(id);
  });

  it('publishes idempotently: a retried operation returns the same edition and a reused id with other content is refused', async () => {
    const operationId = randomUUID(); const content = sampleGazetteEdition(isoDay());
    const first = await publish(editor, { operationId, content, publish: true });
    const again = await publish(editor, { operationId, content, publish: true });
    expect(first.statusCode).toBe(201); expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true, edition: { id: first.json().edition.id, revision: 1 } });
    expect((await t.get(`${base()}/editions`, guest)).json().editions).toHaveLength(1);
    const changed = await publish(editor, { operationId, content: { ...content, greeting: 'Different' }, publish: true });
    expect(changed.statusCode).toBe(409); expect(changed.json().error).toBe('gazette_operation_reused');
    // A new operation replaces today's edition in place: still one published edition for the date.
    const replaced = await publish(editor, { operationId: randomUUID(), content: { ...content, greeting: 'Second run' }, publish: true });
    expect(replaced.json().edition).toMatchObject({ id: first.json().edition.id, revision: 2 });
    expect((await t.get(`${base()}/editions`, guest)).json().editions).toHaveLength(1);
  });

  it('never lets a malformed or incomplete import replace the published edition', async () => {
    const good = await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay()), publish: true });
    const bad = sampleGazetteEdition(isoDay()) as Record<string, unknown>;
    for (const content of [{ ...bad, sections: [] }, { ...bad, sections: [{ sectionId: 'sports', type: 'articles', items: [] }] }, { ...bad, intro: '<img src=x onerror=alert(1)>' }, { ...bad, version: 9 }, 'not an edition']) {
      const response = await publish(editor, { operationId: randomUUID(), content, publish: true });
      expect(response.statusCode, JSON.stringify(content).slice(0, 60)).toBe(400);
    }
    expect((await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay(-30)), publish: true })).json().error).toBe('gazette_date_out_of_range');
    const now = (await t.get(`${base()}/editions/${isoDay()}`, guest)).json().edition;
    expect(now).toMatchObject({ id: good.json().edition.id, revision: 1 });
  });

  it('keeps drafts from readers, publishes a draft atomically and re-checks it against the current sections', async () => {
    const draft = await publish(editor, { content: sampleGazetteEdition(isoDay()), publish: false });
    expect(draft.statusCode).toBe(201);
    const { id, revision } = draft.json().edition;
    expect((await t.get(`${base()}/today`, guest)).json().preview).toBeNull();
    expect((await t.get(`${base()}/editions/${isoDay()}?state=draft`, guest)).statusCode).toBe(403);
    expect((await t.get(`${base()}/editions/id/${id}`, guest)).statusCode).toBe(404);
    expect((await t.get(`${base()}/editions`, guest)).json().editions).toEqual([]);
    expect((await t.get(`${base()}/editions`, editor)).json().editions).toHaveLength(1);
    // A stale hand edit is refused.
    expect((await publish(editor, { content: sampleGazetteEdition(isoDay()), publish: false, expectedRevision: 0 })).statusCode).toBe(409);
    const published = await t.post(`${base()}/editions/id/${id}/publish`, { expectedRevision: revision }, editor);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().edition).toMatchObject({ id, state: 'PUBLISHED', revision: revision + 1 });
    // Retrying the publish is harmless.
    expect((await t.post(`${base()}/editions/id/${id}/publish`, { expectedRevision: revision + 1 }, editor)).statusCode).toBe(200);
    expect((await t.get(`${base()}/today`, guest)).json().preview).toMatchObject({ id, isToday: true });

    // A draft that names a section removed meanwhile cannot be published.
    const second = (await publish(editor, { content: sampleGazetteEdition(isoDay()), publish: false })).json().edition;
    const stored = (await t.get(`${base()}/settings`, t.admin)).json();
    await t.post(`${base()}/settings`, { settings: { ...stored.settings, sections: stored.settings.sections.filter((s: { id: string }) => s.id !== 'good-news') }, expectedRevision: stored.revision }, t.admin);
    const refused = await t.post(`${base()}/editions/id/${second.id}/publish`, { expectedRevision: second.revision }, editor);
    expect(refused.statusCode).toBe(400); expect(refused.json().error).toBe('gazette_unknown_section');
    expect((await t.get(`${base()}/today`, guest)).json().preview.id).toBe(id);
    expect((await t.post(`${base()}/editions/id/${second.id}/delete`, {}, editor)).statusCode).toBe(204);
    expect((await t.post(`${base()}/editions/id/${id}/delete`, {}, editor)).statusCode).toBe(404);
  });

  it('shows an older edition with its real date, never as today', async () => {
    await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay(-1)), publish: true });
    const preview = (await t.get(`${base()}/today`, guest)).json();
    expect(preview).toMatchObject({ today: isoDay(), preview: { date: isoDay(-1), isToday: false, greeting: '', weather: [] } });
    expect(preview.preview.headlines.length).toBeGreaterThan(0);
  });

  it('removes editions past the retention, keeps the newest published one and never touches other data', async () => {
    const insert = (date: string, state: 'PUBLISHED' | 'DRAFT') => {
      const content = JSON.stringify({ ...sampleGazetteEdition(date), sections: [{ sectionId: 'europe-world', type: 'articles', summary: '', items: [] }] });
      const adminId = (t.database.sqlite.prepare('SELECT user_id FROM memberships WHERE workspace_id = ? AND role = ?').get(workspace, 'ADMIN') as { user_id: string }).user_id;
      t.database.sqlite.prepare('INSERT INTO gazette_editions (id, workspace_id, edition_date, state, content, revision, published_at, created_at, created_by_user_id, updated_at, updated_by_user_id, updated_by) VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, 0, ?, ?)')
        .run(randomUUID(), workspace, date, state, content, state === 'PUBLISHED' ? 1 : null, adminId, adminId, 'Admin');
    };
    const dates = () => (t.database.sqlite.prepare('SELECT edition_date || \':\' || state AS d FROM gazette_editions WHERE workspace_id = ? ORDER BY edition_date').all(workspace) as { d: string }[]).map(r => r.d);
    for (const offset of [-20, -9, -8, -7, -6]) insert(isoDay(offset), 'PUBLISHED');
    insert(isoDay(-10), 'DRAFT');
    expect(purgeGazette(t.database).editions).toBe(5);
    // Seven days including today: today-6 stays; today-7 and older go.
    expect(dates()).toEqual([`${isoDay(-6)}:PUBLISHED`]);

    // When nothing recent exists, the newest published edition survives so the Dashboard is not empty.
    t.database.sqlite.prepare('DELETE FROM gazette_editions').run();
    insert(isoDay(-15), 'PUBLISHED'); insert(isoDay(-12), 'PUBLISHED');
    purgeGazette(t.database);
    expect(dates()).toEqual([`${isoDay(-12)}:PUBLISHED`]);

    // A shorter retention takes effect at the next run.
    const stored = (await t.get(`${base()}/settings`, t.admin)).json();
    expect((await t.post(`${base()}/settings`, { settings: { ...stored.settings, retentionDays: 2 }, expectedRevision: stored.revision }, t.admin)).statusCode).toBe(200);
    await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay()), publish: true });
    await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay(-1)), publish: true });
    purgeGazette(t.database);
    expect(dates()).toEqual([`${isoDay(-1)}:PUBLISHED`, `${isoDay()}:PUBLISHED`]);
    // Settings are never part of the retention.
    expect((await t.get(`${base()}/settings`, guest)).json().settings.retentionDays).toBe(2);
  });

  it('validates settings, refuses stale revisions and records security events without content', async () => {
    const stored = (await t.get(`${base()}/settings`, guest)).json();
    expect(stored).toMatchObject({ revision: 1, settings: { retentionDays: 7, timeZone: 'UTC' } });
    expect((await t.post(`${base()}/settings`, { settings: stored.settings, expectedRevision: 0 }, t.admin)).statusCode).toBe(409);
    const bad = await t.post(`${base()}/settings`, { settings: { ...stored.settings, sections: [{ id: 'Bad Id', type: 'articles', title: 'x' }] }, expectedRevision: 1 }, t.admin);
    expect(bad.statusCode).toBe(400); expect(bad.json()).toEqual({ error: 'gazette_invalid_id', field: 'settings.sections[0].id' });
    await publish(editor, { operationId: randomUUID(), content: sampleGazetteEdition(isoDay()), publish: true });
    const events = t.database.sqlite.prepare("SELECT type, metadata FROM security_events WHERE type LIKE 'GAZETTE_%'").all() as { type: string; metadata: string }[];
    expect(events.map(e => e.type).sort()).toEqual(['GAZETTE_EDITION_CHANGED', 'GAZETTE_SETTINGS_CHANGED']);
    expect(events.map(e => e.metadata).join(' ')).not.toContain('Sample');
  });

  it('keeps a persistent watchlist apart from editions: roles, Workspace, revisions, prices and retention', async () => {
    const item = { name: 'Burr grinder', variant: 'Black', condition: 'new', market: 'IT', currency: 'EUR', target: 160, typical: 189, url: 'https://example.org/grinder' };
    expect((await t.post(`${base()}/watchlist`, { item }, user)).statusCode).toBe(403);
    expect((await t.post(`${base()}/watchlist`, { item: { ...item, url: 'http://example.org' } }, editor)).statusCode).toBe(400);
    const created = await t.post(`${base()}/watchlist`, { item }, editor);
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().item.id;
    expect((await t.get(`${base()}/watchlist`, guest)).json().items).toMatchObject([{ id, name: 'Burr grinder', latest: null, active: true }]);
    // Another Workspace can neither read nor price it.
    await t.post(`/api/workspaces/${other}/tools`, { tool: 'GAZETTE', enabled: true }, t.admin);
    expect((await t.get(`${base(other)}/watchlist`, t.admin)).json().items).toEqual([]);
    expect((await t.post(`${base(other)}/watchlist/prices`, { observations: [{ itemId: id, price: 1, checkedAt: new Date().toISOString() }] }, t.admin)).statusCode).toBe(404);
    // A price needs the time it was checked; a batch with an unknown item stores nothing.
    expect((await t.post(`${base()}/watchlist/prices`, { observations: [{ itemId: id, price: 150 }] }, editor)).statusCode).toBe(400);
    expect((await t.post(`${base()}/watchlist/prices`, { observations: [{ itemId: id, price: 150, checkedAt: new Date().toISOString() }, { itemId: randomUUID(), price: 1, checkedAt: new Date().toISOString() }] }, editor)).statusCode).toBe(404);
    const recorded = await t.post(`${base()}/watchlist/prices`, { observations: [{ itemId: id, price: 159, verified: true, checkedAt: new Date(Date.now() - DAY).toISOString(), source: 'Example Shop' }, { itemId: id, price: 149, verified: true, checkedAt: new Date().toISOString(), source: 'Example Shop' }] }, editor);
    expect(recorded.json()).toEqual({ recorded: 2 });
    const [read] = (await t.get(`${base()}/watchlist`, guest)).json().items;
    expect(read.latest).toMatchObject({ price: 149, verified: true, source: 'Example Shop' });
    expect(read.history.map((entry: { price: number }) => entry.price)).toEqual([159, 149]);
    // Stale revisions are refused; archiving keeps the history.
    expect((await t.post(`${base()}/watchlist/${id}`, { item: { ...item, active: false }, expectedRevision: 9 }, editor)).statusCode).toBe(409);
    const archived = await t.post(`${base()}/watchlist/${id}`, { item: { ...item, active: false }, expectedRevision: 1 }, editor);
    expect(archived.json().item).toMatchObject({ active: false, revision: 2, latest: { price: 149 } });
    // Gazette retention never touches the watchlist.
    purgeGazette(t.database, new Date(Date.now() + 60 * DAY));
    expect((await t.get(`${base()}/watchlist`, guest)).json().items[0].history).toHaveLength(2);
  });
});

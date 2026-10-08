import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const LAYOUT = {
  version: 1,
  density: 'COMFORTABLE',
  cards: [
    { id: 'recent', visible: true, size: 'WIDE', options: { retention: 'DAYS_7' } },
    { id: 'toBuy', visible: false, options: { lists: 5 } },
    { id: 'progress', visible: true },
    { id: 'clock', visible: true, options: { hour24: true } },
  ],
};

describe('Today layout API (19.2)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  beforeEach(async () => {
    t = await startTestApp();
    bob = await t.invite('bob@example.org', 'Bob');
  });
  afterEach(() => t.close());

  it('keeps one layout per person, readable only by that person, and resets to the defaults', async () => {
    expect((await t.get('/api/account/today', bob)).json()).toEqual({ layout: null });
    const saved = (await t.post('/api/account/today', { layout: LAYOUT }, bob)).json();
    expect(saved.layout.cards[1]).toEqual({ id: 'toBuy', visible: false, size: 'NORMAL', options: { lists: 5 } });
    expect((await t.get('/api/account/today', bob)).json()).toEqual(saved);
    // Another account sees only its own (none), and cannot name someone else's.
    expect((await t.get('/api/account/today', t.admin)).json()).toEqual({ layout: null });
    expect((await t.post('/api/account/today', { layout: LAYOUT, userId: 'someone' }, t.admin)).statusCode).toBe(400);
    expect((await t.post('/api/account/today', { layout: null }, bob)).json()).toEqual({ layout: null });
    expect((await t.get('/api/account/today', bob)).json()).toEqual({ layout: null });
  });

  it('refuses unknown fields, unknown or repeated cards and invalid options — and stores nothing then', async () => {
    const card = (extra: object) => ({ ...LAYOUT, cards: [{ id: 'recent', visible: true, ...extra }] });
    for (const layout of [
      {},
      { ...LAYOUT, version: 2 },
      { ...LAYOUT, density: 'TINY' },
      { ...LAYOUT, extra: true },
      { ...LAYOUT, cards: [{ id: 'weather-of-mars', visible: true }] },
      { ...LAYOUT, cards: [{ id: 'recent', visible: true }, { id: 'recent', visible: false }] },
      { ...LAYOUT, cards: Array.from({ length: 30 }, () => ({ id: 'recent', visible: true })) },
      card({ visible: 'yes' }),
      card({ size: 'HUGE' }),
      card({ options: { retention: 'FOREVER' } }),
      card({ options: { lists: 3 } }),
      card({ note: '<script>' }),
      { ...LAYOUT, cards: [{ id: 'toBuy', visible: true, options: { lists: 11 } }] },
      { ...LAYOUT, cards: [{ id: 'toBuy', visible: true, options: { lists: 1.5 } }] },
      { ...LAYOUT, cards: [{ id: 'progress', visible: true, options: { anything: 1 } }] },
      { ...LAYOUT, cards: [{ id: 'clock', visible: true, options: { hour24: 'yes' } }] },
      { ...LAYOUT, cards: [{ id: 'clock', visible: true, options: { seconds: true } }] },
      'layout',
      [],
    ]) {
      expect({ layout, status: (await t.post('/api/account/today', { layout }, bob)).statusCode }).toEqual({ layout, status: 400 });
    }
    expect((await t.post('/api/account/today', {}, bob)).statusCode).toBe(400);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM user_today_layouts').get()).toEqual({ n: 0 });
  });

  it('requires a session and a same-origin request', async () => {
    expect((await t.get('/api/account/today')).statusCode).toBe(401);
    expect((await t.post('/api/account/today', { layout: LAYOUT })).statusCode).toBe(401);
    expect((await t.post('/api/account/today', { layout: LAYOUT }, bob, null)).statusCode).toBe(403);
    expect(t.database.sqlite.prepare('SELECT count(*) AS n FROM user_today_layouts').get()).toEqual({ n: 0 });
  });

  it('returns a layout saved by an earlier version as it is, for the client to merge', async () => {
    const userId = (t.database.sqlite.prepare("SELECT id FROM users WHERE email = 'bob@example.org'").get() as { id: string }).id;
    const old = { version: 1, density: 'COMPACT', cards: [{ id: 'retired-card', visible: true }] };
    t.database.sqlite.prepare('INSERT INTO user_today_layouts (user_id, layout, version, updated_at) VALUES (?, ?, 1, 0)').run(userId, JSON.stringify(old));
    expect((await t.get('/api/account/today', bob)).json()).toEqual({ layout: old });
  });
});

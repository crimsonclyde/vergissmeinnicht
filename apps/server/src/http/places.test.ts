import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLACE_PREFERENCES } from '@vergissmeinnicht/domain';
import { startTestApp } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const base = (workspaceId: string) => `/api/account/places/${workspaceId}`;

/** A 3000×2000 JPEG with camera EXIF, GPS and orientation 6 — none of it may survive. */
function photo(shade = 7): Promise<Buffer> {
  // A smooth gradient (like a sky): compresses well, so it keeps its full size.
  const width = 3000;
  const height = 2000;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * shade) >> 6;
      raw[i + 1] = y >> 3;
      raw[i + 2] = 128;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 70 })
    .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone', ImageDescription: 'secret-note' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '7/1 41/1 36/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

const custom = { ...DEFAULT_PLACE_PREFERENCES, background: 'photo', focusDesktop: { x: 20, y: 70 }, focusMobile: { x: 60, y: 40 }, overlay: 50, blur: 4, vignette: 10, atmosphere: false };

describe('Places personal settings (section 30)', { timeout: 30_000 }, () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let carol: string;
  let guest: string;
  let home: string;
  let office: string;
  const idOf = (email: string) => (t.database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
  const count = (table: string) => (t.database.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  const upload = (workspaceId: string, body: Buffer | string, cookie: string | undefined, options: { origin?: string | null; type?: string } = {}) =>
    t.app.inject({
      method: 'POST',
      url: `${base(workspaceId)}/background`,
      headers: {
        'content-type': options.type ?? 'application/octet-stream',
        ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
        ...(cookie === undefined ? {} : { cookie }),
      },
      payload: body,
    });

  beforeEach(async () => {
    t = await startTestApp();
    bob = await t.invite('bob@example.org', 'Bob');
    carol = await t.invite('carol@example.org', 'Carol');
    guest = await t.invite('gus@example.org', 'Gus');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'bob@example.org', 'USER');
    await t.addMember(office, 'bob@example.org', 'USER');
    await t.addMember(home, 'carol@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
  });
  afterEach(() => t.close());

  it('starts at the defaults and keeps settings per person and per Workspace', async () => {
    expect((await t.get(base(home), bob)).json()).toEqual({ places: { preferences: DEFAULT_PLACE_PREFERENCES, photo: null } });
    const saved = await t.post(base(home), { preferences: custom }, bob);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().places.preferences).toEqual(custom);
    // Office and Carol are untouched.
    expect((await t.get(base(office), bob)).json().places.preferences).toEqual(DEFAULT_PLACE_PREFERENCES);
    expect((await t.get(base(home), carol)).json().places.preferences).toEqual(DEFAULT_PLACE_PREFERENCES);
    // A GUEST may shape their own view too.
    expect((await t.post(base(home), { preferences: { ...custom, background: 'none' } }, guest)).statusCode).toBe(200);
    expect((await t.get(base(home), bob)).json().places.preferences).toEqual(custom);
  });

  it('never changes the Workspace theme and survives switching to another theme and back', async () => {
    await t.post('/api/account/workspace-preferences/theme', { workspaceId: home, theme: 'places-it' }, bob);
    await t.post(base(home), { preferences: custom }, bob);
    expect((await t.get('/api/account/workspace-preferences', bob)).json().workspacePreferences.themes[home]).toBe('places-it');
    await t.post('/api/account/workspace-preferences/theme', { workspaceId: home, theme: 'witch-forest' }, bob);
    await t.post('/api/account/workspace-preferences/theme', { workspaceId: home, theme: 'places-scotland' }, bob);
    expect((await t.get(base(home), bob)).json().places.preferences).toEqual(custom);
    // Carol's theme for the same Workspace is her own.
    expect((await t.get('/api/account/workspace-preferences', carol)).json().workspacePreferences.themes[home]).toBeUndefined();
  });

  it('validates strictly and keeps the previous settings on a refusal', async () => {
    await t.post(base(home), { preferences: custom }, bob);
    for (const preferences of [
      { ...custom, overlay: 0 }, // below the readability floor
      { ...custom, overlay: 99 },
      { ...custom, blur: 40 },
      { ...custom, vignette: -1 },
      { ...custom, overlay: 33.5 },
      { ...custom, background: 'video' },
      { ...custom, focusDesktop: { x: 101, y: 0 } },
      { ...custom, focusDesktop: { x: 1, y: 2, z: 3 } },
      { ...custom, version: 2 },
      { ...custom, country: 'fr' }, // the country is never a personal setting
      'illustration',
      null,
    ]) {
      expect((await t.post(base(home), { preferences }, bob)).statusCode).toBe(400);
    }
    expect((await t.post(base(home), {}, bob)).statusCode).toBe(400);
    expect((await t.post(base(home), { preferences: custom, userId: idOf('carol@example.org') }, bob)).statusCode).toBe(400);
    expect((await t.get(base(home), bob)).json().places.preferences).toEqual(custom);
    expect(() => t.database.sqlite.prepare("UPDATE user_place_preferences SET settings = 'not json'").run()).toThrow(/CHECK constraint failed/);
    expect(() => t.database.sqlite.prepare("UPDATE user_place_preferences SET settings = '[1]'").run()).toThrow(/CHECK constraint failed/);
  });

  it('stores only a re-encoded JPEG without metadata, served only to its owner', async () => {
    const response = await upload(home, await photo(), bob);
    expect(response.statusCode).toBe(200);
    const places = response.json().places;
    expect(places.photo).toEqual({ version: expect.stringMatching(/^\d+$/), width: 1600, height: 2400 });
    // Uploading never switches the background by itself: that is the person's saved choice.
    expect(places.preferences.background).toBe('illustration');

    const served = await t.get(`${base(home)}/background?v=${places.photo.version}`, bob);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toContain('no-store');
    const metadata = await sharp(served.rawPayload).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 1600, height: 2400 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(served.rawPayload.includes(Buffer.from('secret-note'))).toBe(false);
    expect(served.rawPayload.byteLength).toBeLessThanOrEqual(700_000);

    // Nobody else: not another member, not the Workspace admin, not Bob in another Workspace.
    expect((await t.get(`${base(home)}/background`, carol)).statusCode).toBe(404);
    expect((await t.get(`${base(home)}/background`, t.admin)).statusCode).toBe(404);
    expect((await t.get(`${base(office)}/background`, bob)).statusCode).toBe(404);
    expect((await t.get(base(home), carol)).json().places.photo).toBeNull();
    // Personal: not counted in the Workspace's storage.
    expect(count('user_place_backgrounds')).toBe(1);
  });

  it('refuses what is not a supported image and keeps the old photo', async () => {
    await upload(home, await photo(), bob);
    const before = (await t.get(`${base(home)}/background`, bob)).rawPayload;
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).gif().toBuffer();
    for (const [body, reason] of [
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'unreadable'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'unreadable'],
      [heic, 'heic_unsupported'],
      [gif, 'unsupported_format'],
      [Buffer.alloc(0), 'unreadable'],
    ] as const) {
      const response = await upload(home, body, bob);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: 'image_rejected', reason });
    }
    expect((await upload(home, Buffer.alloc(10_000_001), bob)).statusCode).toBe(413);
    expect((await t.get(`${base(home)}/background`, bob)).rawPayload.equals(before)).toBe(true);
  });

  it('replaces and removes the photo; Restore defaults clears only this person in this Workspace', async () => {
    const first = (await upload(home, await photo(), bob)).json().places.photo.version as string;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await upload(home, await photo(11), bob)).json().places.photo.version as string;
    expect(second).not.toBe(first);
    expect(count('user_place_backgrounds')).toBe(1);
    expect((await t.post(`${base(home)}/background/delete`, {}, bob)).json().places.photo).toBeNull();
    expect((await t.get(`${base(home)}/background`, bob)).statusCode).toBe(404);

    await upload(home, await photo(), bob);
    await t.post(base(home), { preferences: custom }, bob);
    await t.post(base(office), { preferences: custom }, bob);
    await t.post(base(home), { preferences: custom }, carol);
    await t.post('/api/account/workspace-preferences/theme', { workspaceId: home, theme: 'places-de' }, bob);
    const reset = await t.post(`${base(home)}/reset`, {}, bob);
    expect(reset.json()).toEqual({ places: { preferences: DEFAULT_PLACE_PREFERENCES, photo: null } });
    expect(count('user_place_backgrounds')).toBe(0);
    expect((await t.get(base(office), bob)).json().places.preferences).toEqual(custom);
    expect((await t.get(base(home), carol)).json().places.preferences).toEqual(custom);
    expect((await t.get('/api/account/workspace-preferences', bob)).json().workspacePreferences.themes[home]).toBe('places-de');
  });

  it('answers foreign, unknown and left Workspaces as unknown, and forgets a removed member', async () => {
    const stranger = await t.createWorkspace('Stranger');
    for (const id of [stranger, '00000000-0000-4000-8000-000000000000']) {
      expect((await t.get(base(id), bob)).statusCode).toBe(404);
      expect((await t.post(base(id), { preferences: custom }, bob)).statusCode).toBe(404);
      expect((await upload(id, await photo(), bob)).statusCode).toBe(404);
    }
    expect((await t.get(base('not-a-uuid'), bob)).statusCode).toBe(400);
    expect((await t.get(base(home.toUpperCase()), bob)).statusCode).toBe(400);

    await t.post(base(home), { preferences: custom }, bob);
    await upload(home, await photo(), bob);
    const removed = await t.post(`/api/workspaces/${home}/members/${idOf('bob@example.org')}/remove`, {}, t.admin);
    expect(removed.statusCode).toBeLessThan(300);
    expect(count('user_place_preferences')).toBe(0);
    expect(count('user_place_backgrounds')).toBe(0);
    expect((await t.get(base(home), bob)).statusCode).toBe(404);
  });

  it('refuses a disabled account inside the transaction', async () => {
    t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE email = 'bob@example.org'").run();
    expect((await t.get(base(home), bob)).statusCode).toBeGreaterThanOrEqual(401);
    expect(count('user_place_preferences')).toBe(0);
  });

  it('needs a session and the Origin, validates strictly, and the database refuses bad rows', async () => {
    const image = await photo();
    expect((await upload(home, image, undefined)).statusCode).toBe(401);
    expect((await upload(home, image, bob, { origin: null })).statusCode).toBe(403);
    expect((await upload(home, image, bob, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await t.get(base(home))).statusCode).toBe(401);
    expect((await t.get(`${base(home)}/background?x=1`, bob)).statusCode).toBe(400);
    expect((await t.get(`${base(home)}/background?v=abc`, bob)).statusCode).toBe(400);
    expect((await t.post(`${base(home)}/reset`, { all: true }, bob)).statusCode).toBe(400);
    expect((await t.post(`${base(home)}/background/delete`, { userId: 'x' }, bob)).statusCode).toBe(400);
    expect((await upload(home, JSON.stringify({ x: 1 }), bob, { type: 'application/json' })).statusCode).toBe(422);
    const sql = t.database.sqlite;
    const bobId = idOf('bob@example.org');
    const insert = sql.prepare('INSERT INTO user_place_backgrounds (user_id, workspace_id, jpeg, width, height, updated_at) VALUES (?, ?, ?, ?, ?, 1)');
    expect(() => insert.run(bobId, home, Buffer.from('<svg/>'), 10, 10)).toThrow(/CHECK constraint failed/);
    expect(() => insert.run(bobId, home, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(700_000)]), 10, 10)).toThrow(/CHECK constraint failed/);
    expect(() => insert.run(bobId, home, Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 5000, 10)).toThrow(/CHECK constraint failed/);
    expect(() => sql.prepare("UPDATE user_workspace_preferences SET theme = 'places-fr'").run()).not.toThrow();
    expect(() => sql.prepare("INSERT INTO user_workspace_preferences (user_id, workspace_id, theme, is_default, updated_at) VALUES (?, ?, 'places-fr', 0, 1)").run(bobId, home)).toThrow(/CHECK constraint failed/);
  });
});

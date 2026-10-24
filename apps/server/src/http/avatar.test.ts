import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const AVATAR = '/api/account/avatar';

/** A 900×600 JPEG with camera EXIF, GPS, a comment and orientation 6 — none of it may survive. */
function photo(): Promise<Buffer> {
  const raw = Buffer.alloc(900 * 600 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 251;
  return sharp(raw, { raw: { width: 900, height: 600, channels: 3 } })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone', ImageDescription: 'secret-note' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '7/1 41/1 36/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('profile pictures (section 29)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let bob: string;
  let carol: string;
  let guest: string;
  let home: string;
  let other: string;
  let bobId: string;
  const idOf = (email: string) => (t.database.sqlite.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
  const rows = () => t.database.sqlite.prepare('SELECT count(*) AS n FROM user_avatars').get();

  const upload = (body: Buffer | string, cookie: string | undefined, options: { origin?: string | null; type?: string } = {}) =>
    t.app.inject({
      method: 'POST',
      url: AVATAR,
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
    other = await t.createWorkspace('Office');
    await t.addMember(home, 'bob@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(other, 'carol@example.org', 'USER');
    bobId = idOf('bob@example.org');
  });
  afterEach(() => t.close());

  it('stores only a re-encoded 256 px square JPEG without any metadata', async () => {
    const response = await upload(await photo(), bob);
    expect(response.statusCode).toBe(200);
    const version = response.json().avatar as string;
    expect(version).toMatch(/^\d+$/);
    expect((await t.get('/api/auth/session', bob)).json().user.avatar).toBe(version);

    const served = await t.get(AVATAR, bob);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toContain('no-store');
    const metadata = await sharp(served.rawPayload).metadata();
    expect(metadata).toMatchObject({ format: 'jpeg', width: 256, height: 256 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.comments).toBeUndefined();
    expect(served.rawPayload.includes(Buffer.from('secret-note'))).toBe(false);
    expect(served.rawPayload.includes(Buffer.from('iPhone'))).toBe(false);
    expect(served.rawPayload.byteLength).toBeLessThanOrEqual(60_000);
  });

  it('refuses what is not a supported image and keeps the old picture', async () => {
    await upload(await photo(), bob);
    const before = (await t.get(AVATAR, bob)).rawPayload;
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#f00' } }).gif().toBuffer();
    for (const [body, reason] of [
      // SVG (scriptable) is never decoded as an image.
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'unreadable'],
      [Buffer.from('not an image at all'), 'unreadable'],
      [heic, 'heic_unsupported'],
      [gif, 'unsupported_format'],
      [Buffer.alloc(0), 'unreadable'],
    ] as const) {
      const response = await upload(body, bob);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({ error: 'image_rejected', reason });
    }
    expect((await t.get(AVATAR, bob)).rawPayload.equals(before)).toBe(true);
  });

  it('shows a picture to members who may see members, and to nobody else', async () => {
    await upload(await photo(), bob);
    const url = `/api/workspaces/${home}/members/${bobId}/avatar`;
    expect((await t.get(url, t.admin)).statusCode).toBe(200);
    const members = (await t.get(`/api/workspaces/${home}/members`, t.admin)).json().members as { userId: string; avatar: string | null }[];
    expect(members.find((member) => member.userId === bobId)?.avatar).toMatch(/^\d+$/);
    expect(members.find((member) => member.userId !== bobId)?.avatar).toBeNull();
    // A GUEST cannot see members; someone of another Workspace cannot see Home at all.
    expect((await t.get(url, guest)).statusCode).toBe(403);
    expect((await t.get(url, carol)).statusCode).toBe(404);
    // Bob is not a member of Office: asking there answers as unknown, even for its admin.
    expect((await t.get(`/api/workspaces/${other}/members/${bobId}/avatar`, t.admin)).statusCode).toBe(404);
    // Removed from Home or disabled: the picture is no longer served to anyone there.
    t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bobId);
    expect((await t.get(url, t.admin)).statusCode).toBe(404);
  });

  it('removes the picture', async () => {
    await upload(await photo(), bob);
    const removed = await t.post(`${AVATAR}/delete`, {}, bob);
    expect(removed.json()).toEqual({ avatar: null });
    expect((await t.get(AVATAR, bob)).statusCode).toBe(404);
    expect((await t.get('/api/auth/session', bob)).json().user.avatar).toBeNull();
    expect(rows()).toEqual({ n: 0 });
  });

  it('needs a session and the Origin, validates strictly, and the database refuses non-JPEG rows', async () => {
    const image = await photo();
    expect((await upload(image, undefined)).statusCode).toBe(401);
    expect((await upload(image, bob, { origin: null })).statusCode).toBe(403);
    expect((await upload(image, bob, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await t.get(AVATAR)).statusCode).toBe(401);
    expect((await t.get(`${AVATAR}?x=1`, bob)).statusCode).toBe(400);
    expect((await t.get(`/api/workspaces/${home}/members/${bobId}/avatar?v=abc`, t.admin)).statusCode).toBe(400);
    expect((await t.post(`${AVATAR}/delete`, { userId: bobId }, bob)).statusCode).toBe(400);
    expect(rows()).toEqual({ n: 0 });
    // A JSON body is not an upload.
    expect((await upload(JSON.stringify({ x: 1 }), bob, { type: 'application/json' })).statusCode).toBe(422);
    const sql = t.database.sqlite;
    expect(() => sql.prepare('INSERT INTO user_avatars (user_id, jpeg, updated_at) VALUES (?, ?, 1)').run(bobId, Buffer.from('<svg/>'))).toThrow(/CHECK constraint failed/);
    expect(() => sql.prepare('INSERT INTO user_avatars (user_id, jpeg, updated_at) VALUES (?, ?, 1)').run(bobId, 'ffd8ff-text')).toThrow(/CHECK constraint failed/);
    expect(() => sql.prepare('INSERT INTO user_avatars (user_id, jpeg, updated_at) VALUES (?, ?, 1)').run(bobId, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(60_000)]))).toThrow(/CHECK constraint failed/);
  });

  it('refuses a disabled account inside the write transaction', async () => {
    t.database.sqlite.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(bobId);
    expect(await t.services.avatars.avatars.save({ userId: bobId as never, jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), at: new Date() })).toBeUndefined();
    expect(rows()).toEqual({ n: 0 });
  });
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
const FIXTURES = join(import.meta.dirname, '../../../../packages/media/src/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** A phone-like JPEG of about `megabytes` MB with EXIF orientation 6 and GPS coordinates (noise does not compress). */
async function phonePhoto(megabytes: number): Promise<Buffer> {
  const width = 4032;
  const height = 3024;
  const raw = Buffer.alloc(width * height * 3);
  let seed = 42;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = seed >> 16;
  }
  const quality = megabytes >= 10 ? 96 : 40;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality })
    .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 4/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '7/1 41/1 36/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('document files over HTTP (16.1)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let user: string;
  let guest: string;
  let outsider: string;

  const upload = (
    workspaceId: string,
    body: Buffer | string | Readable,
    cookie: string | undefined,
    options: { origin?: string | null; type?: string; name?: string | null; query?: string } = {},
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/document-files${options.query ?? ''}`,
      headers: {
        'content-type': options.type ?? 'application/octet-stream',
        ...(options.name === null ? {} : { 'x-file-name': encodeURIComponent(options.name ?? 'Bolletta acqua.pdf') }),
        ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
        ...(cookie === undefined ? {} : { cookie }),
      },
      payload: body,
    });
  const files = (workspaceId = home) => `/api/workspaces/${workspaceId}/document-files`;
  const stored = () => (t.database.sqlite.prepare('SELECT count(*) AS n FROM document_files').get() as { n: number }).n;
  const reason = (response: InjectResponse) => ({ status: response.statusCode, ...(response.json() as { error: string; reason?: string }) });
  const settle = () => t.services.documentFiles.previews.idle();

  beforeAll(async () => {
    t = await startTestApp({ captureLogs: true });
    user = await t.invite('uma@example.org', 'Uma');
    guest = await t.invite('gus@example.org', 'Gus');
    outsider = await t.invite('otto@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'uma@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(office, 'otto@example.org', 'ADMIN');
    for (const workspace of [home, office]) await t.post(`/api/workspaces/${workspace}/tools`, { tool: 'DOCUMENTS', enabled: true }, t.admin);
  }, 60_000);
  afterAll(async () => t.close());

  it('keeps a 12 MB phone photo byte for byte — GPS included — and shows an upright preview without metadata', async () => {
    const photo = await phonePhoto(12);
    expect(photo.length).toBeGreaterThan(11_000_000);
    const response = await upload(home, photo, user, { name: 'IMG_0042.JPG' });
    expect(response.statusCode).toBe(201);
    const { file, usage } = response.json();
    expect(file).toMatchObject({ name: 'IMG_0042.JPG', format: 'JPEG', bytes: photo.length, pageCount: 1, width: 3024, height: 4032, passwordProtected: false, preview: { state: 'READY', pages: 1 }, uploadedBy: 'Uma' });
    expect(usage.usedBytes).toBeGreaterThanOrEqual(photo.length);
    expect(JSON.stringify(response.json())).not.toContain(sha256(photo)); // the storage name never leaves the server

    // A GUEST downloads the original: the same bytes, offered only as a download.
    const original = await t.get(`${files()}/${file.id}/original`, guest);
    expect(original.statusCode).toBe(200);
    expect(sha256(original.rawPayload)).toBe(sha256(photo));
    expect((await sharp(original.rawPayload).metadata()).exif).toBeDefined();
    expect(original.rawPayload.includes('GPS') || original.rawPayload.includes(Buffer.from([0x88, 0x25]))).toBe(true); // the GPS IFD pointer tag
    expect(original.headers['content-type']).toBe('image/jpeg');
    expect(original.headers['content-disposition']).toBe(`attachment; filename="IMG_0042.JPG"; filename*=UTF-8''IMG_0042.JPG`);
    expect(original.headers['x-content-type-options']).toBe('nosniff');
    expect(original.headers['cache-control']).toBe('no-store');
    expect(original.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(Number(original.headers['content-length'])).toBe(photo.length);

    const page = await t.get(`${files()}/${file.id}/pages/1`, guest);
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toBe('image/jpeg');
    expect(page.headers['content-disposition']).toBe('inline; filename="page-1.jpg"');
    const metadata = await sharp(page.rawPayload).metadata();
    expect([metadata.width, metadata.height]).toEqual([1800, 2400]); // upright
    expect(metadata.exif).toBeUndefined();
    expect(page.rawPayload.includes('Apple')).toBe(false);
    const thumbnail = await t.get(`${files()}/${file.id}/thumbnail`, guest);
    expect((await sharp(thumbnail.rawPayload).metadata()).height).toBe(400);
    expect((await t.get(`${files()}/${file.id}/pages/2`, guest)).statusCode).toBe(404);
  }, 60_000);

  it('accepts a 3-page PDF, a PNG and an iPhone HEIC; each downloads identical to its upload', async () => {
    const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#2a6' } }).png().toBuffer();
    for (const [name, bytes, format, type] of [
      ['Bolletta acqua 2026.pdf', fixture('three-pages.pdf'), 'PDF', 'application/pdf'],
      ['Zähler.png', png, 'PNG', 'image/png'],
      ['IMG_0001.HEIC', fixture('photo.heic'), 'HEIC', 'image/heic'],
    ] as const) {
      const response = await upload(home, bytes, user, { name });
      expect({ name, status: response.statusCode }).toEqual({ name, status: 201 });
      const { file } = response.json();
      expect(file).toMatchObject({ name, format, bytes: bytes.length });
      const original = await t.get(`${files()}/${file.id}/original`, guest);
      expect(sha256(original.rawPayload)).toBe(sha256(bytes));
      expect(original.headers['content-type']).toBe(type);
      expect(original.headers['content-disposition']).toMatch(/^attachment; /);
      const page = await t.get(`${files()}/${file.id}/pages/1`, guest);
      if (format === 'HEIC') {
        // Stored and downloadable as HEIC; no preview for this format (no HEVC decoder is shipped, HT1).
        expect(file).toMatchObject({ width: 320, height: 240, preview: { state: 'NONE', pages: 0, unavailable: 'format' } });
        expect(page.statusCode).toBe(404);
        expect((await t.get(`${files()}/${file.id}/thumbnail`, guest)).statusCode).toBe(404);
        continue;
      }
      expect(file.preview.unavailable).toBeNull();
      // The preview is a JPEG — a derived version, never served as the original.
      expect(page.headers['content-type']).toBe('image/jpeg');
      expect((await sharp(page.rawPayload).metadata()).format).toBe('jpeg');
      expect(sha256(page.rawPayload)).not.toBe(sha256(bytes));
    }
    await settle();
    const pdf = (t.database.sqlite.prepare("SELECT id FROM document_files WHERE format = 'PDF'").get() as { id: string }).id;
    expect((await t.get(`${files()}/${pdf}`, guest)).json().file).toMatchObject({ pageCount: 3, preview: { state: 'READY', pages: 3, unavailable: null } });
    for (const page of [1, 2, 3]) expect((await t.get(`${files()}/${pdf}/pages/${page}`, guest)).statusCode).toBe(200);
    expect((await t.get(`${files()}/${pdf}/pages/4`, guest)).statusCode).toBe(404);
    // A HEIC stays as it was after the background work: nothing was queued for it.
    const heic = (t.database.sqlite.prepare("SELECT id FROM document_files WHERE format = 'HEIC'").get() as { id: string }).id;
    expect((await t.get(`${files()}/${heic}`, guest)).json().file.preview).toEqual({ state: 'NONE', pages: 0, unavailable: 'format' });
    // A non-ASCII name is offered with an ASCII fallback and its UTF-8 form.
    const png1 = (t.database.sqlite.prepare("SELECT id FROM document_files WHERE format = 'PNG'").get() as { id: string }).id;
    expect((await t.get(`${files()}/${png1}/original`, guest)).headers['content-disposition']).toBe(`attachment; filename="Z_hler.png"; filename*=UTF-8''Z%C3%A4hler.png`);
  }, 30_000);

  it('stores password-protected and script-carrying PDFs as decided (HT4)', async () => {
    const locked = (await upload(home, fixture('encrypted.pdf'), user, { name: 'statement.pdf' })).json().file;
    expect(locked).toMatchObject({ format: 'PDF', passwordProtected: true, pageCount: null, preview: { state: 'NONE', pages: 0, unavailable: 'password_protected' } });
    expect((await t.get(`${files()}/${locked.id}/pages/1`, guest)).statusCode).toBe(404);
    expect(sha256((await t.get(`${files()}/${locked.id}/original`, guest)).rawPayload)).toBe(sha256(fixture('encrypted.pdf')));
    for (const name of ['javascript.pdf', 'embedded-file.pdf']) {
      const file = (await upload(home, fixture(name), user, { name })).json().file;
      expect(file).toMatchObject({ format: 'PDF', activeContent: true, preview: { pages: 1 } });
      const page = await t.get(`${files()}/${file.id}/pages/1`, guest);
      expect(page.headers['content-type']).toBe('image/jpeg'); // a picture of the page, nothing active
      expect(sha256((await t.get(`${files()}/${file.id}/original`, guest)).rawPayload)).toBe(sha256(fixture(name)));
    }
  });

  it('refuses with a clear reason, and stores nothing', async () => {
    const before = stored();
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#aa3300' } }).jpeg().toBuffer();
    const cases: [string, Buffer, object][] = [
      ['invoice.pdf', Buffer.concat([Buffer.from('MZ\u0090\u0000', 'latin1'), Buffer.alloc(300)]), { status: 422, error: 'file_rejected', reason: 'unsupported_format' }], // .exe renamed to .pdf
      ['photo.jpg', Buffer.concat([jpeg, Buffer.from('<html><script>alert(1)</script></html>')]), { status: 422, error: 'file_rejected', reason: 'suspicious_content' }], // HTML/JPEG polyglot
      ['drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), { status: 422, error: 'file_rejected', reason: 'unsupported_format' }],
      ['archive.zip', Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(100)]), { status: 422, error: 'file_rejected', reason: 'unsupported_format' }],
      ['page.html', Buffer.from('<!doctype html><html></html>'), { status: 422, error: 'file_rejected', reason: 'unsupported_format' }],
      ['broken.pdf', Buffer.from('%PDF-1.7\nnothing of a PDF follows'), { status: 422, error: 'file_rejected', reason: 'unreadable' }],
      ['empty.pdf', Buffer.alloc(0), { status: 422, error: 'file_rejected', reason: 'empty' }],
    ];
    for (const [name, bytes, expected] of cases) expect({ name, ...reason(await upload(home, bytes, user, { name })) }).toEqual({ name, ...expected });
    // A 20 000 × 20 000 px PNG (by its header): refused before anything is decoded.
    const huge = Buffer.from(await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer());
    huge.writeUInt32BE(20_000, 16);
    huge.writeUInt32BE(20_000, 20);
    expect(reason(await upload(home, huge, user, { name: 'huge.png' }))).toMatchObject({ status: 422, reason: expect.stringMatching(/too_many_pixels|unreadable/) });
    // Names are data: control and bidi characters are refused, a missing name too.
    expect(reason(await upload(home, jpeg, user, { name: 'inv‮oice.jpg' }))).toMatchObject({ status: 400, error: 'file_name_invalid_characters' });
    expect(reason(await upload(home, jpeg, user, { name: null }))).toMatchObject({ status: 400, error: 'file_name_empty' });
    expect((await upload(home, jpeg, user, { query: '?name=x.jpg' })).statusCode).toBe(400);
    // Only raw bytes are an upload: form posts and declared types are not parsed, JSON is no file.
    expect((await upload(home, jpeg, user, { type: 'image/jpeg' })).statusCode).toBe(415);
    expect((await upload(home, 'a=b', user, { type: 'application/x-www-form-urlencoded' })).statusCode).toBe(415);
    expect(reason(await upload(home, '{"a":1}', user, { type: 'application/json' }))).toMatchObject({ status: 422, reason: 'empty' });
    expect(stored()).toBe(before);
    expect((await t.get(`${files()}/usage`, guest)).json().usage.usedBytes).toBeGreaterThan(0);
  });

  it('cuts off a file above the limit while receiving it, also after the instance admin lowered the limit', async () => {
    const before = stored();
    // Over a real connection, in 1 MB pieces: 51 MB is refused with its reason although the client is
    // still sending; a far larger body is not read to its end.
    const piece = Buffer.alloc(1_000_000, 0x20);
    piece.write('%PDF-1.7\n');
    const address = await t.app.listen({ host: '127.0.0.1', port: 0 });
    const send = (pieces: number) =>
      new Promise<{ status: number; body: string; sent: number }>((resolve) => {
        let sent = 0;
        const request = httpRequest(`${address}${files()}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'scan.pdf', origin: ORIGIN, cookie: user } });
        request.on('response', (response) => {
          let body = '';
          response.on('data', (chunk) => (body += String(chunk)));
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body, sent }));
        });
        request.on('error', () => resolve({ status: 0, body: '{}', sent })); // the server closed the connection
        const more = () => {
          if (sent >= pieces || request.destroyed) return void request.end();
          sent++;
          request.write(piece, () => more());
        };
        more();
      });
    const tooLarge = await send(51);
    expect({ status: tooLarge.status, ...(JSON.parse(tooLarge.body) as object) }).toEqual({ status: 413, error: 'file_rejected', reason: 'too_large' });
    const farTooLarge = await send(400);
    expect(farTooLarge.sent).toBeLessThan(200); // cut off: the connection is closed instead of reading 400 MB
    expect([0, 413]).toContain(farTooLarge.status);
    // The limit is 20 MB from now on: 25 MB is refused, existing larger files stay readable.
    const big = (t.database.sqlite.prepare('SELECT id, bytes FROM document_files ORDER BY bytes DESC').get() as { id: string; bytes: number });
    expect((await t.post('/api/admin/settings', { documentMaxFileBytes: 20_000_000 }, user)).statusCode).toBe(403);
    expect((await t.post('/api/admin/settings', { documentMaxFileBytes: 500_000 }, t.admin)).statusCode).toBe(400);
    expect((await t.post('/api/admin/settings', { documentFormats: ['PDF', 'EXE'] }, t.admin)).statusCode).toBe(400);
    const changed = await t.post('/api/admin/settings', { documentMaxFileBytes: 11_000_000 }, t.admin);
    expect(changed.json().settings).toMatchObject({ documentMaxFileBytes: 11_000_000, documentFormats: ['PDF', 'JPEG', 'PNG', 'HEIC'] });
    expect(reason(await upload(home, Buffer.concat(Array.from({ length: 12 }, () => piece)), user, { name: 'scan.pdf' }))).toMatchObject({ status: 413, reason: 'too_large' });
    expect(big.bytes).toBeGreaterThan(11_000_000);
    expect((await t.get(`${files()}/${big.id}/original`, guest)).rawPayload.length).toBe(big.bytes);
    // A format removed from the allow-list is refused for new uploads; existing files stay readable.
    await t.post('/api/admin/settings', { documentFormats: ['PDF', 'JPEG', 'PNG'] }, t.admin);
    expect(reason(await upload(home, fixture('photo.heic'), user, { name: 'IMG_2.HEIC' }))).toMatchObject({ status: 422, reason: 'format_not_allowed' });
    const heic = (t.database.sqlite.prepare("SELECT id FROM document_files WHERE format = 'HEIC'").get() as { id: string }).id;
    expect((await t.get(`${files()}/${heic}/original`, guest)).statusCode).toBe(200);
    await t.post('/api/admin/settings', { documentMaxFileBytes: 50_000_000, documentFormats: ['PDF', 'JPEG', 'PNG', 'HEIC'] }, t.admin);
    expect(stored()).toBe(before);
  }, 60_000);

  it('needs a session, the same origin and membership; ids and hashes of other Workspaces are nothing', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#06c' } }).png().toBuffer();
    const file = (await upload(home, png, user, { name: 'valve.png' })).json().file;
    const hash = sha256(png);
    const before = stored();
    expect((await upload(home, png, undefined)).statusCode).toBe(401);
    expect((await upload(home, png, user, { origin: null })).statusCode).toBe(403);
    expect((await upload(home, png, user, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect(reason(await upload(home, png, guest))).toMatchObject({ status: 403, error: 'forbidden' }); // a GUEST never writes
    expect(reason(await upload(home, png, outsider))).toMatchObject({ status: 404, error: 'workspace_not_found' });
    expect(stored()).toBe(before);
    for (const path of ['', '/original', '/thumbnail', '/pages/1']) {
      const url = (workspaceId: string, id: string) => `${files(workspaceId)}/${id}${path}`;
      expect({ path, status: (await t.get(url(home, file.id))).statusCode }).toEqual({ path, status: 401 });
      expect({ path, status: (await t.get(url(home, file.id), guest)).statusCode }).toEqual({ path, status: 200 });
      // Not a member of Home; Home's id under the outsider's own Workspace; a guessed id; the known hash.
      expect({ path, ...reason(await t.get(url(home, file.id), outsider)) }).toMatchObject({ status: 404, error: 'workspace_not_found' });
      expect({ path, ...reason(await t.get(url(office, file.id), outsider)) }).toMatchObject({ status: 404, error: 'file_not_found' });
      expect({ path, ...reason(await t.get(url(home, '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f'), guest)) }).toMatchObject({ status: 404, error: 'file_not_found' });
      expect({ path, status: (await t.get(url(home, hash), guest)).statusCode }).toEqual({ path, status: 400 });
    }
    for (const page of ['0', '-1', '501', '1e1', '01', 'x', '1.5']) expect({ page, status: (await t.get(`${files()}/${file.id}/pages/${page}`, guest)).statusCode }).toEqual({ page, status: 400 });
    expect((await t.get(`${files()}/usage`, outsider)).statusCode).toBe(404);
    expect((await t.get(`${files(office)}/usage`, outsider)).json().usage).toMatchObject({ usedBytes: 0, limitBytes: 5_000_000_000 });
  });

  it('uploads three files independently: one failing leaves the others, and only that one is sent again', async () => {
    const before = stored();
    const page = (colour: string) => sharp({ create: { width: 300, height: 400, channels: 3, background: colour } }).jpeg().toBuffer();
    const [first, third] = [await page('#a00'), await page('#00a')];
    const results = await Promise.all([upload(home, first, user, { name: 'page-1.jpg' }), upload(home, Buffer.from('not an image'), user, { name: 'page-2.jpg' }), upload(home, third, user, { name: 'page-3.jpg' })]);
    expect(results.map((response) => response.statusCode)).toEqual([201, 422, 201]);
    expect(stored()).toBe(before + 2);
    const retried = await upload(home, await page('#0a0'), user, { name: 'page-2.jpg' });
    expect(retried.statusCode).toBe(201);
    expect(stored()).toBe(before + 3);
    for (const response of [results[0], results[2]]) expect((await t.get(`${files()}/${response?.json().file.id}/original`, guest)).statusCode).toBe(200);
  });

  it('refuses when the Workspace storage is full and keeps everything readable', async () => {
    // Previews and recognised text of earlier uploads count towards storage: let them finish first, so
    // the usage read here is the one the refusal reports.
    await settle();
    await t.services.recognizer.idle();
    const usage = (await t.get(`${files()}/usage`, guest)).json().usage;
    t.database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = ? WHERE id = ?').run(usage.usedBytes + 100, home);
    const jpeg = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#fc0' } }).jpeg().toBuffer();
    const full = await upload(home, jpeg, user, { name: 'one more.jpg' });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({ error: 'storage_full', usedBytes: usage.usedBytes, limitBytes: usage.usedBytes + 100 });
    const any = (t.database.sqlite.prepare('SELECT id FROM document_files WHERE workspace_id = ?').get(home) as { id: string }).id;
    expect((await t.get(`${files()}/${any}/original`, guest)).statusCode).toBe(200);
    t.database.sqlite.prepare('UPDATE workspaces SET storage_quota_bytes = 5000000000 WHERE id = ?').run(home);
  });

  it('writes no file name, hash or content to the log', () => {
    expect(t.logs).toContain('/document-files');
    for (const secret of ['Bolletta', 'IMG_0042', 'valve.png', 'page-2', 'x-file-name', sha256(fixture('three-pages.pdf'))]) expect(t.logs).not.toContain(secret);
  });
});

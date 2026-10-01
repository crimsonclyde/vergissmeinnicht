import { crc32, deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';

/** A real `width`×`height` RGB PNG (a colour gradient) with a text chunk that must not survive. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(2, 9);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      rows[row + 1 + x * 3] = (x * 255) / width;
      rows[row + 2 + x * 3] = (y * 255) / height;
      rows[row + 3 + x * 3] = 128;
    }
  }
  const text = chunk('tEXt', Buffer.from('Comment\0secret-location-note', 'latin1'));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), text, chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const STEP = { title: 'Close the main water valve', required: true, critical: false, skipReasonPolicy: 'OPTIONAL', notApplicableReasonPolicy: 'OPTIONAL' };

describe('instruction images over HTTP (14.3)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let editor: string;
  let guest: string;
  let user: string;
  let outsider: string;

  const upload = (workspaceId: string, body: Buffer | string, cookie: string | undefined, options: { origin?: string | null; type?: string; query?: string } = {}) =>
    t.app.inject({
      method: 'POST',
      url: `/api/workspaces/${workspaceId}/images${options.query ?? ''}`,
      headers: {
        'content-type': options.type ?? 'application/octet-stream',
        ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }),
        ...(cookie === undefined ? {} : { cookie }),
      },
      payload: body,
    });

  beforeAll(async () => {
    t = await startTestApp();
    editor = await t.invite('eddie@example.org', 'Eddie');
    guest = await t.invite('gus@example.org', 'Gus');
    user = await t.invite('uma@example.org', 'Uma');
    outsider = await t.invite('otto@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'eddie@example.org', 'EDITOR');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(home, 'uma@example.org', 'USER');
    await t.addMember(office, 'otto@example.org', 'ADMIN');
  });
  afterAll(async () => t.close());

  it('stores an upload re-encoded as JPEG and serves it to members only', async () => {
    const response = await upload(home, png(2400, 1200), editor);
    expect(response.statusCode).toBe(201);
    const { image, usage } = response.json();
    expect(image).toMatchObject({ width: 1600, height: 800 });
    expect(usage.quotaBytes).toBe(100_000_000);
    expect(usage.usedBytes).toBe(image.bytes);

    const served = await t.get(`/api/workspaces/${home}/images/${image.id}`, guest);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toBe('no-store');
    expect(served.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(served.rawPayload.includes('secret-location-note')).toBe(false);

    // Not signed in, not a member, or the id under another Workspace: nothing.
    expect((await t.get(`/api/workspaces/${home}/images/${image.id}`)).statusCode).toBe(401);
    expect((await t.get(`/api/workspaces/${home}/images/${image.id}`, outsider)).statusCode).toBe(404);
    const foreign = await t.get(`/api/workspaces/${office}/images/${image.id}`, outsider);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: 'image_not_found' });
  });

  it('allows uploads only with procedure.edit, same-origin and as raw bytes', async () => {
    expect((await upload(home, png(40, 40), user)).statusCode).toBe(403);
    expect((await upload(home, png(40, 40), guest)).statusCode).toBe(403);
    expect((await upload(home, png(40, 40), outsider)).statusCode).toBe(404);
    expect((await upload(home, png(40, 40), undefined)).statusCode).toBe(401);
    expect((await upload(home, png(40, 40), editor, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await upload(home, png(40, 40), editor, { origin: null })).statusCode).toBe(403);
    // Only octet-stream is parsed as an upload; form posts and declared image types are refused.
    expect((await upload(home, png(40, 40), editor, { type: 'multipart/form-data; boundary=x' })).statusCode).toBe(415);
    expect((await upload(home, png(40, 40), editor, { type: 'image/png' })).statusCode).toBe(415);
    expect((await upload(home, png(40, 40), editor, { query: '?replacing=../../etc' })).statusCode).toBe(400);
  });

  it('refuses files that are not images with a stable reason', async () => {
    const svg = await upload(home, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', editor);
    expect(svg.statusCode).toBe(422);
    expect(svg.json()).toMatchObject({ error: 'image_rejected', reason: expect.stringMatching(/^(unsupported_format|unreadable)$/) });
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic', 'latin1')]);
    expect((await upload(home, heic, editor)).json()).toEqual({ error: 'image_rejected', reason: 'heic_unsupported' });
    expect((await upload(home, Buffer.alloc(0), editor)).statusCode).toBe(422);
    const tooLarge = await upload(home, Buffer.alloc(10_000_001), editor);
    expect(tooLarge.statusCode).toBe(413);
  });

  it('keeps the image on the Procedure and in Run snapshots; captions are required', async () => {
    const image = (await upload(home, png(300, 200), editor)).json().image;
    const procedure = { title: 'Leave the house', icon: 'home', sections: [{ title: 'Utilities', steps: [{ ...STEP, image: { id: image.id, caption: 'Blue lever' } }] }] };
    const created = await t.post(`/api/workspaces/${home}/procedures`, procedure, editor);
    expect(created.statusCode).toBe(201);
    expect(created.json().procedure.sections[0].steps[0].image).toEqual({ id: image.id, caption: 'Blue lever' });
    const noCaption = { ...procedure, sections: [{ title: 'Utilities', steps: [{ ...STEP, image: { id: image.id, caption: '' } }] }] };
    expect((await t.post(`/api/workspaces/${home}/procedures`, noCaption, editor)).statusCode).toBe(400);
    const run = (await t.post(`/api/workspaces/${home}/runs`, { procedureId: created.json().procedure.id }, user)).json().run;
    expect(run.sections[0].steps[0].image).toEqual({ id: image.id, caption: 'Blue lever' });
    // Export stays image-free (images travel only in the archive format).
    const exported = (await t.get(`/api/workspaces/${home}/procedures/${created.json().procedure.id}/export`, editor)).json();
    expect(JSON.stringify(exported)).not.toContain(image.id);
  });

  it('exports a Procedure with its images as an archive and imports it into another Workspace, charged there', async () => {
    const image = (await upload(home, png(640, 480), editor)).json().image;
    const procedure = { title: 'Water', icon: 'home', sections: [{ title: 'Utilities', steps: [{ ...STEP, image: { id: image.id, caption: 'Blue lever' } }] }] };
    const created = (await t.post(`/api/workspaces/${home}/procedures`, procedure, editor)).json().procedure;
    const archive = await t.get(`/api/workspaces/${home}/procedures/${created.id}/archive`, guest);
    expect(archive.statusCode).toBe(200);
    expect(archive.headers['content-type']).toBe('application/zip');
    expect(archive.headers['content-disposition']).toBe('attachment; filename="procedure.vmn.zip"');
    expect((await t.get(`/api/workspaces/${home}/procedures/${created.id}/archive`, outsider)).statusCode).toBe(404);

    const importArchive = (workspaceId: string, cookie: string, body: Buffer) =>
      t.app.inject({
        method: 'POST',
        url: `/api/workspaces/${workspaceId}/procedures/import-archive`,
        headers: { origin: ORIGIN, cookie, 'content-type': 'application/octet-stream' },
        payload: body,
      });
    // Otto administers Office, not Home: he can import there, the guest cannot import into Home.
    expect((await importArchive(home, guest, archive.rawPayload)).statusCode).toBe(403);
    const before = (await t.get(`/api/workspaces/${office}/images/usage`, outsider)).json().usage.usedBytes;
    const imported = await importArchive(office, outsider, archive.rawPayload);
    expect(imported.statusCode).toBe(201);
    const step = imported.json().procedure.sections[0].steps[0];
    expect(step.image.caption).toBe('Blue lever');
    expect(step.image.id).not.toBe(image.id);
    expect((await t.get(`/api/workspaces/${office}/images/${step.image.id}`, outsider)).statusCode).toBe(200);
    expect((await t.get(`/api/workspaces/${office}/images/usage`, outsider)).json().usage.usedBytes).toBeGreaterThan(before);
    // A broken archive is refused as a whole.
    const broken = await importArchive(office, outsider, archive.rawPayload.subarray(0, archive.rawPayload.length - 30));
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toEqual({ error: 'invalid_archive' });
  });

  it('keeps the image when duplicating a Procedure', async () => {
    const image = (await upload(home, png(100, 100), editor)).json().image;
    const procedure = { title: 'Copy me', icon: 'home', sections: [{ title: 'S', steps: [{ ...STEP, image: { id: image.id, caption: 'Valve' } }] }] };
    const created = (await t.post(`/api/workspaces/${home}/procedures`, procedure, editor)).json().procedure;
    const copy = await t.post(`/api/workspaces/${home}/procedures/${created.id}/duplicate`, {}, editor);
    expect(copy.json().procedure.sections[0].steps[0].image).toEqual({ id: image.id, caption: 'Valve' });
  });

  it('lets server admins see usage and choose a quota; nobody else', async () => {
    const storage = await t.get('/api/admin/image-storage', t.admin);
    expect(storage.statusCode).toBe(200);
    expect(storage.json().workspaces.find((w: { id: string }) => w.id === home)).toMatchObject({ name: 'Home', quotaBytes: 100_000_000 });
    expect((await t.get('/api/admin/image-storage', editor)).statusCode).toBe(403);
    expect((await t.post(`/api/admin/image-storage/${home}/quota`, { quota: 1_000_000_000 }, editor)).statusCode).toBe(403);
    expect((await t.post(`/api/admin/image-storage/${home}/quota`, { quota: 123 }, t.admin)).json()).toMatchObject({ error: 'invalid_image_quota' });
    expect((await t.post(`/api/admin/image-storage/${home}/quota`, { quota: 250_000_000 }, t.admin)).statusCode).toBe(204);
    expect((await t.get(`/api/workspaces/${home}/images/usage`, guest)).json().usage.quotaBytes).toBe(250_000_000);
  });
});

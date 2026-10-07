import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp, type InjectResponse } from './test-harness.ts';

const ORIGIN = 'https://vmn.example.org';
// Real OCR runs here; the language data is fetched, not committed (`pnpm ocr:data`), and CI must have it.
const haveData = existsSync(join(import.meta.dirname, '../../../../packages/media/tessdata/ita.traineddata'));
if (!haveData && process.env.CI !== undefined) throw new Error('OCR language data missing: run `pnpm ocr:data`');

/** A fictional photographed bill with words printed on it. */
const photo = (lines: readonly string[]) => {
  const body = lines.map((line, index) => `<text x="80" y="${200 + index * 80}" font-family="DejaVu Sans" font-size="40">${line}</text>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`)).jpeg({ quality: 85 }).toBuffer();
};

describe.skipIf(!haveData)('Text recognition over HTTP (16.9)', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let home: string;
  let office: string;
  let owner: string;
  let user: string;
  let guest: string;
  let outsider: string;

  const api = (workspaceId = home) => `/api/workspaces/${workspaceId}`;
  const error = (response: InjectResponse) => ({ status: response.statusCode, error: (response.json() as { error: string }).error });
  const upload = async (bytes: Buffer, cookie = user, workspaceId = home) => {
    const response = await t.app.inject({ method: 'POST', url: `${api(workspaceId)}/document-files`, headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('scan.jpg'), origin: ORIGIN, cookie }, payload: bytes });
    return response.json().file as { id: string; text: string | null };
  };

  beforeAll(async () => {
    t = await startTestApp();
    owner = await t.invite('olga@example.org', 'Olga');
    user = await t.invite('uma@example.org', 'Uma');
    guest = await t.invite('gus@example.org', 'Gus');
    outsider = await t.invite('otto@example.org', 'Otto');
    home = await t.createWorkspace('Home');
    office = await t.createWorkspace('Office');
    await t.addMember(home, 'olga@example.org', 'ADMIN');
    await t.addMember(home, 'uma@example.org', 'USER');
    await t.addMember(home, 'gus@example.org', 'GUEST');
    await t.addMember(office, 'otto@example.org', 'ADMIN');
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    await t.post(`${api(office)}/tools`, { tool: 'DOCUMENTS', enabled: true }, outsider);
  }, 60_000);
  afterAll(async () => t.close());

  it('a photographed Italian water bill becomes findable by a word printed on it, with a plain-text snippet', async () => {
    const file = await upload(await photo(['ACQUEDOTTO PUGLIESE', 'Bolletta acqua n. 2026/004512', 'Totale da pagare: EUR 87,40']));
    expect(['QUEUED', 'PROCESSING']).toContain(file.text); // the background worker may already have it
    const created = (await t.post(`${api()}/documents`, { title: 'Water', folderId: null, fileIds: [file.id] }, user)).json().document;
    await t.services.recognizer.idle();
    const page = (await t.get(`${api()}/documents/${created.id}`, guest)).json().document.pages[0];
    expect(page.text).toBe('DONE');
    // The file's JSON carries the state only — never the recognised text.
    expect(JSON.stringify(page)).not.toContain('Bolletta');
    const found = (await t.get(`${api()}/documents?q=bolletta`, guest)).json();
    expect(found.documents.map((each: { id: string }) => each.id)).toEqual([created.id]);
    expect(found.documents[0].textMatch).toMatchObject({ file: 1, page: 1 });
    expect(found.documents[0].textMatch.snippet).toContain('Bolletta acqua');
    // Another Workspace learns nothing: no hit, no snippet, no count; and no way in by id.
    expect((await t.get(`${api(office)}/documents?q=bolletta`, outsider)).json()).toMatchObject({ documents: [], total: 0 });
    expect((await t.get(`${api()}/documents?q=bolletta`, outsider)).statusCode).toBe(404);
  });

  it('Retry is for members who may change files, only for failed text; the switch is for Workspace admins', async () => {
    const file = await upload(await photo(['Fattura gas']));
    await t.services.recognizer.idle();
    expect(error(await t.post(`${api()}/document-files/${file.id}/text/retry`, undefined, user))).toEqual({ status: 409, error: 'text_retry_not_possible' });
    expect(error(await t.post(`${api()}/document-files/${file.id}/text/retry`, undefined, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.post(`${api(office)}/document-files/${file.id}/text/retry`, undefined, outsider)).statusCode).toBe(404);
    for (const cookie of [user, guest]) {
      expect(error(await t.get(`${api()}/text-recognition`, cookie))).toEqual({ status: 403, error: 'forbidden' });
      expect(error(await t.post(`${api()}/text-recognition`, { enabled: false }, cookie))).toEqual({ status: 403, error: 'forbidden' });
    }
    expect((await t.get(`${api()}/text-recognition`, outsider)).statusCode).toBe(404);
    expect((await t.post(`${api()}/text-recognition`, { enabled: 'no' }, owner)).statusCode).toBe(400);
    expect((await t.post(`${api()}/text-recognition`, { enabled: false }, owner, null)).statusCode).toBe(403); // no Origin
    const off = (await t.post(`${api()}/text-recognition`, { enabled: false }, owner)).json().textRecognition;
    expect(off).toMatchObject({ enabled: false, files: { DONE: 2 } });
    expect((await t.get(`${api()}/text-recognition`, owner)).json().textRecognition.enabled).toBe(false);
    expect((await t.post(`${api()}/text-recognition`, { enabled: true }, owner)).json().textRecognition.enabled).toBe(true);
  });

  it('answers as unknown on every text route while Documents is switched off', async () => {
    const file = await upload(await photo(['Ricevuta']));
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: false }, owner);
    try {
      for (const cookie of [owner, user, guest]) {
        expect(error(await t.get(`${api()}/text-recognition`, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
        expect(error(await t.post(`${api()}/text-recognition`, { enabled: true }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
        expect(error(await t.post(`${api()}/document-files/${file.id}/text/retry`, undefined, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
      }
    } finally {
      await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    }
  });

  it('suggestions are offered to those who may change the Document, read from its text, and dismissed one by one', async () => {
    const file = await upload(await photo(['ACQUEDOTTO PUGLIESE S.p.A.', 'Bolletta acqua n. 4512', 'Scadenza pagamento: 15/08/2026']));
    const created = (await t.post(`${api()}/documents`, { title: 'scan', folderId: null, fileIds: [file.id] }, user)).json().document;
    await t.services.recognizer.idle();
    const path = `${api()}/documents/${created.id}/suggestions`;
    const offered = (await t.get(path, user)).json().suggestions as { field: string; value: string; page: number; excerpt: string }[];
    expect(offered.find((each) => each.field === 'dueDate')).toMatchObject({ value: '2026-08-15', page: 1 });
    expect(error(await t.get(path, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.get(`${api(office)}/documents/${created.id}/suggestions`, outsider)).statusCode).toBe(404);
    expect(error(await t.post(`${path}/dismiss`, { field: 'password', value: 'x' }, user))).toEqual({ status: 400, error: 'invalid_suggestion' });
    expect((await t.post(`${path}/dismiss`, { field: 'dueDate', value: '2026-08-15', extra: 1 }, user)).statusCode).toBe(400);
    expect(error(await t.post(`${path}/dismiss`, { field: 'dueDate', value: '2026-08-15' }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.post(`${path}/dismiss`, { field: 'dueDate', value: '2026-08-15' }, user)).statusCode).toBe(204);
    expect(((await t.get(path, user)).json().suggestions as { field: string }[]).map((each) => each.field)).not.toContain('dueDate');
    // Offering suggestions changed nothing on the Document.
    expect((await t.get(`${api()}/documents/${created.id}`, user)).json().document).toMatchObject({ title: 'scan', type: null, documentDate: null, revision: created.revision });
  });
  it('shows the text to everyone who sees the Document and lets those who may change it correct it (16.13)', async () => {
    const file = await upload(await photo(['Fattura luce n. 77', 'Totale EUR 41,20']));
    const created = (await t.post(`${api()}/documents`, { title: 'Light', folderId: null, fileIds: [file.id] }, user)).json().document;
    await t.services.recognizer.idle();
    const path = `${api()}/document-files/${file.id}/text`;
    const shown = (await t.get(path, guest)).json().text;
    expect(shown).toMatchObject({ state: 'DONE', source: 'OCR', truncated: false, corrected: null, revision: 0 });
    expect(shown.pages.join(' ')).toContain('Fattura luce');
    // Guests read, but do not change; another Workspace gets nothing.
    expect(error(await t.post(`${path}/correct`, { text: 'x', revision: 0 }, guest))).toEqual({ status: 403, error: 'forbidden' });
    expect((await t.get(`${api(office)}/document-files/${file.id}/text`, outsider)).statusCode).toBe(404);
    expect((await t.get(path, outsider)).statusCode).toBe(404);
    expect((await t.post(`${api(office)}/document-files/${file.id}/text/correct`, { text: 'x', revision: 0 }, outsider)).statusCode).toBe(404);
    // Strict bodies, a bounded text, and the Origin check on a change.
    expect((await t.post(`${path}/correct`, { text: 'x', revision: 0, extra: 1 }, user)).statusCode).toBe(400);
    expect((await t.post(`${path}/correct`, { text: 'x', revision: -1 }, user)).statusCode).toBe(400);
    expect((await t.post(`${path}/correct`, { text: 'x'.repeat(200_001), revision: 0 }, user)).statusCode).toBe(400);
    expect((await t.post(`${path}/correct`, { text: 'x', revision: 0 }, user, null)).statusCode).toBe(403);
    const corrected = (await t.post(`${path}/correct`, { text: 'Fattura luce n. 77\nTotale EUR 41,20\nPagata il 03/10/2026', revision: 0 }, user)).json().text;
    expect(corrected).toMatchObject({ pages: ['Fattura luce n. 77\nTotale EUR 41,20\nPagata il 03/10/2026'], corrected: { by: 'Uma' }, revision: 1 });
    expect(error(await t.post(`${path}/correct`, { text: 'stale', revision: 0 }, user))).toEqual({ status: 409, error: 'document_conflict' });
    const found = (await t.get(`${api()}/documents?q=pagata`, guest)).json().documents;
    expect(found[0]).toMatchObject({ id: created.id, textMatch: { file: 1, page: null } });
    // The file JSON still carries the state only.
    expect(JSON.stringify((await t.get(`${api()}/documents/${created.id}`, guest)).json())).not.toContain('Pagata');
    const restored = (await t.post(`${path}/restore`, { revision: 1 }, user)).json().text;
    expect(restored).toMatchObject({ corrected: null, revision: 2 });
    expect((await t.get(`${api()}/documents?q=pagata`, guest)).json().documents).toEqual([]);
  });

  it('answers as unknown on the text routes while Documents is switched off (16.13)', async () => {
    const file = await upload(await photo(['Scontrino']));
    await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: false }, owner);
    try {
      for (const cookie of [owner, user, guest]) {
        expect(error(await t.get(`${api()}/document-files/${file.id}/text`, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
        expect(error(await t.post(`${api()}/document-files/${file.id}/text/correct`, { text: 'x', revision: 0 }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
        expect(error(await t.post(`${api()}/document-files/${file.id}/text/restore`, { revision: 0 }, cookie))).toEqual({ status: 404, error: 'tool_not_enabled' });
      }
    } finally {
      await t.post(`${api()}/tools`, { tool: 'DOCUMENTS', enabled: true }, owner);
    }
  });
});

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentFileRejectedError } from '@vergissmeinnicht/application';
import { createDocumentFileStore, documentFilePath } from './document-file-store.ts';

async function* chunks(...parts: Uint8Array[]) {
  for (const part of parts) yield part;
}
const text = (value: string) => new TextEncoder().encode(value);
const collect = async (stream: AsyncIterable<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
};

describe('document file store (16.1, HT2)', () => {
  let dir: string;
  let root: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-documents-'));
    root = join(dir, 'documents');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const staged = () => readdirSync(join(root, '.staging'));

  it('receives an upload into staging, hashes it, and stores it unchanged under its SHA-256, privately', async () => {
    const store = createDocumentFileStore(root);
    const upload = await store.stage(chunks(text('%PDF-1.7 '), text('original bytes')), 1000);
    const expected = Buffer.from('%PDF-1.7 original bytes');
    expect(upload.bytes).toBe(expected.length);
    expect(upload.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(readFileSync(upload.path)).toEqual(expected);
    expect(await store.locate(upload.sha256)).toBeUndefined(); // not a stored file before commit
    await upload.commit();
    await upload.discard(); // harmless after commit
    expect(staged()).toEqual([]);
    const path = documentFilePath(root, upload.sha256);
    expect(readFileSync(path)).toEqual(expected);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, '.staging')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const opened = await store.open(upload.sha256);
    expect(opened?.bytes).toBe(expected.length);
    expect(opened === undefined ? undefined : await collect(opened.stream)).toEqual(expected);
    expect((await store.list()).map((entry) => entry.sha256)).toEqual([upload.sha256]);
  });

  it('cuts an upload off as soon as it exceeds the limit and keeps nothing', async () => {
    const store = createDocumentFileStore(root);
    let delivered = 0;
    async function* endless() {
      for (;;) {
        delivered++;
        yield new Uint8Array(400);
      }
    }
    await expect(store.stage(endless(), 1000)).rejects.toMatchObject({ code: 'too_large' });
    expect(delivered).toBe(3); // stopped at the first chunk beyond the limit, not at the end of the stream
    expect(staged()).toEqual([]);
    await expect(store.stage(chunks(), 1000)).rejects.toThrow(DocumentFileRejectedError);
    await expect(store.stage(chunks(), 1000)).rejects.toMatchObject({ code: 'empty' });
    expect(staged()).toEqual([]);
    // Exactly the limit is accepted.
    await expect(store.stage(chunks(new Uint8Array(1000)), 1000)).resolves.toMatchObject({ bytes: 1000 });
  });

  it('removes the staged bytes when the upload breaks off or is discarded', async () => {
    const store = createDocumentFileStore(root);
    async function* broken() {
      yield text('half a file');
      throw new Error('connection lost');
    }
    await expect(store.stage(broken(), 1000)).rejects.toThrow('connection lost');
    expect(staged()).toEqual([]);
    const upload = await store.stage(chunks(text('refused later')), 1000);
    await upload.discard();
    expect(staged()).toEqual([]);
    expect(await store.list()).toEqual([]);
  });

  it('stores identical content once, also for derived files, and removes idempotently', async () => {
    const store = createDocumentFileStore(root);
    const first = await store.stage(chunks(text('same')), 100);
    await first.commit();
    const second = await store.stage(chunks(text('same')), 100);
    await second.commit();
    expect(second.sha256).toBe(first.sha256);
    expect(await store.put(text('same'))).toBe(first.sha256);
    const preview = await store.put(text('preview'));
    expect((await store.list()).map((entry) => entry.sha256).sort()).toEqual([first.sha256, preview].sort());
    expect(staged()).toEqual([]);
    await store.remove(preview);
    await store.remove(preview);
    expect(await store.open(preview)).toBeUndefined();
    expect(await store.locate(preview)).toBeUndefined();
  });

  it('sweeps staged uploads a crash left behind, but not ones still arriving', async () => {
    const store = createDocumentFileStore(root);
    const old = await store.stage(chunks(text('left behind')), 100);
    const fresh = await store.stage(chunks(text('arriving')), 100);
    const yesterday = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(old.path, yesterday, yesterday);
    expect(await store.sweepStaged(new Date(Date.now() - 24 * 3_600_000))).toBe(1);
    expect(staged()).toHaveLength(1);
    expect(readFileSync(fresh.path).toString()).toBe('arriving');
    expect(await createDocumentFileStore(join(dir, 'nothing-yet')).sweepStaged(new Date())).toBe(0);
    expect(await createDocumentFileStore(join(dir, 'nothing-yet')).list()).toEqual([]);
  });

  it('never builds a path from anything but a hash', async () => {
    const store = createDocumentFileStore(root);
    for (const bad of ['../../etc/passwd', 'ABCDEF', 'x'.repeat(64), '', `${'a'.repeat(64)}/..`]) {
      expect(() => documentFilePath(root, bad)).toThrow('invalid file hash');
      await expect(store.open(bad)).rejects.toThrow('invalid file hash');
    }
  });
});

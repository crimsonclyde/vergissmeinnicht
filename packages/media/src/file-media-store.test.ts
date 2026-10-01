import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileMediaStore, mediaPath } from './file-media-store.ts';

describe('file media store (14.3, T1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-media-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores content once under its SHA-256, privately, without leftovers', async () => {
    const root = join(dir, 'media');
    const store = createFileMediaStore(root);
    const bytes = new TextEncoder().encode('jpeg bytes');
    const sha = await store.put(bytes);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(await store.put(bytes)).toBe(sha);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(mediaPath(root, sha)).mode & 0o777).toBe(0o600);
    expect(readdirSync(root).filter((name) => name.startsWith('.upload-'))).toEqual([]);
    expect(await store.read(sha)).toEqual(bytes);
    expect((await store.list()).map((entry) => entry.sha256)).toEqual([sha]);
    await store.remove(sha);
    await store.remove(sha); // idempotent
    expect(await store.read(sha)).toBeUndefined();
  });

  it('never builds a path from anything but a hash', () => {
    for (const bad of ['../../etc/passwd', 'ABCDEF', 'x'.repeat(64), '']) expect(() => mediaPath('/data/media', bad)).toThrow('invalid media hash');
  });
});

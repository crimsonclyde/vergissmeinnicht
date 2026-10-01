import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, readFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { MediaStore } from '@vergissmeinnicht/application';

const SHA256 = /^[0-9a-f]{64}$/;

/** `<root>/<first two hex digits>/<sha256>.jpg` — only ever built from a validated hash, never from input. */
export function mediaPath(root: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('invalid media hash');
  return join(root, sha256.slice(0, 2), `${sha256}.jpg`);
}

/**
 * Immutable content-addressed image files under `root` (T1; `/data/media` in the container). The
 * directory is created `0700` on the first upload, files `0600`. `put` writes a temporary file, fsyncs it and renames it
 * into place, so a file is either complete or absent — and the database only references it after that.
 */
export function createFileMediaStore(root: string): MediaStore {
  return {
    async put(bytes) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const target = mediaPath(root, sha256);
      try {
        await stat(target);
        return sha256; // identical content is stored once
      } catch {
        // not present yet
      }
      mkdirSync(root, { recursive: true, mode: 0o700 });
      mkdirSync(join(root, sha256.slice(0, 2)), { recursive: true, mode: 0o700 });
      const temporary = join(root, `.upload-${randomUUID()}`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      const directory = await open(join(root, sha256.slice(0, 2)), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return sha256;
    },

    async read(sha256) {
      try {
        return new Uint8Array(await readFile(mediaPath(root, sha256)));
      } catch {
        return undefined;
      }
    },

    async remove(sha256) {
      try {
        await unlink(mediaPath(root, sha256));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },

    async list() {
      const found: { sha256: string; modifiedAt: Date }[] = [];
      let prefixes: string[];
      try {
        prefixes = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return found; // nothing uploaded yet
        throw error;
      }
      for (const prefix of prefixes) {
        if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
        for (const name of await readdir(join(root, prefix))) {
          const sha256 = name.replace(/\.jpg$/, '');
          if (!SHA256.test(sha256) || !sha256.startsWith(prefix)) continue;
          found.push({ sha256, modifiedAt: (await stat(join(root, prefix, name))).mtime });
        }
      }
      return found;
    },
  };
}

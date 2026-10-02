import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { open, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DocumentFileRejectedError, type DocumentFileStore, type StagedFile } from '@vergissmeinnicht/application';

const SHA256 = /^[0-9a-f]{64}$/;
const STAGING = '.staging';

/** `<root>/<first two hex digits>/<sha256>` — only ever built from a validated hash, never from input. */
export function documentFilePath(root: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('invalid file hash');
  return join(root, sha256.slice(0, 2), sha256);
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Immutable content-addressed files under `root` (HT2; `/data/documents` in the container): originals
 * exactly as uploaded and their derived previews. Directories are `0700`, files `0600`. An upload is
 * written to `<root>/.staging/<random>` while it is counted and hashed — on the data volume, not in
 * memory or `/tmp` — fsynced, and renamed into place only after it was validated, so a stored file is
 * either complete or absent and the database only references it after that.
 */
export function createDocumentFileStore(root: string): DocumentFileStore {
  const staging = join(root, STAGING);

  async function moveIntoPlace(temporary: string, sha256: string): Promise<void> {
    const target = documentFilePath(root, sha256);
    try {
      await stat(target);
      await unlink(temporary); // identical content is stored once
      return;
    } catch {
      // not present yet
    }
    mkdirSync(join(root, sha256.slice(0, 2)), { recursive: true, mode: 0o700 });
    await rename(temporary, target);
    await syncDirectory(join(root, sha256.slice(0, 2)));
  }

  return {
    async stage(source, maxBytes): Promise<StagedFile> {
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      const path = join(staging, randomUUID());
      const hash = createHash('sha256');
      let bytes = 0;
      const handle = await open(path, 'wx', 0o600);
      try {
        for await (const chunk of source) {
          bytes += chunk.byteLength;
          // Cut off while receiving: nothing beyond the limit is written.
          if (bytes > maxBytes) throw new DocumentFileRejectedError('too_large');
          hash.update(chunk);
          await handle.writeFile(chunk);
        }
        if (bytes === 0) throw new DocumentFileRejectedError('empty');
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(path, { force: true });
        throw error;
      }
      await handle.close();
      const sha256 = hash.digest('hex');
      let done = false;
      return {
        path,
        sha256,
        bytes,
        async commit() {
          if (done) return;
          done = true;
          await moveIntoPlace(path, sha256);
        },
        async discard() {
          if (done) return;
          done = true;
          await rm(path, { force: true });
        },
      };
    },

    async put(bytes) {
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      try {
        await stat(documentFilePath(root, sha256));
        return sha256;
      } catch {
        // not present yet
      }
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      const temporary = join(staging, randomUUID());
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await moveIntoPlace(temporary, sha256);
      return sha256;
    },

    async locate(sha256) {
      const path = documentFilePath(root, sha256);
      try {
        await stat(path);
        return path;
      } catch {
        return undefined;
      }
    },

    async open(sha256) {
      const path = documentFilePath(root, sha256);
      try {
        const { size } = await stat(path);
        // Opened only when it is read: a caller that never reads leaves no open file behind.
        return {
          stream: (async function* () {
            yield* createReadStream(path) as AsyncIterable<Uint8Array>;
          })(),
          bytes: size,
        };
      } catch {
        return undefined;
      }
    },

    async remove(sha256) {
      try {
        await unlink(documentFilePath(root, sha256));
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
          if (!SHA256.test(name) || !name.startsWith(prefix)) continue;
          found.push({ sha256: name, modifiedAt: (await stat(join(root, prefix, name))).mtime });
        }
      }
      return found;
    },

    async sweepStaged(before) {
      let names: string[];
      try {
        names = await readdir(staging);
      } catch {
        return 0;
      }
      let removed = 0;
      for (const name of names) {
        const path = join(staging, name);
        try {
          if ((await stat(path)).mtime.getTime() >= before.getTime()) continue;
          await rm(path, { force: true });
          removed++;
        } catch {
          // gone meanwhile
        }
      }
      return removed;
    },
  };
}

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { areaSchema, type MapArea } from './area.ts';
import { downloadMap } from './download.ts';

const installedSchema = z.object({
  id: z.uuid(), area: areaSchema, installedAt: z.iso.datetime(), actorId: z.uuid(),
  bytes: z.number().int().positive(), tiles: z.number().int().positive(), maxZoom: z.number().int().min(0).max(15),
  build: z.string().regex(/^\d{8}$/), sourceVersion: z.string().max(32), receivedBytes: z.number().int().positive(),
});
export type InstalledMap = z.infer<typeof installedSchema>;
export interface MapJob { state: 'downloading' | 'failed' | 'cancelled' | 'installed'; percent: number; area: MapArea }
export interface MapDataStatus { installed: InstalledMap | null; job: MapJob | null }
type DownloadResult = Awaited<ReturnType<typeof downloadMap>>;
export type MapRunner = (directory: string, area: MapArea, progress: (n: number) => void, signal: AbortSignal) => Promise<DownloadResult>;
function runWorker(directory: string, area: MapArea, progress: (n: number) => void, signal: AbortSignal): Promise<DownloadResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { directory, area }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 }, stdout: true, stderr: true });
    const stop = () => { void worker.terminate().then(() => reject(new Error('map_cancelled'))); };
    signal.addEventListener('abort', stop, { once: true });
    worker.on('message', (message: { percent?: number; result?: DownloadResult; failed?: boolean }) => {
      if (message.percent !== undefined) progress(message.percent);
      if (message.result) resolve(message.result);
      if (message.failed) reject(new Error('map_download'));
    });
    worker.once('error', () => reject(new Error('map_download')));
    worker.once('exit', () => { signal.removeEventListener('abort', stop); reject(new Error('map_download')); });
  });
}
async function durableJson(path: string, value: unknown, published?: () => void) {
  const file = await open(path + '.new', 'w', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(path + '.new', path);
  published?.();
  const directory = await open(join(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
/** Public cartography only; filesystem publication is independent of Workspace records/backups. */
export class MapDataManager {
  readonly root: string;
  private installed: InstalledMap | null = null;
  private job: MapJob | null = null;
  private controller: AbortController | undefined;
  private pending: Promise<void> | undefined;
  private runner: MapRunner;
  constructor(root: string, runner: MapRunner = runWorker) { this.root = root; this.runner = runner; }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, 'versions'), { recursive: true, mode: 0o700 });
    try { this.installed = installedSchema.parse(JSON.parse(await readFile(join(this.root, 'current.json'), 'utf8'))); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('map_manifest', { cause: e }); }
    for (const name of await readdir(this.root)) if (/^staging-[0-9a-f-]{36}$/.test(name)) await rm(join(this.root, name), { recursive: true, force: true });
    // Keep the active and most recent previous version; retain immutable install manifests.
    await this.prune();
  }
  status(): MapDataStatus { return structuredClone({ installed: this.installed, job: this.job }); }
  manifest() {
    return this.installed ? { archive: `/map-assets/managed/${this.installed.id}/region.pmtiles`, glyphRoot: `/map-assets/managed/${this.installed.id}/fonts/` }
      : { archive: '/map-assets/region.pmtiles', glyphRoot: '/map-assets/fonts/' };
  }
  async start(input: unknown, actorId: string, authorized: () => Promise<boolean>) {
    if (this.pending) throw new Error('map_busy');
    const area = areaSchema.parse(input);
    // Reserve synchronously before any filesystem await, including overlapping admin requests.
    this.job = { state: 'downloading', percent: 0, area };
    const controller = new AbortController(); this.controller = controller;
    const task = this.install(area, actorId, authorized, controller);
    this.pending = task;
    void task.finally(() => { if (this.pending === task) { this.pending = undefined; this.controller = undefined; } });
    return this.status();
  }
  private async install(area: MapArea, actorId: string, authorized: () => Promise<boolean>, controller: AbortController) {
    const id = randomUUID(); const directory = join(this.root, 'staging-' + id);
    const timeout = setTimeout(() => controller.abort(), 20 * 60_000); timeout.unref();
    try {
      const fs = await statfs(this.root);
      if (fs.bavail * fs.bsize < 3_200_000_000) throw new Error('map_disk');
      await mkdir(directory, { mode: 0o700 });
      const result = await this.runner(directory, area, percent => {
        if (this.job?.state === 'downloading' && Number.isFinite(percent)) this.job.percent = Math.min(99, Math.max(0, Math.floor(percent)));
      }, controller.signal);
      if (controller.signal.aborted || !(await authorized())) throw new Error('map_cancelled');
      const installed = installedSchema.parse({ id, area, actorId, installedAt: new Date().toISOString(), ...result });
      // The install manifest includes the actor and timestamp atomically with the new active version.
      await durableJson(join(directory, 'install.json'), installed);
      // Flush all directory entries and downloaded font bytes before publishing the manifest.
      for (const range of await readdir(join(directory, 'fonts', 'Noto Sans Regular'))) {
        const font = await open(join(directory, 'fonts', 'Noto Sans Regular', range), 'r');
        try { await font.sync(); } finally { await font.close(); }
      }
      for (const path of [join(directory, 'fonts', 'OFL.txt'), join(directory, 'fonts', 'Noto Sans Regular'), join(directory, 'fonts'), directory]) {
        const handle = await open(path, 'r');
        try { await handle.sync(); } finally { await handle.close(); }
      }
      const destination = join(this.root, 'versions', id);
      await rename(directory, destination);
      const versions = await open(join(this.root, 'versions'), 'r');
      try { await versions.sync(); } finally { await versions.close(); }
      if (controller.signal.aborted || !(await authorized())) { await rm(destination, { recursive: true, force: true }); throw new Error('map_cancelled'); }
      await durableJson(join(this.root, 'current.json'), installed, () => {
        this.installed = installed;
        this.job = { state: 'installed', percent: 100, area };
      });
      await this.prune().catch(() => undefined);
    } catch {
      // A directory fsync failure after the manifest rename cannot undo a published map.
      if (this.installed?.id !== id) this.job = { state: controller.signal.aborted ? 'cancelled' : 'failed', percent: 0, area };
    } finally { clearTimeout(timeout); await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  }
  async cancel() { this.controller?.abort(); await this.pending; return this.status(); }
  async close() { await this.cancel(); }
  private async prune() {
    const versions = [];
    for (const id of await readdir(join(this.root, 'versions'))) {
      if (!z.uuid().safeParse(id).success) continue;
      try { const record = installedSchema.parse(JSON.parse(await readFile(join(this.root, 'versions', id, 'install.json'), 'utf8'))); versions.push(record); } catch { /* refuse unknown directories */ }
    }
    versions.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
    const previous = versions.find(v => v.id !== this.installed?.id);
    for (const v of versions) if (v.id !== this.installed?.id && v.id !== previous?.id) {
      const path = join(this.root, 'versions', v.id);
      for (const name of ['region.pmtiles', 'fonts']) await rm(join(path, name), { recursive: true, force: true });
    }
  }
}

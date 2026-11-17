import { open, rename, unlink, type FileHandle } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { bytesToHeader, zxyToTileId, type Entry } from 'pmtiles';
import { areaBounds, type MapArea } from './area.ts';
import { decodeDirectory, encodeDirectory, unpack } from './directory.ts';

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error('map_directory');
  return value;
}
async function writeAll(file: FileHandle, bytes: Buffer) {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error('map_storage');
    offset += bytesWritten;
  }
}
export const MAX_MAP_BYTES = 1_000_000_000;
export type RangeReader = (offset: number, length: number) => Promise<Buffer>;
export function wantedTiles(area: MapArea, maxZoom: number): number[] {
  const [west, south, east, north] = areaBounds(area);
  const wanted: number[] = [];
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z;
    const x = (lon: number) => Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
    const y = (lat: number) => Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
    const left = x(west), right = x(east), top = y(north), bottom = y(south);
    if (wanted.length + (right - left + 1) * (bottom - top + 1) > 400_000) throw new Error('map_area_size');
    for (let tx = left; tx <= right; tx++) for (let ty = top; ty <= bottom; ty++) wanted.push(zxyToTileId(z, tx, ty));
  }
  return wanted.sort((a, b) => a - b);
}
function lowerBound(values: number[], value: number): number {
  let low = 0, high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (at(values, mid) < value) low = mid + 1; else high = mid; }
  return low;
}
function checkedRange(offset: number, length: number, total = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 * 1024
    || !Number.isSafeInteger(offset + length) || offset + length > total) throw new Error('map_range');
}
/** Writes a regional v3 archive without buffering the tile payload in memory. Runs in a worker. */
export async function extractMap(read: RangeReader, path: string, area: MapArea, progress: (percent: number) => void) {
  const raw = await read(0, 127);
  if (raw.length !== 127 || !raw.subarray(0, 8).equals(Buffer.from('PMTiles\x03'))) throw new Error('map_header');
  const h = bytesToHeader(Uint8Array.from(raw).buffer);
  if (h.tileType !== 1 || ![1, 2].includes(h.internalCompression) || ![1, 2].includes(h.tileCompression)
    || h.minZoom !== 0 || h.maxZoom < 10 || h.maxZoom > 15 || !h.clustered) throw new Error('map_format');
  if (h.rootDirectoryOffset !== 127 || h.rootDirectoryLength > 16384 - 127) throw new Error('map_header');
  // PMTiles permits metadata/leaf directories after tile data (the official planet builds do this).
  const total = Math.max(h.rootDirectoryOffset + h.rootDirectoryLength, h.jsonMetadataOffset + h.jsonMetadataLength,
    h.leafDirectoryOffset + (h.leafDirectoryLength ?? 0), h.tileDataOffset + (h.tileDataLength ?? 0));
  if (!Number.isSafeInteger(total) || total < 127) throw new Error('map_header');
  checkedRange(h.rootDirectoryOffset, h.rootDirectoryLength, total);
  checkedRange(h.jsonMetadataOffset, h.jsonMetadataLength, total);
  const meta = JSON.parse(unpack(await read(h.jsonMetadataOffset, h.jsonMetadataLength), h.internalCompression).toString()) as { vector_layers?: { id?: unknown }[] };
  const layers = meta.vector_layers;
  if (!Array.isArray(layers) || !['roads', 'water', 'places', 'landuse', 'landcover'].every(id => layers.some(layer => layer.id === id))) throw new Error('map_layers');
  // Never forward provider HTML/URLs (notably TileJSON attribution) into the browser.
  // The renderer uses fixed local styling and explicit OSM attribution; only known layer names are needed.
  const knownLayers = ['boundaries', 'buildings', 'earth', 'landcover', 'landuse', 'places', 'pois', 'roads', 'water'];
  const metadata = gzipSync(Buffer.from(JSON.stringify({
    name: 'VMN regional basemap', format: 'pbf', attribution: '© OpenStreetMap contributors',
    vector_layers: knownLayers.filter(id => layers.some(layer => layer.id === id)).map(id => ({ id, fields: {} })),
  })));
  const wanted = wantedTiles(area, h.maxZoom);
  const selected: Entry[] = []; const visited = new Set<number>(); let dirs = 0;
  const visit = async (offset: number, length: number, depth: number) => {
    checkedRange(offset, length, total);
    if (++dirs > 2048 || depth > 3 || visited.has(offset)) throw new Error('map_directory');
    visited.add(offset);
    const entries = decodeDirectory(await read(offset, length), h.internalCompression);
    for (let i = 0; i < entries.length; i++) {
      const e = at(entries, i);
      const end = e.runLength ? e.tileId + e.runLength : (entries[i + 1]?.tileId ?? Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(end) || end <= e.tileId) throw new Error('map_directory');
      let pos = lowerBound(wanted, e.tileId);
      if (pos >= wanted.length || at(wanted, pos) >= end) continue;
      if (e.runLength === 0) {
        if (e.offset + e.length > (h.leafDirectoryLength ?? 0)) throw new Error('map_directory');
        await visit(h.leafDirectoryOffset + e.offset, e.length, depth + 1);
      } else {
        if (e.offset + e.length > (h.tileDataLength ?? 0) || e.length > 2 * 1024 * 1024) throw new Error('map_tile');
        while (pos < wanted.length && at(wanted, pos) < end) {
          const start = at(wanted, pos++); let last = start;
          while (pos < wanted.length && wanted[pos] === last + 1 && at(wanted, pos) < end) last = at(wanted, pos++);
          selected.push({ ...e, tileId: start, runLength: last - start + 1 });
          if (selected.length > 400_000) throw new Error('map_area_size');
        }
      }
    }
  };
  await visit(h.rootDirectoryOffset, h.rootDirectoryLength, 0);
  selected.sort((a, b) => a.tileId - b.tileId);
  if (!selected.length) throw new Error('map_empty');
  for (let i = 1; i < selected.length; i++) if (at(selected, i).tileId < at(selected, i - 1).tileId + at(selected, i - 1).runLength) throw new Error('map_directory');
  const unique = new Map<number, number>();
  for (const e of selected) {
    if (unique.has(e.offset) && unique.get(e.offset) !== e.length) throw new Error('map_tile');
    unique.set(e.offset, e.length);
  }
  const blobs = [...unique].sort((a, b) => a[0] - b[0]);
  const totalBytes = blobs.reduce((sum, blob) => sum + blob[1], 0);
  if (totalBytes > MAX_MAP_BYTES) throw new Error('map_size');
  const spool = await open(path + '.tiles', 'wx+', 0o600);
  const offsets = new Map<number, number>(); let written = 0;
  try {
    for (let i = 0; i < blobs.length;) {
      const start = at(blobs, i)[0]; let end = start + at(blobs, i)[1]; let next = i + 1;
      while (next < blobs.length && at(blobs, next)[0] <= end + 16_384 && at(blobs, next)[0] + at(blobs, next)[1] - start <= 4 * 1024 * 1024) {
        end = at(blobs, next)[0] + at(blobs, next)[1]; next++;
      }
      checkedRange(h.tileDataOffset + start, end - start, total);
      const bytes = await read(h.tileDataOffset + start, end - start);
      for (; i < next; i++) {
        const [offset, length] = at(blobs, i);
        const tile = bytes.subarray(offset - start, offset - start + length);
        if (tile.length !== length || unpack(tile, h.tileCompression).length === 0) throw new Error('map_tile');
        offsets.set(offset, written); await writeAll(spool, tile); written += length;
      }
      progress(Math.floor(written / totalBytes * 85));
    }
    for (const e of selected) { const offset = offsets.get(e.offset); if (offset === undefined) throw new Error('map_tile'); e.offset = offset; }
    const leaves: Buffer[] = []; const roots: Entry[] = []; let leafLength = 0;
    for (let i = 0; i < selected.length; i += 2048) {
      const leaf = encodeDirectory(selected.slice(i, i + 2048));
      roots.push({ tileId: at(selected, i).tileId, runLength: 0, offset: leafLength, length: leaf.length });
      leaves.push(leaf); leafLength += leaf.length;
    }
    const root = encodeDirectory(roots);
    if (root.length > 16384 - 127) throw new Error('map_directory');
    const header = Buffer.alloc(127); header.write('PMTiles'); header[7] = 3;
    const metadataOffset = 127 + root.length, leafOffset = metadataOffset + metadata.length, dataOffset = leafOffset + leafLength;
    const numbers = [127, root.length, metadataOffset, metadata.length, leafOffset, leafLength, dataOffset, written,
      selected.reduce((sum, e) => sum + e.runLength, 0), selected.length, blobs.length];
    numbers.forEach((n, i) => header.writeBigUInt64LE(BigInt(n), 8 + i * 8));
    header[96] = 0; header[97] = 2; header[98] = h.tileCompression; header[99] = 1; header[100] = 0; header[101] = h.maxZoom;
    areaBounds(area).forEach((n, i) => header.writeInt32LE(Math.round(n * 1e7), 102 + i * 4));
    header[118] = 9; header.writeInt32LE(Math.round(area.longitude * 1e7), 119); header.writeInt32LE(Math.round(area.latitude * 1e7), 123);
    const output = await open(path + '.new', 'wx', 0o600);
    try {
      await writeAll(output, header); await writeAll(output, root); await writeAll(output, metadata);
      for (const leaf of leaves) await writeAll(output, leaf);
      const block = Buffer.alloc(1024 * 1024);
      for (let position = 0; position < written;) {
        const { bytesRead } = await spool.read(block, 0, Math.min(block.length, written - position), position);
        if (!bytesRead) throw new Error('map_storage');
        await writeAll(output, block.subarray(0, bytesRead)); position += bytesRead;
      }
      await output.sync();
    } finally { await output.close(); }
    await rename(path + '.new', path);
    return { bytes: dataOffset + written, tiles: selected.length, maxZoom: h.maxZoom };
  } finally { await spool.close(); await unlink(path + '.tiles').catch(() => undefined); }
}

import { gzipSync, gunzipSync } from 'node:zlib';
import type { Entry } from 'pmtiles';
/** PMTiles v3 directory codec; all untrusted integers, counts and expansion are bounded. */
export function unpack(bytes: Buffer, compression: number): Buffer {
  if (compression === 1) return bytes;
  if (compression !== 2) throw new Error('map_compression');
  return gunzipSync(bytes, { maxOutputLength: 8 * 1024 * 1024 });
}
export function decodeDirectory(bytes: Buffer, compression: number): Entry[] {
  const data = unpack(bytes, compression); let pos = 0;
  const read = () => {
    let value = 0; let factor = 1;
    for (let i = 0; i < 8; i++) {
      const byte = data[pos++];
      if (byte === undefined) throw new Error('map_directory');
      value += (byte & 127) * factor;
      if (!Number.isSafeInteger(value)) throw new Error('map_directory');
      if (byte < 128) return value;
      factor *= 128;
    }
    throw new Error('map_directory');
  };
  const count = read();
  if (count < 1 || count > 100_000 || count * 4 > data.length) throw new Error('map_directory');
  const entries: Entry[] = []; let id = 0;
  for (let i = 0; i < count; i++) {
    const delta = read(); if (i > 0 && delta === 0) throw new Error('map_directory');
    id += delta;
    if (!Number.isSafeInteger(id)) throw new Error('map_directory');
    entries.push({ tileId: id, offset: 0, length: 0, runLength: 0 });
  }
  for (const e of entries) e.runLength = read();
  for (const e of entries) { e.length = read(); if (!e.length) throw new Error('map_directory'); }
  let previous: Entry | undefined;
  for (const e of entries) {
    const offset = read();
    if (offset === 0 && !previous) throw new Error('map_directory');
    e.offset = offset === 0 && previous ? previous.offset + previous.length : offset - 1;
    if (!Number.isSafeInteger(e.offset)) throw new Error('map_directory');
    previous = e;
  }
  if (pos !== data.length) throw new Error('map_directory');
  return entries;
}
export function encodeDirectory(entries: readonly Entry[]): Buffer {
  const out: number[] = [];
  const write = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('map_directory');
    while (n >= 128) { out.push(n % 128 + 128); n = Math.floor(n / 128); }
    out.push(n);
  };
  write(entries.length); let id = 0;
  for (const e of entries) { write(e.tileId - id); id = e.tileId; }
  for (const e of entries) write(e.runLength);
  for (const e of entries) write(e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]; if (!e) throw new Error('map_directory'); const previous = entries[i - 1];
    write(previous && e.offset === previous.offset + previous.length ? 0 : e.offset + 1);
  }
  return gzipSync(Buffer.from(out));
}

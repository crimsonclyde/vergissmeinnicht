import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentFileRejectedError } from '@vergissmeinnicht/application';
import { createDocumentFileProcessor, sniffFormat, type DocumentFileProcessorHandle } from './document-file-processor.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => join(FIXTURES, name);

/** A phone-like photo: gradient content, EXIF orientation 6 (rotate 90°), camera make and GPS coordinates. */
async function phonePhoto(width = 4032, height = 3024): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = x < width / 2 ? 30 : 220; // left/right halves tell the orientation
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 36/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG whose header claims `width`×`height` but whose data is tiny (a decompression bomb). */
function pngClaiming(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.alloc(16))), pngChunk('IEND', Buffer.alloc(0))]);
}

/** A minimal one-page PDF whose page claims to be `points` wide and high, with `content` as its drawing. */
function pdf(points: number, content = '0 0 100 100 re f'): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${points} ${points}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('document file processing (16.1)', () => {
  let dir: string;
  let processor: DocumentFileProcessorHandle;
  let counter = 0;
  /** Writes test bytes to a file, as the store's staging area would hold an upload. */
  const file = (bytes: Uint8Array) => {
    const path = join(dir, `upload-${++counter}`);
    writeFileSync(path, bytes);
    return path;
  };
  const inspect = (path: string) => processor.inspect(path, readFileSync(path).byteLength);
  const rejection = async (bytes: Uint8Array | string) => {
    try {
      await inspect(typeof bytes === 'string' ? bytes : file(bytes));
      return 'accepted';
    } catch (error) {
      return error instanceof DocumentFileRejectedError ? error.code : `unexpected: ${(error as Error).message}`;
    }
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-document-processor-'));
    processor = createDocumentFileProcessor();
  });
  afterAll(async () => {
    await processor.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('identifies the four formats from their first bytes only', () => {
    expect(sniffFormat(Buffer.from('%PDF-1.7\n'))).toBe('PDF');
    expect(sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('JPEG');
    expect(sniffFormat(pngClaiming(1, 1))).toBe('PNG');
    expect(sniffFormat(readFileSync(fixture('photo.heic')).subarray(0, 32))).toBe('HEIC');
    expect(sniffFormat(Buffer.from('\n%PDF-1.7'))).toBeUndefined(); // a signature further in is not a signature
    expect(sniffFormat(Buffer.from('    ftypavif'))).toBeUndefined(); // AVIF is not HEIC
    expect(sniffFormat(Buffer.from('PK\u0003\u0004'))).toBeUndefined();
    expect(sniffFormat(new Uint8Array(0))).toBeUndefined();
  });

  it('accepts a phone photo as it is and derives an upright preview without EXIF or GPS', async () => {
    const original = await phonePhoto();
    const path = file(original);
    expect(await inspect(path)).toEqual({ format: 'JPEG', pageCount: 1, width: 3024, height: 4032, encrypted: false, activeContent: false });
    const preview = await processor.renderPage(path, 'JPEG', 0);
    if (preview === undefined) throw new Error('no preview');
    expect([preview.width, preview.height]).toEqual([1800, 2400]); // upright, long edge 2400
    const metadata = await sharp(preview.jpeg).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(Buffer.from(preview.jpeg).includes('Apple')).toBe(false);
    expect(Buffer.from(preview.jpeg).includes('GPS')).toBe(false);
    // Upright: the dark half of the original's left side is now at the top.
    const { data } = await sharp(preview.jpeg).resize(2, 2, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    expect(data[2]).toBeLessThan(100);
    expect(data[2 + 6]).toBeGreaterThan(150);
    // The original was only read: its bytes, metadata included, are untouched.
    expect(readFileSync(path)).toEqual(original);
    expect((await sharp(path).metadata()).exif).toBeDefined();
    const thumbnail = await processor.thumbnail(preview.jpeg);
    expect([thumbnail.width, thumbnail.height]).toEqual([300, 400]);
    expect((await sharp(thumbnail.jpeg).metadata()).exif).toBeUndefined();
    expect(await processor.renderPage(path, 'JPEG', 1)).toBeUndefined(); // an image has one page
  }, 30_000);

  it('never upscales and flattens transparency onto white', async () => {
    const path = file(await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    expect(await inspect(path)).toMatchObject({ format: 'PNG', width: 300, height: 200 });
    const preview = await processor.renderPage(path, 'PNG', 0);
    if (preview === undefined) throw new Error('no preview');
    expect([preview.width, preview.height]).toEqual([300, 200]);
    const { data } = await sharp(preview.jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
  });

  it('keeps small print legible: fine detail of an A4 scan survives in the preview', async () => {
    // A 300 dpi A4 page with 4-pixel black and white stripes — finer than the strokes of 6 pt print.
    const width = 2480;
    const height = 3508;
    const raw = Buffer.alloc(width * height);
    for (let y = 0; y < height; y++) raw.fill(Math.floor(y / 4) % 2 === 0 ? 0 : 255, y * width, (y + 1) * width);
    const path = file(await sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer());
    const preview = await processor.renderPage(path, 'PNG', 0);
    if (preview === undefined) throw new Error('no preview');
    expect(preview.height).toBe(2400); // more than 200 px per inch of an A4 page
    const { data, info } = await sharp(preview.jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
    const column = Array.from({ length: 200 }, (_, y) => data[(1000 + y) * info.width + 500] ?? 0);
    expect(Math.max(...column) - Math.min(...column)).toBeGreaterThan(150); // stripes are still dark and light, not grey
  }, 30_000);

  it('reads a PDF: page count, previews of single pages at 200 dpi, as plain images', async () => {
    const path = fixture('three-pages.pdf');
    expect(await inspect(path)).toEqual({ format: 'PDF', pageCount: 3, width: null, height: null, encrypted: false, activeContent: false });
    const first = await processor.renderPage(path, 'PDF', 0);
    const third = await processor.renderPage(path, 'PDF', 2);
    if (first === undefined || third === undefined) throw new Error('no preview');
    expect([first.width, first.height]).toEqual([1653, 2339]); // A4 at 200 dpi
    const metadata = await sharp(first.jpeg).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(Buffer.from(first.jpeg).equals(Buffer.from(third.jpeg))).toBe(false);
    expect(await processor.renderPage(path, 'PDF', 3)).toBeUndefined(); // no such page
    // The 6 pt line of the fixture is drawn: its row is not blank.
    const { data, info } = await sharp(first.jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
    const row = Math.round(((842 - 762) / 842) * info.height);
    const line = Array.from({ length: info.width }, (_, x) => data[row * info.width + x] ?? 255);
    expect(Math.min(...line)).toBeLessThan(120);
  });

  it('keeps password-protected PDFs without a preview, and marks PDFs with scripts or embedded files', async () => {
    expect(await inspect(fixture('encrypted.pdf'))).toEqual({ format: 'PDF', pageCount: null, width: null, height: null, encrypted: true, activeContent: false });
    expect(await processor.renderPage(fixture('encrypted.pdf'), 'PDF', 0)).toBeUndefined();
    for (const name of ['javascript.pdf', 'embedded-file.pdf']) {
      expect(await inspect(fixture(name))).toMatchObject({ format: 'PDF', encrypted: false, activeContent: true });
      // The preview is a picture of the page: nothing of the script or the attachment is in it.
      const preview = await processor.renderPage(fixture(name), 'PDF', 0);
      expect(preview === undefined ? undefined : (await sharp(preview.jpeg).metadata()).format).toBe('jpeg');
      expect(Buffer.from(preview?.jpeg ?? []).includes('app.alert')).toBe(false);
    }
  });

  it('bounds the preview of a PDF page whatever size the page claims', async () => {
    const path = file(pdf(14_400)); // 200 inches: 40 000 px at 200 dpi if it were drawn as claimed
    expect(await inspect(path)).toMatchObject({ format: 'PDF', pageCount: 1 });
    const preview = await processor.renderPage(path, 'PDF', 0);
    expect(preview === undefined ? undefined : [preview.width, preview.height]).toEqual([2400, 2400]);
  });

  it('accepts an iPhone HEIC from its container alone, never changes it, and offers no preview', async () => {
    const path = fixture('photo.heic');
    const before = readFileSync(path);
    expect(await inspect(path)).toEqual({ format: 'HEIC', pageCount: 1, width: 320, height: 240, encrypted: false, activeContent: false });
    // No HEVC decoder is shipped (HT1): a preview is not attempted, and that is no reason to refuse the file.
    expect(await processor.renderPage(path, 'HEIC', 0)).toBeUndefined();
    expect(readFileSync(path)).toEqual(before);
    // Validation needs no decoding: a HEIC whose coded image data is damaged is still a HEIC …
    const damaged = Buffer.from(before);
    damaged.fill(0x55, damaged.length - 400);
    expect(await inspect(file(damaged))).toMatchObject({ format: 'HEIC', width: 320, height: 240 });
    // … while a broken container, or one that claims an absurd size, is refused.
    expect(await rejection(before.subarray(0, 200))).toBe('unreadable');
    const huge = Buffer.from(before);
    const ispe = huge.indexOf('ispe');
    huge.writeUInt32BE(20_000, ispe + 8);
    huge.writeUInt32BE(20_000, ispe + 12);
    expect(await rejection(huge)).toBe('too_many_pixels');
  });

  it('refuses everything that is not one of the four formats, whatever it is called', async () => {
    const exe = Buffer.concat([Buffer.from('MZ\u0090\u0000', 'latin1'), Buffer.alloc(200)]);
    writeFileSync(join(dir, 'setup.pdf'), exe); // an .exe renamed to .pdf
    expect(await rejection(join(dir, 'setup.pdf'))).toBe('unsupported_format');
    expect(await rejection(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe('unsupported_format');
    expect(await rejection(Buffer.from('<!doctype html><html><body>hello</body></html>'))).toBe('unsupported_format');
    expect(await rejection(Buffer.concat([Buffer.from('PK\u0003\u0004', 'latin1'), Buffer.alloc(64)]))).toBe('unsupported_format'); // ZIP, also .docx/.xlsx
    expect(await rejection(Buffer.from('#!/bin/sh\nrm -rf /\n'))).toBe('unsupported_format');
    expect(await rejection(Buffer.from('GIF89a'))).toBe('unsupported_format');
    expect(await rejection(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer())).toBe('unsupported_format');
    expect(await rejection(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).avif().toBuffer())).toBe('unsupported_format');
    expect(await rejection(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).tiff().toBuffer())).toBe('unsupported_format');
    expect(await processor.inspect(file(Buffer.from('%PDF-1.4')), 0).catch((error: DocumentFileRejectedError) => error.code)).toBe('empty');
  });

  it('refuses polyglots: files that are an image and a web page at once', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#aa3300' } }).jpeg().toBuffer();
    expect(await rejection(Buffer.concat([jpeg, Buffer.from('<html><script>alert(1)</script></html>')]))).toBe('suspicious_content');
    expect(await rejection(Buffer.concat([jpeg, Buffer.from('<ScRiPt src=//evil.example></sCrIpT>')]))).toBe('suspicious_content');
    // HTML first, image data after: not an image at all.
    expect(await rejection(Buffer.concat([Buffer.from('<html><!--'), jpeg]))).toBe('unsupported_format');
    // Markup hidden in a metadata chunk of a PNG.
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer();
    const withText = Buffer.concat([png.subarray(0, 33), pngChunk('tEXt', Buffer.from('Comment\0<!DOCTYPE html><iframe src=x>', 'latin1')), png.subarray(33)]);
    expect(await rejection(withText)).toBe('suspicious_content');
    // A token split across the reader's chunk boundary is still found.
    const padded = Buffer.concat([jpeg, Buffer.alloc((1 << 20) - jpeg.length - 3, 0x20), Buffer.from('<script>x</script>')]);
    expect(await rejection(padded)).toBe('suspicious_content');
    // Ordinary metadata is not markup: a photo with EXIF and GPS passes.
    expect(await rejection(await phonePhoto(400, 300))).toBe('accepted');
  });

  it('refuses images above the pixel limit before decoding, and damaged files', async () => {
    expect(await rejection(pngClaiming(20_000, 20_000))).toBe('too_many_pixels');
    const bomb = file(pngClaiming(7000, 7000)); // within the limit, but the data does not hold what the header claims
    expect(await processor.renderPage(bomb, 'PNG', 0)).toBeUndefined();
    const jpeg = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    expect(await processor.renderPage(file(jpeg.subarray(0, 300)), 'JPEG', 0)).toBeUndefined(); // truncated
    expect(await rejection(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('unreadable');
    expect(await rejection(Buffer.from('%PDF-1.7\nthis is not a PDF at all'))).toBe('unreadable');
    expect(await rejection(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(40)]))).toBe('unreadable');
  });

  it('ends a job that takes too long and keeps working afterwards', async () => {
    const impatient = createDocumentFileProcessor({ worker: { timeoutMs: 1 } });
    try {
      // Starting the worker thread alone takes longer than a millisecond.
      await expect(impatient.inspect(fixture('three-pages.pdf'), 3766)).rejects.toMatchObject({ code: 'too_complex' });
      await expect(impatient.renderPage(fixture('three-pages.pdf'), 'PDF', 0)).rejects.toMatchObject({ code: 'too_complex' });
    } finally {
      await impatient.close();
    }
    // A stopped worker is replaced: the shared processor still answers.
    expect(await inspect(fixture('three-pages.pdf'))).toMatchObject({ pageCount: 3 });
  });

  it('relies on a parser whose own memory cannot exceed 2 GiB (the bound the memory watchdog does not give)', () => {
    // Read from the shipped WebAssembly binary: its memory section declares the maximum in 64 KiB pages.
    const wasm = readFileSync(join(import.meta.dirname, '../node_modules/mupdf/dist/mupdf-wasm.wasm'));
    let at = 8;
    const leb = () => {
      let value = 0;
      for (let shift = 0; ; shift += 7) {
        const byte = wasm[at++] ?? 0;
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return value;
      }
    };
    let maximumPages: number | undefined;
    while (at < wasm.length && maximumPages === undefined) {
      const id = wasm[at++];
      const end = leb() + at;
      if (id === 5) {
        leb(); // number of memories
        const flags = leb();
        leb(); // initial pages
        maximumPages = (flags & 1) === 1 ? leb() : Number.POSITIVE_INFINITY;
      }
      at = end;
    }
    expect(maximumPages).toBeLessThanOrEqual(32_768); // 2 GiB; an upgrade that raises it must be reviewed
  });

  it('stops a job through the memory watchdog (forced here; in production it is best effort)', async () => {
    const frugal = createDocumentFileProcessor({ worker: { maxMemoryGrowthBytes: -1e12, timeoutMs: 20_000 } });
    try {
      // Any growth is "too much" here; a page with heavy drawing keeps the worker busy long enough to be measured.
      const heavy = file(pdf(600, Array.from({ length: 200_000 }, (_, i) => `${i % 600} ${(i * 7) % 600} 3 3 re f`).join('\n')));
      await expect(frugal.renderPage(heavy, 'PDF', 0)).rejects.toMatchObject({ code: 'too_complex' });
    } finally {
      await frugal.close();
    }
  }, 30_000);
});

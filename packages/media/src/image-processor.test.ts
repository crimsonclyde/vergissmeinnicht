import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageRejectedError } from '@vergissmeinnicht/application';
import { createSharpImageProcessor } from './image-processor.ts';

const processor = createSharpImageProcessor();
const rejection = async (input: Uint8Array) => {
  try {
    await processor.process(input);
    return 'accepted';
  } catch (error) {
    return error instanceof ImageRejectedError ? error.code : `unexpected: ${(error as Error).message}`;
  }
};

/** A phone-like photo: gradient content, EXIF orientation 6 (rotate 90°) and GPS coordinates. */
async function phonePhoto(): Promise<Uint8Array> {
  const width = 4032;
  const height = 3024;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = x < width / 2 ? 30 : 220; // left/right halves tell the orientation
    }
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 92 })
      .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 12/1', GPSLongitudeRef: 'E', GPSLongitude: '13/1 24/1 36/1' } })
      .withMetadata({ orientation: 6 })
      .toBuffer(),
  );
}

/** A PNG whose header claims `width`×`height` but whose data is tiny (a decompression bomb). */
function pngClaiming(width: number, height: number): Uint8Array {
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
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // RGB
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(16))), chunk('IEND', Buffer.alloc(0))]));
}

/** A two-frame animated WebP, assembled from two single-frame WebPs (RIFF: VP8X + ANIM + ANMF chunks). */
async function animatedWebp(): Promise<Uint8Array> {
  const size = 64;
  const frame = async (colour: string) => (await sharp({ create: { width: size, height: size, channels: 3, background: colour } }).webp({ lossless: true }).toBuffer()).subarray(12);
  const u24 = (value: number) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const vp8x = chunk('VP8X', Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(size - 1), u24(size - 1)]));
  const anim = chunk('ANIM', Buffer.from([0, 0, 0, 0, 0, 0]));
  const anmf = async (colour: string) => chunk('ANMF', Buffer.concat([u24(0), u24(0), u24(size - 1), u24(size - 1), u24(100), Buffer.from([0]), await frame(colour)]));
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), vp8x, anim, await anmf('#336699'), await anmf('#993366')]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return new Uint8Array(Buffer.concat([riff, body]));
}

describe('instruction image processing (14.3)', () => {
  it('stores a phone photo upright, as JPEG, ≤1600 px, ≤500 KB and without EXIF/GPS', async () => {
    const photo = await phonePhoto();
    const input = await sharp(photo).metadata();
    expect(input.orientation).toBe(6);
    expect(Buffer.from(photo).includes('iPhone')).toBe(true);
    expect(input.exif?.includes(Buffer.from('GPS')) || (input.exif?.byteLength ?? 0) > 100).toBe(true);
    const result = await processor.process(photo);
    const stored = await sharp(result.jpeg).metadata();
    expect(stored.format).toBe('jpeg');
    // Orientation 6 applied: the 4032×3024 landscape becomes portrait.
    expect([result.width, result.height]).toEqual([1200, 1600]);
    expect([stored.width, stored.height]).toEqual([1200, 1600]);
    expect(result.jpeg.byteLength).toBeLessThanOrEqual(500_000);
    expect(stored.exif).toBeUndefined();
    expect(stored.orientation).toBeUndefined();
    expect(stored.xmp).toBeUndefined();
    expect(Buffer.from(result.jpeg).includes('iPhone')).toBe(false);
  }, 30_000);

  it('never upscales and flattens transparency onto white', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const result = await processor.process(new Uint8Array(png));
    expect([result.width, result.height]).toEqual([800, 600]);
    const { data } = await sharp(result.jpeg).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(245); // white, not black
  });

  it('refuses an image that cannot reach the size limit within the legibility floors', async () => {
    const noise = Buffer.alloc(1600 * 1600 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256);
    const png = await sharp(noise, { raw: { width: 1600, height: 1600, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    // With a small limit the floors (quality 60, 1024 px) are reached and the upload is refused.
    const strict = createSharpImageProcessor({ maxStoredBytes: 50_000 });
    await expect(strict.process(new Uint8Array(png))).rejects.toMatchObject({ code: 'too_complex' });
    // With the real 500 KB limit even noise fits at the floors: it is stored, never larger than allowed.
    expect((await processor.process(new Uint8Array(png))).jpeg.byteLength).toBeLessThanOrEqual(500_000);
  }, 30_000);

  it('identifies the format from the content and refuses everything else', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(await rejection(svg)).toBe('unsupported_format');
    expect(await rejection(new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF'))).toBe('unreadable');
    expect(await rejection(new Uint8Array(0))).toBe('unreadable');
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0, ...new TextEncoder().encode('mif1heic')]);
    expect(await rejection(heic)).toBe('heic_unsupported');
    expect(await rejection(new Uint8Array(10_000_001))).toBe('too_large');
    expect(await rejection(pngClaiming(20_000, 20_000))).toBe('too_many_pixels');
    const animated = await animatedWebp();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    expect(await rejection(animated)).toBe('animated');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
    expect(await rejection(new Uint8Array(gif))).toBe('unsupported_format');
  });

  it('re-encodes a JPEG/HTML polyglot: nothing but image data leaves', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#aa3300' } }).jpeg().toBuffer();
    const polyglot = new Uint8Array(Buffer.concat([jpeg, Buffer.from('<html><script>alert(1)</script></html>')]));
    const result = await processor.process(polyglot);
    expect(Buffer.from(result.jpeg).includes('<script>')).toBe(false);
  });
});

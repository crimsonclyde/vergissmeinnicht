import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { ImageRejectedError, type ImageProcessor, type ProcessedImage } from '@vergissmeinnicht/application';
import { MAX_IMAGE_EDGE, MAX_IMAGE_PIXELS, MAX_IMAGE_UPLOAD_BYTES, MAX_STORED_IMAGE_BYTES } from '@vergissmeinnicht/domain';

/**
 * Encoding attempts, in order: JPEG quality from 80 down to a floor of 60 at the full size, then smaller
 * long edges down to a floor of 1024 px at quality 70 — the floors keep valves, switches and printed
 * labels legible. The first result within the stored-size limit wins.
 */
export const ENCODING_ATTEMPTS: readonly { readonly edge: number; readonly quality: number }[] = [
  { edge: MAX_IMAGE_EDGE, quality: 80 },
  { edge: MAX_IMAGE_EDGE, quality: 75 },
  { edge: MAX_IMAGE_EDGE, quality: 70 },
  { edge: MAX_IMAGE_EDGE, quality: 65 },
  { edge: MAX_IMAGE_EDGE, quality: 60 },
  { edge: 1400, quality: 70 },
  { edge: 1200, quality: 70 },
  { edge: 1024, quality: 70 },
];

/** Formats accepted as input (identified from the content, never from the name or declared type). */
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);
/** HEIF/HEIC brands in the ISO base media `ftyp` box (bytes 4–11): iPhone photos, identified from the content. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'avci']);

function isHeif(input: Uint8Array): boolean {
  if (input.byteLength < 12) return false;
  const text = (from: number, to: number) => String.fromCharCode(...input.subarray(from, to));
  return text(4, 8) === 'ftyp' && HEIF_BRANDS.has(text(8, 12));
}

/** At most this many images are processed at the same time (bounded memory and CPU). */
const MAX_PARALLEL = 2;

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// libvips' own thread pool per image; parallelism is bounded by the slots above.
sharp.concurrency(1);
sharp.cache(false);

const decoder = (input: Uint8Array) => sharp(input, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true });

/**
 * Instruction images with sharp/libvips (14.3, T2): identify the format from the content, refuse HEIC
 * (not decodable by the prebuilt libvips — T3), animated or multi-page images and images above the
 * pixel limit; apply the EXIF orientation *before* all metadata is dropped (libvips writes none unless
 * asked); flatten transparency onto white; convert to sRGB; shrink to ≤1600 px without upscaling;
 * encode JPEG within 500 KB. Only the processed JPEG leaves this function.
 */
export function createSharpImageProcessor(options: { readonly maxStoredBytes?: number } = {}): ImageProcessor {
  const maxStoredBytes = options.maxStoredBytes ?? MAX_STORED_IMAGE_BYTES;
  return {
    async process(input: Uint8Array): Promise<ProcessedImage> {
      if (input.byteLength > MAX_IMAGE_UPLOAD_BYTES) throw new ImageRejectedError('too_large');
      if (input.byteLength === 0) throw new ImageRejectedError('unreadable');
      if (isHeif(input)) throw new ImageRejectedError('heic_unsupported');
      return withSlot(async () => {
        let metadata: Metadata;
        try {
          // Header only (nothing is decoded yet): a file claiming huge dimensions is refused before decoding.
          metadata = await sharp(input, { failOn: 'none', limitInputPixels: false }).metadata();
        } catch {
          throw new ImageRejectedError('unreadable');
        }
        if (metadata.format === 'heif') throw new ImageRejectedError('heic_unsupported');
        if (metadata.format === undefined || !ACCEPTED.has(metadata.format)) throw new ImageRejectedError('unsupported_format');
        if ((metadata.pages ?? 1) > 1) throw new ImageRejectedError('animated');
        if (metadata.width === undefined || metadata.height === undefined) throw new ImageRejectedError('unreadable');
        if (metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new ImageRejectedError('too_many_pixels');
        for (const attempt of ENCODING_ATTEMPTS) {
          let result: { data: Buffer; info: OutputInfo };
          try {
            result = await decoder(input)
              .rotate()
              .flatten({ background: '#ffffff' })
              .toColourspace('srgb')
              .resize({ width: attempt.edge, height: attempt.edge, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: attempt.quality, mozjpeg: true })
              .toBuffer({ resolveWithObject: true });
          } catch {
            throw new ImageRejectedError('unreadable');
          }
          if (result.data.byteLength <= maxStoredBytes) {
            return { jpeg: new Uint8Array(result.data), width: result.info.width, height: result.info.height };
          }
        }
        throw new ImageRejectedError('too_complex');
      });
    },
  };
}

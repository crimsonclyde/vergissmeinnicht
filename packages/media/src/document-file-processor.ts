import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { DocumentFileRejectedError, type DocumentFileProcessor, type InspectedFile, type RenderedImage } from '@vergissmeinnicht/application';
import { MAX_DOCUMENT_IMAGE_PIXELS, PDF_PREVIEW_DPI, PREVIEW_MAX_EDGE, THUMBNAIL_MAX_EDGE, type DocumentFileFormat } from '@vergissmeinnicht/domain';
import { WorkerJobError, createDocumentWorker, type DocumentWorker, type DocumentWorkerOptions } from './document-worker-host.ts';

/** HEIF brands of HEVC-coded images (iPhone photos) in the `ftyp` box; AVIF and other brands are not accepted. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The format, from the first bytes only: each accepted format has a signature **at offset 0**. A file
 * that merely contains one further in — the usual shape of a polyglot — or carries anything else
 * (executables, HTML, SVG, archives, office files) is not one of the four formats.
 */
export function sniffFormat(head: Uint8Array): DocumentFileFormat | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 5) === '%PDF-') return 'PDF';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'JPEG';
  if (PNG_SIGNATURE.every((byte, index) => head[index] === byte)) return 'PNG';
  if (head.byteLength >= 12 && ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12))) return 'HEIC';
  return undefined;
}

/** What only a web page would contain. Photos and scans do not; a file that does is two things at once. */
const MARKUP = ['<script', '<html', '<!doctype html', '<iframe'];

/** Looks through the whole file (in pieces, with an overlap) for HTML markup, ignoring case. */
async function containsMarkup(path: string): Promise<boolean> {
  let carry = '';
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    const text = carry + (chunk as Buffer).toString('latin1').toLowerCase();
    if (MARKUP.some((token) => text.includes(token))) return true;
    carry = text.slice(-16);
  }
  return false;
}

async function readHead(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r');
  try {
    const head = new Uint8Array(32);
    const { bytesRead } = await handle.read(head, 0, 32, 0);
    return head.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** At most this many images are decoded by libvips at the same time (bounded memory and CPU), as in 14.3. */
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

/** Upright, opaque, sRGB, no larger than `edge`, and — as libvips writes none unless asked — without any metadata. */
async function toJpeg(image: Sharp, edge: number, quality: number): Promise<RenderedImage> {
  const { data, info } = await image
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: new Uint8Array(data), width: info.width, height: info.height };
}

export interface DocumentFileProcessorHandle extends DocumentFileProcessor {
  /** Stops the worker thread (shutdown, tests). */
  close(): Promise<void>;
}

/**
 * Document files (16.1): identifies a file from its content, validates it and derives previews — the
 * original itself is never changed and never leaves through this code. Images are read by sharp/libvips
 * (as instruction images, 14.3); PDFs by MuPDF as WebAssembly in a worker thread with a time limit and
 * a memory watchdog (HT3). HEIC files are validated by their container only and get no preview (HT1).
 * Every preview is a re-encoded, metadata-free JPEG.
 */
export function createDocumentFileProcessor(options: { readonly worker?: DocumentWorkerOptions; readonly pdfWorker?: DocumentWorker } = {}): DocumentFileProcessorHandle {
  // The PDF worker may be shared with text recognition (16.9), so PDFs are parsed in one thread.
  const worker: DocumentWorker = options.pdfWorker ?? createDocumentWorker(options.worker);

  /** Parser failures become refusals with a stable code; a timeout or memory stop is `too_complex`. */
  const refusal = (error: unknown): DocumentFileRejectedError =>
    new DocumentFileRejectedError(error instanceof WorkerJobError && error.code === 'too_complex' ? 'too_complex' : 'unreadable');

  async function inspectImage(path: string, format: 'JPEG' | 'PNG' | 'HEIC'): Promise<InspectedFile> {
    if (await containsMarkup(path)) throw new DocumentFileRejectedError('suspicious_content');
    let metadata: Metadata;
    try {
      // Header and container structure only: nothing is decoded, so claimed dimensions are checked first.
      // For HEIC this is all the validation there is: libvips reads the ISO container (boxes, item
      // properties, coding type, size) with its bundled libheif, which has no HEVC decoder.
      metadata = await sharp(path, { failOn: 'none', limitInputPixels: false }).metadata();
    } catch {
      throw new DocumentFileRejectedError('unreadable');
    }
    const expected = format === 'HEIC' ? 'heif' : format.toLowerCase();
    if (metadata.format !== expected) throw new DocumentFileRejectedError('unsupported_format');
    // An HEIF container may also hold AV1 (AVIF): only HEVC-coded images are accepted as HEIC.
    if (format === 'HEIC' && metadata.compression !== 'hevc') throw new DocumentFileRejectedError('unsupported_format');
    if (format !== 'HEIC' && (metadata.pages ?? 1) > 1) throw new DocumentFileRejectedError('unsupported_format');
    const width = metadata.autoOrient?.width ?? metadata.width;
    const height = metadata.autoOrient?.height ?? metadata.height;
    if (width === undefined || height === undefined || width < 1 || height < 1) throw new DocumentFileRejectedError('unreadable');
    if (width * height > MAX_DOCUMENT_IMAGE_PIXELS) throw new DocumentFileRejectedError('too_many_pixels');
    return { format, pageCount: 1, width, height, encrypted: false, activeContent: false };
  }

  return {
    async inspect(path, bytes) {
      if (bytes === 0) throw new DocumentFileRejectedError('empty');
      const format = sniffFormat(await readHead(path));
      if (format === undefined) throw new DocumentFileRejectedError('unsupported_format');
      if (format !== 'PDF') return inspectImage(path, format);
      try {
        const { encrypted, pageCount, activeContent } = await worker.run({ op: 'inspectPdf', path });
        return { format, pageCount, width: null, height: null, encrypted, activeContent };
      } catch (error) {
        throw refusal(error);
      }
    },

    async renderPage(path, format, page) {
      if (format === 'PDF') {
        try {
          const { jpeg, width, height } = await worker.run({ op: 'renderPdfPage', path, page, dpi: PDF_PREVIEW_DPI, maxEdge: PREVIEW_MAX_EDGE });
          return { jpeg, width, height };
        } catch (error) {
          if (error instanceof WorkerJobError && error.code === 'too_complex') throw refusal(error);
          return undefined;
        }
      }
      if (page !== 0) return undefined;
      // HEIC: no preview. Decoding it needs an HEVC decoder, which is not shipped pending a licensing
      // and patent review (steps.md HT1). The original is kept and downloadable all the same.
      if (format === 'HEIC') return undefined;
      try {
        return await withSlot(() => toJpeg(sharp(path, { failOn: 'error', limitInputPixels: MAX_DOCUMENT_IMAGE_PIXELS, sequentialRead: true }), PREVIEW_MAX_EDGE, 82));
      } catch {
        return undefined;
      }
    },

    async thumbnail(preview) {
      return withSlot(() => toJpeg(sharp(preview, { failOn: 'error' }), THUMBNAIL_MAX_EDGE, 78));
    },

    close: () => worker.close(),
  };
}

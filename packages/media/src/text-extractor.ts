import sharp from 'sharp';
import { TextExtractionError, type TextExtractor } from '@vergissmeinnicht/application';
import { MAX_DOCUMENT_IMAGE_PIXELS } from '@vergissmeinnicht/domain';
import { WorkerJobError, createWorkerHost, type DocumentWorker, type WorkerHost } from './document-worker-host.ts';
import type { TextWorkerJob, TextWorkerResult } from './text-worker.ts';

/** PDF pages are drawn at this resolution for OCR — finer than a preview: small print needs it (HT9). */
export const OCR_DPI = 300;
/** Longest edge of an image given to OCR (an A4 page at about 250 dpi; measured in HT9). */
export const OCR_MAX_EDGE = 3000;
/** One page of OCR may take this long (about 2 s on the development machine; slower hosts get room). */
export const OCR_TIMEOUT_MS = 120_000;

export interface TextExtractorHandle extends TextExtractor {
  /** Stops the OCR worker thread (shutdown, tests). The MuPDF worker belongs to the caller. */
  close(): Promise<void>;
}

const failure = (error: unknown): TextExtractionError => {
  if (error instanceof WorkerJobError) return new TextExtractionError(error.code === 'too_complex' ? 'too_complex' : error.code === 'unavailable' ? 'unavailable' : 'unreadable');
  return new TextExtractionError('unreadable');
};

/**
 * Text of document files (16.9) on this server only. Embedded PDF text and the page images for OCR
 * come from MuPDF in its worker thread (HT10, shared with the previews, so PDFs are still parsed in one
 * place); photos are decoded by sharp into a bounded grayscale PNG. OCR runs in a worker thread of its
 * own (HT9), one page at a time, ended after `OCR_TIMEOUT_MS`; the thread stops when idle and returns
 * its memory (about 255 MB while it runs). Nothing makes a network connection.
 */
export function createTextExtractor(options: { readonly pdf: DocumentWorker; readonly tessdataPath: string; readonly timeoutMs?: number }): TextExtractorHandle {
  const ocr: WorkerHost<TextWorkerJob, TextWorkerResult> = createWorkerHost<TextWorkerJob, TextWorkerResult>(
    { url: new URL('./text-worker.ts', import.meta.url), workerData: { tessdataPath: options.tessdataPath } },
    { timeoutMs: options.timeoutMs ?? OCR_TIMEOUT_MS },
  );

  async function recognize(png: Uint8Array): Promise<string> {
    try {
      return (await ocr.run({ op: 'ocr', png })).text;
    } catch (error) {
      throw failure(error);
    }
  }

  return {
    async pdfPageText(path, page) {
      try {
        return (await options.pdf.run({ op: 'pdfPageText', path, page })).text;
      } catch (error) {
        throw failure(error);
      }
    },

    async recognizePdfPage(path, page) {
      let png: Uint8Array;
      try {
        png = (await options.pdf.run({ op: 'renderPdfPageGray', path, page, dpi: OCR_DPI, maxEdge: OCR_MAX_EDGE })).png;
      } catch (error) {
        throw failure(error);
      }
      return recognize(png);
    },

    async recognizeImage(path) {
      let png: Uint8Array;
      try {
        // Upright (EXIF), gray, bounded; a PNG that only this server made is all the engine ever reads.
        png = new Uint8Array(
          await sharp(path, { failOn: 'error', limitInputPixels: MAX_DOCUMENT_IMAGE_PIXELS })
            .rotate()
            .flatten({ background: '#ffffff' })
            .grayscale()
            .resize({ width: OCR_MAX_EDGE, height: OCR_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: 1 })
            .toBuffer(),
        );
      } catch {
        throw new TextExtractionError('unreadable');
      }
      return recognize(png);
    },

    close: () => ocr.close(),
  };
}

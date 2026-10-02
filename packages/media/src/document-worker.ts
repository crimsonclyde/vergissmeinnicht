// Runs in a worker thread (see document-worker-host.ts): the only place where PDFs are parsed. MuPDF
// is a WebAssembly build, so a memory-safety bug in it stays inside the module's own memory, and that
// memory cannot grow beyond the 2 GiB the module declares. The host ends this thread when a job runs
// too long, and — as a watchdog, not a guarantee — when the process grows too much. Nothing here opens
// a network connection or writes a file.
import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import * as mupdf from 'mupdf';

export type WorkerJob =
  | { readonly op: 'inspectPdf'; readonly path: string }
  | { readonly op: 'renderPdfPage'; readonly path: string; readonly page: number; readonly dpi: number; readonly maxEdge: number };

export type WorkerResult =
  | { readonly op: 'inspectPdf'; readonly encrypted: boolean; readonly pageCount: number | null; readonly activeContent: boolean }
  | { readonly op: 'renderPdfPage'; readonly jpeg: Uint8Array; readonly width: number; readonly height: number };

/** Failures a file can cause; anything else is a bug and reported as `failed`. */
export type WorkerFailure = 'unreadable' | 'failed';

class Refused extends Error {
  readonly code: WorkerFailure;
  constructor(code: WorkerFailure) {
    super(code);
    this.code = code;
  }
}

// A parser may print diagnostics about the files it reads; a hostile file must not be able to write to
// the server log, so this thread's console is silent.
console.log = console.info = console.warn = console.error = () => undefined;

// MuPDF reports repairs of damaged files as warnings: they are expected for hostile input and say
// nothing an operator needs, so they are dropped rather than written to the server log.
mupdf.setLog(() => undefined);
// Colour management is not needed for previews and is one more parser (ICC profiles) on hostile input.
mupdf.disableICC();

let opened: { readonly path: string; readonly document: mupdf.Document } | undefined;

function documentAt(path: string): mupdf.Document {
  if (opened?.path === path) return opened.document;
  opened?.document.destroy();
  opened = undefined;
  mupdf.emptyStore();
  let document: mupdf.Document;
  try {
    document = mupdf.Document.openDocument(readFileSync(path), 'application/pdf');
  } catch {
    throw new Refused('unreadable');
  }
  opened = { path, document };
  return document;
}

function hasActiveContent(document: mupdf.PDFDocument): boolean {
  const root = document.getTrailer().get('Root');
  if (!root.isDictionary()) return false;
  const present = (object: mupdf.PDFObject, key: string) => object.isDictionary() && !object.get(key).isNull();
  const names = root.get('Names');
  const action = root.get('OpenAction');
  const scriptedAction = action.isDictionary() && action.get('S').isName() && action.get('S').asName() === 'JavaScript';
  return present(names, 'JavaScript') || present(names, 'EmbeddedFiles') || present(root, 'AA') || scriptedAction;
}

function inspectPdf(path: string): WorkerResult {
  const document = documentAt(path);
  if (!(document instanceof mupdf.PDFDocument)) throw new Refused('unreadable');
  if (document.needsPassword()) return { op: 'inspectPdf', encrypted: true, pageCount: null, activeContent: false };
  let pageCount: number;
  let activeContent: boolean;
  try {
    pageCount = document.countPages();
    activeContent = hasActiveContent(document);
  } catch {
    throw new Refused('unreadable');
  }
  if (pageCount < 1) throw new Refused('unreadable');
  return { op: 'inspectPdf', encrypted: false, pageCount, activeContent };
}

function renderPdfPage(job: WorkerJob & { op: 'renderPdfPage' }): WorkerResult {
  const document = documentAt(job.path);
  // A locked document has no readable pages; drawing one would only produce noise.
  if (document.needsPassword()) throw new Refused('unreadable');
  try {
    const page = document.loadPage(job.page);
    try {
      const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = page.getBounds();
      const longest = Math.max(x1 - x0, y1 - y0);
      if (!(longest > 0)) throw new Refused('unreadable');
      // The output size is bounded whatever the page claims to measure: a huge page is drawn smaller.
      const scale = Math.min(job.dpi / 72, job.maxEdge / longest);
      // No annotations or form widgets ("extras"), no scripts — MuPDF's WASM build has no JavaScript engine.
      const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, false);
      try {
        return { op: 'renderPdfPage', jpeg: pixmap.asJPEG(82, false), width: pixmap.getWidth(), height: pixmap.getHeight() };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } catch (error) {
    throw error instanceof Refused ? error : new Refused('unreadable');
  }
}

async function run(job: WorkerJob): Promise<WorkerResult> {
  switch (job.op) {
    case 'inspectPdf':
      return inspectPdf(job.path);
    case 'renderPdfPage':
      return renderPdfPage(job);
  }
}

parentPort?.on('message', (message: { readonly id: number; readonly job: WorkerJob }) => {
  run(message.job).then(
    (result) => parentPort?.postMessage({ id: message.id, ok: true, result }),
    (error: unknown) => parentPort?.postMessage({ id: message.id, ok: false, code: error instanceof Refused ? error.code : 'failed' }),
  );
});

// Runs in a worker thread (see document-worker-host.ts): the only place where OCR runs (16.9, HT9).
// Tesseract and Leptonica are a WebAssembly build (`tesseract.js-core`, the SIMD + LSTM variant only),
// driven directly — not through the `tesseract.js` wrapper, which can download language data. Memory
// errors stay inside the module's own memory; the host ends this thread on a timeout. The input is
// always a grayscale PNG this server made (sharp or MuPDF), never an uploaded file. Nothing here opens a
// network connection or writes a file: the module gets its code and the language data as bytes.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';

export type TextWorkerJob = { readonly op: 'ocr'; readonly png: Uint8Array };
export type TextWorkerResult = { readonly op: 'ocr'; readonly text: string };

/** The languages read (16.9: at least English, German and Italian), all at once: a household mixes them. */
export const OCR_LANGUAGES = ['eng', 'deu', 'ita'] as const;

// A file must not be able to write to the server log through the engine's diagnostics.
console.log = console.info = console.warn = console.error = () => undefined;
// Defence in depth: there is nothing to fetch, so nothing may.
globalThis.fetch = () => Promise.reject(new Error('no network in the OCR worker'));

interface TessBaseAPI {
  Init(dataPath: string, languages: string, engineMode: number): number;
  SetVariable(name: string, value: string): boolean;
  SetImageFile(exifOrientation: number, angle: number): number;
  Recognize(monitor: null): number;
  GetUTF8Text(): string;
  Clear(): void;
}

interface TesseractModule {
  readonly FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
  readonly TessBaseAPI: new () => TessBaseAPI;
}

class Refused extends Error {
  readonly code: 'unreadable' | 'unavailable';
  constructor(code: 'unreadable' | 'unavailable') {
    super(code);
    this.code = code;
  }
}

let engine: Promise<TessBaseAPI> | undefined;

async function start(): Promise<TessBaseAPI> {
  const { tessdataPath } = workerData as { readonly tessdataPath: string };
  const require = createRequire(import.meta.url);
  let module: TesseractModule;
  const languages: [string, Uint8Array][] = [];
  try {
    const entry = require.resolve('tesseract.js-core/tesseract-core-simd-lstm.js');
    const factory = require(entry) as (options: object) => Promise<TesseractModule>;
    for (const language of OCR_LANGUAGES) languages.push([language, readFileSync(join(tessdataPath, `${language}.traineddata`))]);
    module = await factory({ wasmBinary: readFileSync(entry.replace(/\.js$/, '.wasm')), print: () => undefined, printErr: () => undefined });
  } catch {
    throw new Refused('unavailable');
  }
  for (const [language, bytes] of languages) module.FS.writeFile(`/${language}.traineddata`, bytes);
  const api = new module.TessBaseAPI();
  // 1 = LSTM only (the data has no legacy models).
  if (api.Init('/', OCR_LANGUAGES.join('+'), 1) !== 0) throw new Refused('unavailable');
  // A page of a household document: automatic layout; no dictionaries of user words, no debug files.
  api.SetVariable('tessedit_pageseg_mode', '3');
  return Object.assign(api, { module });
}

async function ocr(png: Uint8Array): Promise<TextWorkerResult> {
  engine ??= start();
  const api = await engine.catch((error: unknown) => {
    engine = undefined;
    throw error;
  });
  const module = (api as TessBaseAPI & { module: TesseractModule }).module;
  module.FS.writeFile('/input', png);
  try {
    if (api.SetImageFile(1, 0) === 1) throw new Refused('unreadable');
    api.Recognize(null);
    return { op: 'ocr', text: api.GetUTF8Text() };
  } finally {
    api.Clear();
    module.FS.unlink('/input');
  }
}

parentPort?.on('message', (message: { readonly id: number; readonly job: TextWorkerJob }) => {
  ocr(message.job.png).then(
    (result) => parentPort?.postMessage({ id: message.id, ok: true, result }),
    (error: unknown) => parentPort?.postMessage({ id: message.id, ok: false, code: error instanceof Refused ? error.code : 'failed' }),
  );
});

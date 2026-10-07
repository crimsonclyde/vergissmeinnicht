import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TextExtractionError } from '@vergissmeinnicht/application';
import { foldSearchText } from '@vergissmeinnicht/domain';
import { createDocumentWorker } from './document-worker-host.ts';
import { createTextExtractor, type TextExtractorHandle } from './text-extractor.ts';

const TESSDATA = join(import.meta.dirname, '..', 'tessdata');
// The language data is fetched, never committed (`pnpm ocr:data`); CI fetches it and must not skip.
const haveData = existsSync(join(TESSDATA, 'ita.traineddata'));
if (!haveData && process.env.CI !== undefined) throw new Error('OCR language data missing: run `pnpm ocr:data`');

const LINES = {
  ita: ['Bolletta acqua n. 2026/004512', 'Totale da pagare: EUR 87,40', 'Scadenza pagamento: 15/08/2026', 'Modalità di pagamento: addebito diretto'],
  deu: ['Hausratversicherung für Ihre Wohnung', 'Jahresbeitrag einschließlich Versicherungsteuer', 'Fälligkeit: 01.11.2026', 'Überspannungsschäden sind mitversichert.'],
  fra: ['Facture électricité n° 2026-1144', 'Montant à payer : 64,90 €', 'Date d’échéance : 18/09/2026', 'Prélèvement automatique'],
  eng: ['NORTHWIND HARDWARE LTD', 'Cordless drill 18V 129.99', 'Warranty: 24 months from date of purchase', 'Keep this receipt for returns.'],
};

/** A fictional document "photographed": a little rotation, off-white paper, blur and JPEG. */
async function photo(lines: readonly string[]): Promise<Buffer> {
  const body = lines.map((line, index) => `<text x="120" y="${260 + index * 90}" font-family="DejaVu Sans" font-size="44">${line}</text>`).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`);
  return sharp(svg).rotate(1.5, { background: '#d8d2c4' }).tint('#f3ead8').blur(0.8).jpeg({ quality: 75 }).toBuffer();
}

function pdfFrom(bytes: Uint8Array, magic: string): Uint8Array {
  const source = mupdf.Document.openDocument(bytes, magic);
  const out = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(out, 'pdf', '');
  for (let index = 0; index < source.countPages(); index++) {
    const page = source.loadPage(index);
    const device = writer.beginPage(page.getBounds());
    page.run(device, mupdf.Matrix.identity);
    writer.endPage();
  }
  writer.close();
  return out.asUint8Array();
}

const words = (text: string) => new Set(foldSearchText(text).split(/[^\p{L}\p{N}]+/u));

describe.skipIf(!haveData)('text extraction (16.9, HT9 / HT10)', () => {
  let dir: string;
  const pdf = createDocumentWorker();
  let extractor: TextExtractorHandle;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vmn-text-'));
    extractor = createTextExtractor({ pdf, tessdataPath: TESSDATA });
  });
  afterAll(async () => {
    await extractor.close();
    await pdf.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each(Object.entries(LINES))('reads a photographed %s document by OCR', async (language, lines) => {
    const path = join(dir, `${language}.jpg`);
    writeFileSync(path, await photo(lines));
    const found = words(await extractor.recognizeImage(path));
    for (const word of ['bolletta', 'pagamento', 'hausratversicherung', 'falligkeit', 'warranty', 'receipt', 'facture', 'electricite', 'prelevement'].filter((word) => foldSearchText(lines.join(' ')).includes(word))) {
      expect(found.has(word), word).toBe(true);
    }
  }, 60_000);

  it('reads the embedded text of a PDF without OCR, umlauts and ß included', async () => {
    const html = `<html><body>${LINES.deu.map((line) => `<p>${line}</p>`).join('')}</body></html>`;
    const path = join(dir, 'embedded.pdf');
    writeFileSync(path, pdfFrom(Buffer.from(html), 'text/html'));
    const text = await extractor.pdfPageText(path, 0);
    expect(text).toContain('Jahresbeitrag einschließlich Versicherungsteuer');
    expect(text).toContain('Überspannungsschäden');
  });

  it('finds no embedded text in a scanned PDF, and reads its page by OCR', async () => {
    const path = join(dir, 'scan.pdf');
    writeFileSync(path, pdfFrom(await photo(LINES.ita), 'image/jpeg'));
    expect((await extractor.pdfPageText(path, 0)).trim()).toBe('');
    expect(words(await extractor.recognizePdfPage(path, 0)).has('bolletta')).toBe(true);
  }, 60_000);

  it('refuses a file it cannot read with a stable code', async () => {
    const path = join(dir, 'broken.jpg');
    writeFileSync(path, Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]));
    await expect(extractor.recognizeImage(path)).rejects.toThrow(TextExtractionError);
  });

  it('reports missing language data as unavailable — not as a fault of the file', async () => {
    const missing = createTextExtractor({ pdf, tessdataPath: join(dir, 'nowhere') });
    const path = join(dir, 'ok.jpg');
    writeFileSync(path, await photo(LINES.eng));
    await expect(missing.recognizeImage(path)).rejects.toMatchObject({ code: 'unavailable' });
    await missing.close();
  });
});

import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_FILE_FORMATS,
  downloadFileName,
  fitsStorage,
  normalizeOriginalFileName,
  parseDocumentFileId,
  parseDocumentFormats,
  parseMaxDocumentFileBytes,
  previewPageCount,
} from './document-file.ts';
import { DomainValidationError } from './errors.ts';

const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (caught) {
    return caught instanceof DomainValidationError ? caught.code : 'other';
  }
  return undefined;
};

describe('document files (16.1)', () => {
  it('keeps the uploaded name as data: no directory part, bounded, no invisible or bidi characters', () => {
    expect(normalizeOriginalFileName('  Bolletta acqua 2026.pdf ')).toBe('Bolletta acqua 2026.pdf');
    expect(normalizeOriginalFileName('C:\\Users\\me\\scan.pdf')).toBe('scan.pdf');
    expect(normalizeOriginalFileName('../../etc/passwd')).toBe('passwd');
    expect(normalizeOriginalFileName('Rechnung Müller.pdf'.normalize('NFD'))).toBe('Rechnung Müller.pdf'.normalize('NFC'));
    expect(normalizeOriginalFileName('x'.repeat(255))).toHaveLength(255);
    expect(code(() => normalizeOriginalFileName('   '))).toBe('file_name_empty');
    expect(code(() => normalizeOriginalFileName('folder/'))).toBe('file_name_empty');
    expect(code(() => normalizeOriginalFileName('..'))).toBe('file_name_empty');
    expect(code(() => normalizeOriginalFileName('x'.repeat(256)))).toBe('file_name_too_long');
    expect(code(() => normalizeOriginalFileName('invoice\u202Efdp.exe'))).toBe('file_name_invalid_characters');
    expect(code(() => normalizeOriginalFileName('a\u0000b.pdf'))).toBe('file_name_invalid_characters');
    expect(code(() => normalizeOriginalFileName('a\u200Bb.pdf'))).toBe('file_name_invalid_characters');
    expect(code(() => normalizeOriginalFileName('a\nb.pdf'))).toBe('file_name_invalid_characters');
  });

  it('generates download names that end in the detected format and contain nothing unsafe', () => {
    expect(downloadFileName('Bolletta acqua.pdf', 'PDF')).toBe('Bolletta acqua.pdf');
    expect(downloadFileName('IMG_0042.HEIC', 'HEIC')).toBe('IMG_0042.HEIC');
    expect(downloadFileName('scan.JPEG', 'JPEG')).toBe('scan.JPEG');
    // The name never decides the type: a file named .html that is a JPEG downloads as a JPEG.
    expect(downloadFileName('invoice.html', 'JPEG')).toBe('invoice.html.jpg');
    expect(downloadFileName('setup.exe', 'PDF')).toBe('setup.exe.pdf');
    expect(downloadFileName('a"b<c>d|e?f*g:h;i%j.pdf', 'PDF')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    expect(downloadFileName('CON.pdf', 'PDF')).toBe('file-CON.pdf');
    expect(downloadFileName('nul', 'PNG')).toBe('file-nul.png');
    expect(downloadFileName('.pdf', 'PDF')).toBe('pdf.pdf');
    expect(downloadFileName('...', 'PNG')).toBe('file.png');
    expect(downloadFileName('Übersicht Zähler.png', 'PNG')).toBe('Übersicht Zähler.png');
    const long = downloadFileName(`${'x'.repeat(250)}.pdf`, 'PDF');
    expect(long).toHaveLength(120);
    expect(long.endsWith('.pdf')).toBe(true);
    for (const name of ['../../x<script>.pdf', 'a/b\\c.pdf', 'x\u0007y.pdf']) {
      expect(downloadFileName(name, 'PDF')).not.toMatch(/[\\/<>\p{Cc}]/u);
    }
  });

  it('lets the instance admin narrow, never widen, what is accepted', () => {
    expect(parseDocumentFormats(['PNG', 'PDF', 'PDF'])).toEqual(['PDF', 'PNG']);
    expect(parseDocumentFormats([...DOCUMENT_FILE_FORMATS])).toEqual(['PDF', 'JPEG', 'PNG', 'HEIC']);
    expect(code(() => parseDocumentFormats([]))).toBe('invalid_document_formats');
    expect(code(() => parseDocumentFormats(['PDF', 'SVG']))).toBe('invalid_document_formats');
    expect(code(() => parseDocumentFormats(['pdf']))).toBe('invalid_document_formats');
    expect(parseMaxDocumentFileBytes(20_000_000)).toBe(20_000_000);
    expect(parseMaxDocumentFileBytes(100_000_000)).toBe(100_000_000);
    for (const bad of [0, 999_999, 100_000_001, 1.5e6 + 0.5, Number.NaN]) expect(code(() => parseMaxDocumentFileBytes(bad))).toBe('invalid_document_file_limit');
  });

  it('counts storage in whole bytes: exactly full still fits, one byte more does not', () => {
    expect(fitsStorage(4_999_999_000, 1000, 5_000_000_000)).toBe(true);
    expect(fitsStorage(4_999_999_000, 1001, 5_000_000_000)).toBe(false);
    // A limit lowered below the usage: nothing new fits, and nothing is deleted by this rule.
    expect(fitsStorage(6_000_000_000, 0, 5_000_000_000)).toBe(false);
    expect(fitsStorage(0, 0, 0)).toBe(true);
  });

  it('previews one page per image and at most 500 pages of a PDF', () => {
    expect(previewPageCount('JPEG', 1)).toBe(1);
    expect(previewPageCount('HEIC', 1)).toBe(1);
    expect(previewPageCount('PDF', 3)).toBe(3);
    expect(previewPageCount('PDF', 1200)).toBe(500);
    expect(previewPageCount('PDF', null)).toBe(0); // password-protected
  });

  it('accepts only lower-case UUIDv4 ids', () => {
    const id = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    expect(parseDocumentFileId(id)).toBe(id);
    expect(code(() => parseDocumentFileId(id.toUpperCase()))).toBe('invalid_document_file_id');
    expect(code(() => parseDocumentFileId('a'.repeat(64)))).toBe('invalid_document_file_id');
  });
});

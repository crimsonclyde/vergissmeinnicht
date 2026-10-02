import { describe, expect, it } from 'vitest';
import {
  containsPattern,
  defaultDirection,
  documentSearchText,
  documentTagKeys,
  documentTitleKey,
  foldSearchText,
  parseDocumentCursor,
  parseDocumentQuery,
  parseSearchTerms,
} from './document-search.ts';
import { DomainValidationError } from './errors.ts';

const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (caught) {
    return caught instanceof DomainValidationError ? caught.code : 'other';
  }
  return undefined;
};
const ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

describe('Finding Documents: matching rules (16.3, HT7)', () => {
  it('folds case, accents and compatibility forms — German, Italian and English text', () => {
    expect(foldSearchText('Müllgebühren')).toBe('mullgebuhren');
    expect(foldSearchText('STRASSE')).toBe(foldSearchText('Straße'));
    expect(foldSearchText('ẞ')).toBe('ss');
    expect(foldSearchText('Perché è così')).toBe('perche e cosi');
    expect(foldSearchText('Città')).toBe('citta');
    expect(foldSearchText('Ｗater ﬁle')).toBe('water file'); // full-width letters, ligatures
    expect(foldSearchText('İstanbul İ')).toBe('istanbul i');
    expect(foldSearchText('Müll')).toBe(foldSearchText('Müll')); // decomposed and composed are one
    expect(foldSearchText('Receipt №5')).toBe('receipt no5');
    expect(documentTitleKey('Äpfel')).toBe('apfel');
    expect(documentTagKeys(['Paid', 'Città'])).toEqual(['paid', 'citta']);
  });

  it('builds the searched text from title, tags and notes, one per line', () => {
    expect(documentSearchText({ title: 'Water Bill', tags: ['Acqua', 'Paid'], notes: 'Zähler 12\nzweite Zeile' })).toBe('water bill\nacqua\npaid\nzahler 12\nzweite zeile');
  });

  it('splits a search into folded words, and refuses what is too long instead of cutting it', () => {
    expect(parseSearchTerms('  Acqua   MÜLL acqua ')).toEqual(['acqua', 'mull']);
    expect(parseSearchTerms('')).toEqual([]);
    expect(parseSearchTerms(' \n\t ')).toEqual([]);
    expect(parseSearchTerms('x'.repeat(100))).toHaveLength(1);
    expect(code(() => parseSearchTerms('x'.repeat(101)))).toBe('search_too_long');
    expect(parseSearchTerms('a b c d e f g h')).toHaveLength(8);
    expect(code(() => parseSearchTerms('a b c d e f g h i'))).toBe('search_too_many_terms');
  });

  it('makes wildcards literal', () => {
    expect(containsPattern('acqua')).toBe('%acqua%');
    expect(containsPattern('100%')).toBe('%100\\%%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('a\\b')).toBe('%a\\\\b%');
  });

  it('parses a query with defaults: everywhere, newest upload first', () => {
    expect(parseDocumentQuery({})).toEqual({ terms: [], place: { kind: 'all' }, type: null, year: null, tags: [], uploader: null, sort: 'uploaded', direction: 'desc' });
    expect(defaultDirection('title')).toBe('asc');
    expect(parseDocumentQuery({ sort: 'title' }).direction).toBe('asc');
    expect(parseDocumentQuery({ sort: 'documentDate' }).direction).toBe('desc');
    expect(parseDocumentQuery({ folder: 'top', subfolders: true }).place).toEqual({ kind: 'top' });
    expect(parseDocumentQuery({ folder: ID }).place).toEqual({ kind: 'folder', id: ID, withSubfolders: false });
    expect(parseDocumentQuery({ folder: ID, subfolders: true }).place).toEqual({ kind: 'folder', id: ID, withSubfolders: true });
    expect(parseDocumentQuery({ type: 'builtin:bill', year: 2026, tags: [' Paid ', 'PAID', 'Città', ''], uploader: ' Uma ' })).toMatchObject({ type: { kind: 'builtin', key: 'bill' }, year: 2026, tags: ['paid', 'citta'], uploader: 'Uma' });
    expect(parseDocumentQuery({ type: `custom:${ID}` }).type).toEqual({ kind: 'custom', id: ID });
  });

  it('refuses anything that is not a known sort, direction, type, year or folder', () => {
    expect(code(() => parseDocumentQuery({ sort: 'created_at' }))).toBe('invalid_document_sort');
    expect(code(() => parseDocumentQuery({ sort: 'title, id' }))).toBe('invalid_document_sort');
    expect(code(() => parseDocumentQuery({ sort: 'toString' }))).toBe('invalid_document_sort');
    expect(code(() => parseDocumentQuery({ direction: 'DESC' }))).toBe('invalid_document_sort');
    expect(code(() => parseDocumentQuery({ type: 'bill' }))).toBe('invalid_document_type');
    expect(code(() => parseDocumentQuery({ type: 'builtin:constructor' }))).toBe('invalid_document_type');
    expect(code(() => parseDocumentQuery({ year: 2026.5 }))).toBe('invalid_document_year');
    expect(code(() => parseDocumentQuery({ folder: 'all' }))).toBe('invalid_folder_id');
    expect(code(() => parseDocumentQuery({ uploader: '' }))).toBe('uploader_empty');
    expect(code(() => parseDocumentQuery({ uploader: 'x'.repeat(201) }))).toBe('uploader_too_long');
  });

  it('accepts a cursor only in the shape of the sort it belongs to', () => {
    expect(parseDocumentCursor([1_790_000_000_000, ID], 'uploaded')).toEqual({ value: 1_790_000_000_000, id: ID });
    expect(parseDocumentCursor([1_790_000_000_000, ID], 'modified')).toEqual({ value: 1_790_000_000_000, id: ID });
    expect(parseDocumentCursor(['2026-03-12', ID], 'documentDate')).toEqual({ value: '2026-03-12', id: ID });
    expect(parseDocumentCursor([null, ID], 'documentDate')).toEqual({ value: null, id: ID });
    expect(parseDocumentCursor(['water bill', ID], 'title')).toEqual({ value: 'water bill', id: ID });
    expect(parseDocumentCursor(['', ID], 'title')).toEqual({ value: '', id: ID });
    for (const [input, sort] of [
      [['2026-03-12', ID], 'uploaded'],
      [[1.5, ID], 'uploaded'],
      [[-1, ID], 'modified'],
      [[Number.MAX_VALUE, ID], 'modified'],
      [[1, ID], 'documentDate'],
      [['2026-3-12', ID], 'documentDate'],
      [["2026-03-12' OR 1=1", ID], 'documentDate'],
      [[null, ID], 'title'],
      [['x'.repeat(4001), ID], 'title'],
      [['a', ID.toUpperCase()], 'title'],
      [['a', 'id'], 'title'],
      [['a'], 'title'],
      [['a', ID, 'more'], 'title'],
      [{ value: 'a', id: ID }, 'title'],
      ['a', 'title'],
      [null, 'title'],
    ] as const) {
      expect({ input, parsed: parseDocumentCursor(input, sort) }).toEqual({ input, parsed: undefined });
    }
  });
});

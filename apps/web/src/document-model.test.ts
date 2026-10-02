import { describe, expect, it } from 'vitest';
import type { DocumentFile, DocumentFolder, DocumentSummary } from './api.ts';
import {
  EMPTY_FORM,
  childFolders,
  NO_FILTERS,
  SORT_CHOICES,
  cleared,
  dateLine,
  exportQuery,
  filterChips,
  filterOptions,
  filtersFromSearch,
  filtersToSearch,
  isFiltering,
  listLine,
  listingParams,
  purgeTotals,
  sortedDateLine,
  spansFolders,
  type DocumentFilters,
  fieldsOf,
  folderContents,
  folderLabel,
  folderPath,
  folderTree,
  formatBytes,
  moveTargets,
  moved,
  parseTags,
  previewNote,
  restoreMessage,
  titleFromFileName,
  typeFromValue,
  typeLabel,
  typeOptions,
  typeValue,
  withDocumentDate,
} from './document-model.ts';

const folder = (id: string, parentId: string | null, name: string, documents = 0): DocumentFolder => ({ id, parentId, name, revision: 1, documents });
// Water ─ 2026 ─ Q1        Insurance       gas
const folders = [folder('water', null, 'Water', 2), folder('2026', 'water', '2026', 3), folder('q1', '2026', 'Q1', 1), folder('ins', null, 'Insurance'), folder('gas', null, 'gas')];
const file = (preview: DocumentFile['preview'], extra: Partial<DocumentFile> = {}): DocumentFile => ({
  id: 'f',
  name: 'scan.pdf',
  format: 'PDF',
  bytes: 1000,
  pageCount: 3,
  width: null,
  height: null,
  passwordProtected: false,
  activeContent: false,
  preview,
  uploadedBy: 'Uma',
  uploadedAt: '2026-10-01T08:00:00.000Z',
  ...extra,
});

describe('Documents view model (16.2)', () => {
  it('orders Folders by name without case and builds paths, labels and the tree', () => {
    expect(childFolders(folders, null).map((each) => each.name)).toEqual(['gas', 'Insurance', 'Water']);
    expect(folderPath(folders, 'q1').map((each) => each.name)).toEqual(['Water', '2026', 'Q1']);
    expect(folderPath(folders, null)).toEqual([]);
    expect(folderPath(folders, 'gone')).toEqual([]);
    expect(folderLabel(folders, 'q1')).toBe('Water / 2026 / Q1');
    expect(folderLabel(folders, null)).toBe('Documents (top level)');
    expect(folderTree(folders).map((entry) => `${'·'.repeat(entry.depth)}${entry.folder.name}`)).toEqual(['gas', 'Insurance', 'Water', '·2026', '··Q1']);
  });

  it('never offers a Folder itself or its own sub-folders as a place to move it', () => {
    expect(moveTargets(folders, 'water').map((entry) => entry.folder.name)).toEqual(['gas', 'Insurance']);
    expect(moveTargets(folders, 'q1').map((entry) => entry.folder.name)).toEqual(['gas', 'Insurance', 'Water', '2026']);
  });

  it('counts what goes to Trash with a Folder', () => {
    expect(folderContents(folders, 'water')).toEqual({ folders: 2, documents: 6 });
    expect(folderContents(folders, 'q1')).toEqual({ folders: 0, documents: 1 });
  });

  it('names types, also retired ones, and offers only what can be chosen', () => {
    expect(typeLabel(null)).toBeNull();
    expect(typeLabel({ kind: 'builtin', key: 'tax_notice' })).toBe('Tax notice');
    expect(typeLabel({ kind: 'custom', id: 'm', name: 'Minutes', retired: false })).toBe('Minutes');
    expect(typeLabel({ kind: 'custom', id: 'm', name: 'Minutes', retired: true })).toBe('Minutes (no longer offered)');
    const types = { builtIn: ['bill', 'receipt'], custom: [{ id: 'm', name: 'Minutes', retired: false }, { id: 'o', name: 'Old', retired: true }] };
    expect(typeOptions(types, null).map((option) => option.label)).toEqual(['Bill', 'Minutes', 'Receipt']);
    // The retired type a Document already has stays choosable for that Document.
    expect(typeOptions(types, { kind: 'custom', id: 'o', name: 'Old', retired: true }).map((option) => option.value)).toContain('custom:o');
    expect(typeFromValue(typeValue({ kind: 'builtin', key: 'bill' }))).toEqual({ builtIn: 'bill' });
    expect(typeFromValue(typeValue({ kind: 'custom', id: 'm', name: 'Minutes', retired: false }))).toEqual({ customId: 'm' });
    expect(typeFromValue('')).toBeNull();
  });

  it('always says which date it shows', () => {
    const base = { documentDate: null, uploadedAt: '2026-04-03T09:30:00.000Z' };
    expect(dateLine(base)).toMatch(/^Uploaded /);
    expect(dateLine({ ...base, documentDate: '2026-03-12' })).toMatch(/^Document date .*12/);
    const summary = { ...base, documentDate: '2026-03-12', type: { kind: 'builtin', key: 'bill' }, files: 3 } as DocumentSummary;
    expect(listLine(summary, 'title', null)).toMatch(/^Bill · Document date .* · 3 pages$/);
    expect(listLine({ ...summary, type: null, files: 1 }, 'title', 'Water / 2026')).toMatch(/^Document date .* · 1 page · Water \/ 2026$/);
  });

  it('names what an export covers and adds up what a permanent deletion removes (16.4)', () => {
    expect(exportQuery({})).toBe('');
    expect(exportQuery({ folderId: null })).toBe('');
    expect(exportQuery({ folderId: 'w' })).toBe('folder=w');
    expect(exportQuery({ folderId: 'w', documentIds: ['a', 'b'] })).toBe('document=a&document=b'); // a selection is its own scope
    // A Folder counts itself, its sub-folders and what went to Trash with it; a Document counts once.
    expect(purgeTotals([])).toEqual({ folders: 0, documents: 0, files: 0 });
    expect(
      purgeTotals([
        { kind: 'folder', folders: 2, documents: 5, files: 9 },
        { kind: 'document', folders: 0, documents: 0, files: 3 },
        { kind: 'folder', folders: 0, documents: 0, files: 0 },
      ]),
    ).toEqual({ folders: 4, documents: 6, files: 12 });
  });

  describe('finding Documents (16.3)', () => {
    const ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    const tree = [folder('w', null, 'Water'), folder('y', 'w', '2026')];
    const document = { documentDate: '2026-03-12', uploadedAt: '2026-04-03T09:30:00.000Z', modifiedAt: '2026-05-01T08:00:00.000Z' };

    it('labels the date after what the list is sorted by, so two dates are never confused', () => {
      expect(sortedDateLine(document, 'documentDate')).toMatch(/^Document date .*12/);
      expect(sortedDateLine(document, 'uploaded')).toMatch(/^Uploaded .*3/);
      expect(sortedDateLine(document, 'modified')).toMatch(/^Changed .*1/);
      expect(sortedDateLine(document, 'title')).toMatch(/^Document date /);
      // Without a document date: said plainly under that order, and the upload date otherwise.
      expect(sortedDateLine({ ...document, documentDate: null }, 'documentDate')).toBe('No document date');
      expect(sortedDateLine({ ...document, documentDate: null }, 'title')).toMatch(/^Uploaded /);
    });

    it('keeps search and filters in the address, leaving defaults out, and reads them back', () => {
      expect(filtersToSearch(NO_FILTERS)).toBe('');
      const filters: DocumentFilters = { q: ' acqua ', folder: ID, subfolders: true, type: 'builtin:bill', year: '2026', tags: ['Paid', 'Città'], uploader: 'Uma', sort: 'title', dir: 'desc' };
      const search = filtersToSearch(filters);
      expect(search).toBe(`?q=acqua&folder=${ID}&sub=1&type=builtin%3Abill&year=2026&tag=Paid&tag=Citt%C3%A0&uploader=Uma&sort=title&dir=desc`);
      expect(filtersFromSearch(search)).toEqual({ ...filters, q: 'acqua' });
      expect(filtersToSearch({ ...NO_FILTERS, sort: 'title', dir: 'asc' })).toBe('?sort=title'); // A → Z is the default for titles
      expect(filtersFromSearch('?sort=title')).toMatchObject({ sort: 'title', dir: 'asc' });
      expect(filtersFromSearch('')).toEqual(NO_FILTERS);
      // An address is input: what is not understood is dropped.
      expect(filtersFromSearch('?sort=evil&dir=up&folder=..%2F..&type=<script>&year=20x6&sub=yes&tag=&tag=a&tag=a')).toEqual({ ...NO_FILTERS, tags: ['a'] });
      expect(filtersFromSearch(`?q=${'x'.repeat(300)}`).q).toHaveLength(100);
    });

    it('asks the server for the Folder of the page, or the one chosen at the top level', () => {
      expect(listingParams(NO_FILTERS, null, null)).toBe('sort=uploaded&dir=desc');
      expect(listingParams(NO_FILTERS, 'w', null)).toBe('folder=w&sort=uploaded&dir=desc');
      expect(listingParams({ ...NO_FILTERS, subfolders: true }, 'w', 'abc')).toBe('folder=w&sub=1&sort=uploaded&dir=desc&cursor=abc');
      expect(listingParams({ ...NO_FILTERS, folder: 'top', subfolders: true, q: 'a b' }, null, null)).toBe('q=a+b&folder=top&sort=uploaded&dir=desc');
      expect(listingParams({ ...NO_FILTERS, subfolders: true }, null, null)).toBe('sort=uploaded&dir=desc'); // "with sub-folders" needs a Folder
      expect(listingParams({ ...NO_FILTERS, tags: ['a', 'b'], year: '2026', type: 'builtin:bill', uploader: 'Uma' }, null, null)).toBe('type=builtin%3Abill&year=2026&tag=a&tag=b&uploader=Uma&sort=uploaded&dir=desc');
      // Whether rows name their Folder: only when the list can span several.
      expect(spansFolders(NO_FILTERS, null)).toBe(true);
      expect(spansFolders({ ...NO_FILTERS, folder: 'top' }, null)).toBe(false);
      expect(spansFolders({ ...NO_FILTERS, folder: 'w' }, null)).toBe(false);
      expect(spansFolders({ ...NO_FILTERS, folder: 'w', subfolders: true }, null)).toBe(true);
      expect(spansFolders(NO_FILTERS, 'w')).toBe(false);
      expect(spansFolders({ ...NO_FILTERS, subfolders: true }, 'w')).toBe(true);
    });

    it('shows every active filter as a chip that removes exactly that filter', () => {
      const types = { builtIn: ['bill'], custom: [{ id: ID, name: 'Minutes', retired: true }] };
      const filters: DocumentFilters = { ...NO_FILTERS, q: 'acqua', folder: 'y', subfolders: true, type: `custom:${ID}`, year: '2026', tags: ['Paid', 'Acqua'], uploader: 'Uma' };
      const chips = filterChips(filters, null, tree, types);
      expect(chips.map((chip) => chip.label)).toEqual(['Folder: Water / 2026, with sub-folders', 'Type: Minutes (no longer offered)', 'Year: 2026', 'Tag: Paid', 'Tag: Acqua', 'Uploaded by: Uma']);
      expect(chips.find((chip) => chip.key === 'tag:Paid')?.without).toEqual({ ...filters, tags: ['Acqua'] });
      expect(chips.find((chip) => chip.key === 'folder')?.without).toEqual({ ...filters, folder: '', subfolders: false });
      expect(chips.find((chip) => chip.key === 'year')?.without.q).toBe('acqua'); // the search stays
      // Inside a Folder the Folder is the page, not a filter; "with sub-folders" is.
      expect(filterChips({ ...NO_FILTERS, subfolders: true }, 'w', tree, null).map((chip) => chip.label)).toEqual(['With sub-folders']);
      expect(filterChips({ ...NO_FILTERS, folder: 'top' }, null, tree, null).map((chip) => chip.label)).toEqual(['Folder: Not in a folder']);
      expect(filterChips({ ...NO_FILTERS, type: 'builtin:bill' }, null, tree, null).map((chip) => chip.label)).toEqual(['Type: Bill']);
      expect(filterChips(NO_FILTERS, null, tree, types)).toEqual([]);
      expect(isFiltering(NO_FILTERS)).toBe(false);
      expect(isFiltering({ ...NO_FILTERS, sort: 'title', dir: 'asc' })).toBe(false); // an order narrows nothing
      expect(isFiltering({ ...NO_FILTERS, q: '  ' })).toBe(false);
      expect(isFiltering({ ...NO_FILTERS, q: 'a' })).toBe(true);
      expect(cleared({ ...filters, sort: 'title', dir: 'asc' })).toEqual({ ...NO_FILTERS, sort: 'title', dir: 'asc' });
    });

    it('offers the eight orders, and only filter values that exist — plus the one in use', () => {
      expect(SORT_CHOICES.map((choice) => choice.value)).toEqual(['uploaded:desc', 'uploaded:asc', 'documentDate:desc', 'documentDate:asc', 'title:asc', 'title:desc', 'modified:desc', 'modified:asc']);
      const values = { years: [2026, 2025], tags: ['Acqua', 'Paid'], uploaders: ['Ada', 'Uma'] };
      expect(filterOptions(values, NO_FILTERS)).toEqual({ years: ['2026', '2025'], tags: ['Acqua', 'Paid'], uploaders: ['Ada', 'Uma'] });
      expect(filterOptions(values, { ...NO_FILTERS, year: '2019', tags: ['paid'], uploader: 'Gone' })).toEqual({ years: ['2019', '2026', '2025'], tags: ['Acqua'], uploaders: ['Gone', 'Ada', 'Uma'] });
      expect(filterOptions(null, NO_FILTERS)).toEqual({ years: [], tags: [], uploaders: [] });
    });
  });

  it('formats sizes in decimal units', () => {
    expect(formatBytes(999)).toBe('999 bytes');
    expect(formatBytes(1500)).toBe('2 KB');
    expect(formatBytes(12_340_000)).toBe('12.3 MB');
    expect(formatBytes(5_000_000_000)).toBe('5 GB');
  });

  it('prepares what is sent from the form', () => {
    expect(titleFromFileName('Bolletta acqua.pdf')).toBe('Bolletta acqua');
    expect(titleFromFileName('IMG_0042.HEIC')).toBe('IMG_0042');
    expect(parseTags(' water, house ,, ')).toEqual(['water', 'house']);
    expect(fieldsOf({ ...EMPTY_FORM, title: 'Bill' })).toEqual({ title: 'Bill', type: null, documentDate: null, year: null, notes: '', tags: [] });
    expect(fieldsOf({ title: 'IMU', type: 'builtin:tax_notice', documentDate: '2027-01-15', year: '2026', notes: 'n', tags: 'tax' })).toEqual({ title: 'IMU', type: { builtIn: 'tax_notice' }, documentDate: '2027-01-15', year: 2026, notes: 'n', tags: ['tax'] });
  });

  it('proposes the year from the document date only until the person sets a year', () => {
    expect(withDocumentDate(EMPTY_FORM, '2026-03-12', false)).toMatchObject({ documentDate: '2026-03-12', year: '2026' });
    expect(withDocumentDate({ ...EMPTY_FORM, year: '2026' }, '2027-01-15', true)).toMatchObject({ documentDate: '2027-01-15', year: '2026' });
    expect(withDocumentDate({ ...EMPTY_FORM, year: '2026' }, '', false)).toMatchObject({ documentDate: '', year: '2026' });
  });

  it('moves a page up or down and stays put at the ends', () => {
    expect(moved(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('says why a file has no preview — "unavailable for this format" for HEIC', () => {
    expect(previewNote(file({ state: 'READY', pages: 3, unavailable: null }))).toBeNull();
    expect(previewNote(file({ state: 'PENDING', pages: 1, unavailable: null }))).toBeNull(); // show what exists already
    expect(previewNote(file({ state: 'NONE', pages: 0, unavailable: 'format' }, { format: 'HEIC' }))).toMatch(/^Preview unavailable for this format/);
    expect(previewNote(file({ state: 'NONE', pages: 0, unavailable: 'password_protected' }))).toMatch(/password-protected/);
    expect(previewNote(file({ state: 'PENDING', pages: 0, unavailable: null }))).toMatch(/being prepared/);
    expect(previewNote(file({ state: 'FAILED', pages: 0, unavailable: null }))).toMatch(/No preview could be made/);
    expect(previewNote(file({ state: 'PARTIAL', pages: 0, unavailable: null }))).toMatch(/Storage is full/);
  });

  it('tells what a restore did, including a new name and a new place', () => {
    expect(restoreMessage('Water', { folders: 0, documents: 0, renamedTo: null, movedTo: null })).toBe('“Water” restored.');
    expect(restoreMessage('Water', { folders: 1, documents: 2, renamedTo: 'Water (restored)', movedTo: null })).toBe(
      '“Water (restored)” restored. A folder named “Water” exists now, so it was given this name. It came back with 1 sub-folders and 2 documents.',
    );
    expect(restoreMessage('2026', { folders: 0, documents: 0, renamedTo: null, movedTo: { id: null, name: null, because: 'Water' } })).toBe('“2026” restored. Restored to the top level because “Water” is in Trash.');
    expect(restoreMessage('Bill', { folders: 0, documents: 1, renamedTo: null, movedTo: { id: 'w', name: 'Water', because: '2024' } })).toBe('“Bill” restored. Restored to “Water” because “2024” is in Trash.');
  });
});

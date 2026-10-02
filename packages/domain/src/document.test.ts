import { describe, expect, it } from 'vitest';
import {
  MAX_FOLDER_DEPTH,
  folderDepth,
  folderNameKey,
  folderPlacementProblem,
  isWithin,
  normalizeDocumentContent,
  normalizeDocumentNotes,
  normalizeFolderName,
  parseDocumentDate,
  parseDocumentFileIds,
  parseDocumentTypeRef,
  parseDocumentYear,
  parseWorkspaceTool,
  restoreParent,
  restoredFolderName,
  siblingNameTaken,
  subtreeHeight,
  titleFromFileName,
  type FolderNode,
} from './document.ts';
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
const folder = (id: string, parentId: string | null, name = id, deleted = false): FolderNode => ({ id, parentId, name, deleted });

describe('Documents: fields (16.2)', () => {
  it('bounds Folder names and compares siblings without case or width', () => {
    expect(normalizeFolderName('  Water ')).toBe('Water');
    expect(code(() => normalizeFolderName(''))).toBe('folder_name_empty');
    expect(code(() => normalizeFolderName('x'.repeat(81)))).toBe('folder_name_too_long');
    expect(code(() => normalizeFolderName('Water/2026'))).toBe('folder_name_invalid_characters');
    expect(code(() => normalizeFolderName('Wa‮ter'))).toBe('folder_name_invalid_characters');
    expect(folderNameKey('WATER')).toBe(folderNameKey('water'));
    expect(folderNameKey('Ｗater')).toBe(folderNameKey('water'));
    expect(folderNameKey('Straße')).not.toBe(folderNameKey('Strasse'));
  });

  it('requires only a title; everything else is optional', () => {
    expect(normalizeDocumentContent({ title: ' Water bill ' })).toEqual({ title: 'Water bill', type: null, documentDate: null, year: null, notes: '', tags: [] });
    expect(code(() => normalizeDocumentContent({ title: '  ' }))).toBe('document_title_empty');
    expect(code(() => normalizeDocumentContent({ title: 'x'.repeat(201) }))).toBe('document_title_too_long');
    const full = normalizeDocumentContent({ title: 'IMU', type: { builtIn: 'tax_notice' }, documentDate: '2027-01-15', year: 2026, notes: 'line 1\r\nline 2', tags: ['Tax', 'tax', 'IMU'] });
    // The year is its own field: a 2026 notice dated January 2027.
    expect(full).toEqual({ title: 'IMU', type: { kind: 'builtin', key: 'tax_notice' }, documentDate: '2027-01-15', year: 2026, notes: 'line 1\nline 2', tags: ['Tax', 'IMU'] });
  });

  it('accepts calendar dates from 1900 on and years in range', () => {
    expect(parseDocumentDate('1987-03-01')).toBe('1987-03-01');
    expect(parseDocumentDate('2024-02-29')).toBe('2024-02-29');
    for (const bad of ['2026-02-30', '2026-13-01', '1899-12-31', '26-01-01', '2026-1-1', 'yesterday', '2026-01-01T00:00']) expect({ bad, code: code(() => parseDocumentDate(bad)) }).toEqual({ bad, code: 'invalid_document_date' });
    expect(parseDocumentYear(2026)).toBe(2026);
    for (const bad of [1899, 2201, 2026.5, Number.NaN]) expect(code(() => parseDocumentYear(bad))).toBe('invalid_document_year');
  });

  it('accepts a built-in type by key or a custom one by id, never both or anything else', () => {
    expect(parseDocumentTypeRef(null)).toBeNull();
    expect(parseDocumentTypeRef({ builtIn: 'bill' })).toEqual({ kind: 'builtin', key: 'bill' });
    expect(parseDocumentTypeRef({ customId: ID })).toEqual({ kind: 'custom', id: ID });
    expect(code(() => parseDocumentTypeRef({ builtIn: 'invoice' }))).toBe('invalid_document_type');
    expect(code(() => parseDocumentTypeRef({ builtIn: 'bill', customId: ID }))).toBe('invalid_document_type');
    expect(code(() => parseDocumentTypeRef({}))).toBe('invalid_document_type');
    expect(code(() => parseDocumentTypeRef({ customId: 'x' }))).toBe('invalid_document_type_id');
  });

  it('keeps notes as plain multi-line text', () => {
    expect(normalizeDocumentNotes('  a\tb\n c ')).toBe('a\tb\n c');
    expect(code(() => normalizeDocumentNotes('x'.repeat(4001)))).toBe('document_notes_too_long');
    expect(code(() => normalizeDocumentNotes('a\u0007b'))).toBe('document_notes_invalid_characters');
  });

  it('needs one to fifty distinct files', () => {
    expect(parseDocumentFileIds([ID])).toEqual([ID]);
    expect(code(() => parseDocumentFileIds([]))).toBe('document_needs_file');
    expect(code(() => parseDocumentFileIds([ID, ID]))).toBe('invalid_document_files');
    expect(code(() => parseDocumentFileIds(['x']))).toBe('invalid_document_files');
    expect(code(() => parseDocumentFileIds(Array.from({ length: 51 }, (_, i) => `${ID.slice(0, 34)}${String(i).padStart(2, '0')}`)))).toBe('too_many_document_files');
  });

  it('proposes a title from a file name and knows the tools', () => {
    expect(titleFromFileName('Bolletta acqua 2026.pdf')).toBe('Bolletta acqua 2026');
    expect(titleFromFileName('IMG_0042.HEIC')).toBe('IMG_0042');
    expect(titleFromFileName('.pdf')).toBe('.pdf');
    expect(titleFromFileName(`${'x'.repeat(250)}.pdf`)).toHaveLength(200);
    expect(parseWorkspaceTool('DOCUMENTS')).toBe('DOCUMENTS');
    expect(code(() => parseWorkspaceTool('MAIL'))).toBe('invalid_tool');
  });
});

describe('Documents: the Folder tree (16.2)', () => {
  // Water ─ 2026 ─ Q1        Insurance
  const tree = [folder('water', null, 'Water'), folder('2026', 'water'), folder('q1', '2026', 'Q1'), folder('insurance', null, 'Insurance')];

  it('measures depth, height and containment', () => {
    expect(folderDepth(tree, null)).toBe(0);
    expect(folderDepth(tree, 'water')).toBe(1);
    expect(folderDepth(tree, 'q1')).toBe(3);
    expect(folderDepth(tree, 'nope')).toBeUndefined();
    expect(subtreeHeight(tree, 'water')).toBe(3);
    expect(subtreeHeight(tree, 'q1')).toBe(1);
    expect(isWithin(tree, 'q1', 'water')).toBe(true);
    expect(isWithin(tree, 'water', 'water')).toBe(true);
    expect(isWithin(tree, 'water', 'q1')).toBe(false);
    expect(isWithin(tree, null, 'water')).toBe(false);
  });

  it('refuses a move into itself or a descendant, onto a taken name, into Trash or nowhere', () => {
    const move = (movingId: string, parentId: string | null, name = movingId) => folderPlacementProblem(tree, { parentId, name, height: subtreeHeight(tree, movingId), movingId });
    expect(move('water', 'water')).toBe('cycle');
    expect(move('water', '2026')).toBe('cycle');
    expect(move('water', 'q1')).toBe('cycle');
    expect(move('2026', 'insurance')).toBeUndefined();
    expect(move('2026', null)).toBeUndefined();
    expect(move('2026', 'water')).toBeUndefined(); // where it already is
    expect(move('insurance', 'water', 'INSURANCE')).toBeUndefined();
    expect(move('insurance', 'water', '2026')).toBe('name_taken');
    expect(move('insurance', 'nope')).toBe('parent_not_found');
    expect(folderPlacementProblem([...tree, folder('old', null, 'Old', true)], { parentId: 'old', name: 'x', height: 1 })).toBe('parent_not_found');
    expect(siblingNameTaken(tree, null, 'water')).toBe(true);
    expect(siblingNameTaken(tree, null, 'water', 'water')).toBe(false);
    expect(siblingNameTaken([folder('w', null, 'Water', true)], null, 'Water')).toBe(false); // a name in Trash is free
  });

  it('limits the depth to ten levels, counting the subtree that moves along', () => {
    const chain = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => folder(`f${i}`, i === 0 ? null : `f${i - 1}`));
    expect(folderPlacementProblem(chain, { parentId: 'f8', name: 'new', height: 1 })).toBeUndefined();
    expect(folderPlacementProblem(chain, { parentId: 'f9', name: 'new', height: 1 })).toBe('too_deep');
    const pair = [...chain, folder('a', null), folder('b', 'a')];
    expect(folderPlacementProblem(pair, { parentId: 'f7', name: 'a', height: 2, movingId: 'a' })).toBeUndefined();
    expect(folderPlacementProblem(pair, { parentId: 'f8', name: 'a', height: 2, movingId: 'a' })).toBe('too_deep');
  });

  it('restores into the nearest Folder that still exists, else to the top level', () => {
    const trashed = [folder('water', null, 'Water'), folder('2024', 'water', '2024', true), folder('jan', '2024', 'Jan', true)];
    expect(restoreParent(trashed, 'water')).toEqual({ parentId: 'water', moved: false });
    expect(restoreParent(trashed, '2024')).toEqual({ parentId: 'water', moved: true });
    expect(restoreParent(trashed, 'jan')).toEqual({ parentId: 'water', moved: true });
    expect(restoreParent([folder('water', null, 'Water', true), folder('2026', 'water', '2026', true)], 'water')).toEqual({ parentId: null, moved: true });
    expect(restoreParent(trashed, null)).toEqual({ parentId: null, moved: false });
    expect(restoreParent(trashed, 'purged')).toEqual({ parentId: null, moved: true }); // a parent that no longer exists at all
  });

  it('renames a restored Folder when its name was taken meanwhile, never merging', () => {
    const live = [folder('new', null, 'Water')];
    expect(restoredFolderName(live, null, 'Insurance')).toBe('Insurance');
    expect(restoredFolderName(live, null, 'water')).toBe('water (restored)');
    expect(restoredFolderName([...live, folder('r1', null, 'Water (restored)')], null, 'Water')).toBe('Water (restored 2)');
    expect(restoredFolderName([folder('long', null, 'x'.repeat(80))], null, 'x'.repeat(80))).toBe(`${'x'.repeat(69)} (restored)`);
  });

  it('never yields a cycle, a duplicate sibling name or an orphan after any sequence of creates, moves, deletes and restores', () => {
    // A small deterministic generator: the same sequences on every run.
    let seed = 20261001;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      let folders: (FolderNode & { group: string | null })[] = [];
      let next = 0;
      const live = () => folders.filter((each) => !each.deleted);
      const pick = <T>(items: T[]): T | undefined => items[random(Math.max(items.length, 1))];
      for (let step = 0; step < 120; step++) {
        const action = random(10);
        if (action < 4) {
          const parentId = random(3) === 0 ? null : (pick(live())?.id ?? null);
          const name = `n${random(4)}`;
          if (folderPlacementProblem(folders, { parentId, name, height: 1 }) === undefined) folders.push({ id: `f${next++}`, parentId, name, deleted: false, group: null });
        } else if (action < 7) {
          const moving = pick(live());
          const parentId = random(4) === 0 ? null : (pick(folders)?.id ?? null); // may be itself, a descendant or a trashed Folder
          if (moving !== undefined && folderPlacementProblem(folders, { parentId, name: moving.name, height: subtreeHeight(folders, moving.id), movingId: moving.id }) === undefined) {
            folders = folders.map((each) => (each.id === moving.id ? { ...each, parentId } : each));
          }
        } else if (action < 9) {
          const root = pick(live());
          if (root !== undefined) folders = folders.map((each) => (!each.deleted && isWithin(folders, each.id, root.id) ? { ...each, deleted: true, group: root.id } : each));
        } else {
          const back = pick(folders.filter((each) => each.deleted));
          if (back !== undefined) {
            const returning = folders.filter((each) => each.group === back.group && isWithin(folders, each.id, back.id)).map((each) => each.id);
            const place = restoreParent(folders, back.parentId);
            const name = restoredFolderName(folders, place.parentId, back.name);
            folders = folders.map((each) => (returning.includes(each.id) ? { ...each, deleted: false, group: null, ...(each.id === back.id ? { parentId: place.parentId, name } : {}) } : each));
          }
        }
        // Invariants, after every step:
        for (const each of folders) expect(folderDepth(folders, each.id)).toBeDefined(); // every chain ends at the top: no cycle
        for (const each of live()) {
          const parent = folders.find((other) => other.id === each.parentId);
          expect(each.parentId === null || parent?.deleted === false).toBe(true); // a live Folder never hangs under Trash
          expect(live().filter((other) => other.parentId === each.parentId && folderNameKey(other.name) === folderNameKey(each.name))).toHaveLength(1);
        }
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { exportFileSegment, exportSegment, planExportPaths, uniqueSegment } from './document-export.ts';

describe('export paths (16.4)', () => {
  it('turns any text into one safe path segment', () => {
    expect(exportSegment('Water bill March')).toBe('Water bill March');
    expect(exportSegment('  Müll  2026 ')).toBe('Müll 2026');
    for (const [input, safe] of [
      ['..', 'untitled'],
      ['.', 'untitled'],
      ['', 'untitled'],
      ['   ', 'untitled'],
      ['../../etc/passwd', '_.._etc_passwd'],
      ['/absolute', '_absolute'],
      ['C:\\Windows\\system32', 'C__Windows_system32'],
      ['a<b>c:d"e|f?g*h', 'a_b_c_d_e_f_g_h'],
      ['line\nbreak\ttab', 'line break tab'],
      ['nul\u0000byte', 'nul_byte'],
      ['rtl\u202Egpj.exe', 'rtl_gpj.exe'],
      ['zero\u200Bwidth', 'zero_width'],
      ['CON', '_CON'],
      ['con.txt', '_con.txt'],
      ['LPT1', '_LPT1'],
      ['trailing dots...', 'trailing dots'],
      ['.hidden', 'hidden'],
    ] as const) {
      expect({ input, safe: exportSegment(input) }).toEqual({ input, safe });
    }
    const long = exportSegment('x'.repeat(500));
    expect([...long]).toHaveLength(80);
    expect([...exportSegment('ä'.repeat(200))]).toHaveLength(80);
    // Whatever comes in, a segment is never a parent, never empty and never holds a separator.
    for (const input of ['..', '. .', '...', '/', '\\', '..\\..', './', ' .. ', '\u0000', '\u202E']) {
      const segment = exportSegment(input);
      expect({ input, ok: segment !== '' && segment !== '.' && segment !== '..' && !/[\\/]/.test(segment) }).toEqual({ input, ok: true });
    }
  });

  it('names files by page, with an extension of the detected format', () => {
    expect(exportFileSegment(1, 3, 'IMG_0001.jpg', 'JPEG')).toBe('01 - IMG_0001.jpg');
    expect(exportFileSegment(12, 12, 'scan.PDF', 'PDF')).toBe('12 - scan.PDF');
    expect(exportFileSegment(7, 120, 'page.png', 'PNG')).toBe('007 - page.png');
    // What claims to be something else gets the real extension appended; nothing executable-looking stays last.
    expect(exportFileSegment(1, 1, 'invoice.html', 'JPEG')).toBe('01 - invoice.html.jpg');
    expect(exportFileSegment(1, 1, 'setup.exe', 'PDF')).toBe('01 - setup.exe.pdf');
    expect(exportFileSegment(1, 1, 'CON.pdf', 'PDF')).toBe('01 - _CON.pdf');
    expect(exportFileSegment(1, 1, '../../x.heic', 'HEIC')).toBe('01 - _.._x.heic');
    expect(exportFileSegment(1, 1, '.pdf', 'PDF')).toBe('01 - pdf.pdf');
    expect([...exportFileSegment(1, 1, `${'n'.repeat(300)}.jpeg`, 'JPEG')].length).toBeLessThanOrEqual(80);
    expect(exportFileSegment(1, 1, `${'n'.repeat(300)}.jpeg`, 'JPEG').endsWith('.jpeg')).toBe(true);
  });

  it('numbers names that collide, comparing without case', () => {
    const taken = new Set<string>();
    expect(uniqueSegment(taken, 'Bill')).toBe('Bill');
    expect(uniqueSegment(taken, 'bill')).toBe('bill (2)');
    expect(uniqueSegment(taken, 'BILL')).toBe('BILL (3)');
    expect(uniqueSegment(taken, 'bill (2)')).toBe('bill (2) (2)');
    const long = 'x'.repeat(80);
    expect(uniqueSegment(taken, long)).toBe(long);
    expect([...uniqueSegment(taken, long)]).toHaveLength(80);
  });

  it('lays Documents out in their Folders, each in a directory of its own', () => {
    const folders = [
      { id: 'w', parentId: null, name: 'Water' },
      { id: 'y', parentId: 'w', name: '2026' },
      { id: 'e', parentId: null, name: 'Empty' },
      { id: 'w2', parentId: null, name: 'water' },
    ];
    const file = (originalName: string) => ({ originalName, format: 'JPEG' as const });
    const paths = planExportPaths(folders, [
      { id: 'a', folderId: 'w', title: 'Bill', files: [file('1.jpg'), file('1.jpg')] },
      { id: 'b', folderId: 'y', title: 'Bill', files: [file('scan.jpg')] },
      { id: 'c', folderId: 'w', title: 'Bill', files: [file('x.jpg')] },
      { id: 'd', folderId: null, title: 'Water', files: [file('x.jpg')] },
      { id: 'f', folderId: 'w2', title: 'metadata.json', files: [file('x.jpg')] },
      { id: 'g', folderId: null, title: 'metadata.json', files: [file('x.jpg')] },
      { id: 'h', folderId: 'unknown', title: 'Orphan', files: [file('x.jpg')] },
    ]);
    expect(Object.fromEntries([...paths.documents].map(([id, place]) => [id, place.files.map((name) => [...place.directory, name].join('/'))]))).toEqual({
      a: ['Water/Bill/01 - 1.jpg', 'Water/Bill/02 - 1.jpg'],
      b: ['Water/2026/Bill/01 - scan.jpg'],
      c: ['Water/Bill (2)/01 - x.jpg'],
      d: ['Water (3)/01 - x.jpg'], // "Water" and "water" are Folders already
      f: ['water (2)/metadata.json/01 - x.jpg'],
      g: ['metadata.json (2)/01 - x.jpg'], // the export's own file keeps its name
      h: ['Orphan/01 - x.jpg'],
    });
    // Folders nothing is exported from are not created.
    expect([...paths.folders.keys()].sort()).toEqual(['w', 'w2', 'y']);
  });

  it('survives a broken Folder chain', () => {
    const loop = [
      { id: 'a', parentId: 'b', name: 'A' },
      { id: 'b', parentId: 'a', name: 'B' },
    ];
    const paths = planExportPaths(loop, [{ id: 'd', folderId: 'a', title: 'Doc', files: [{ originalName: 'x.pdf', format: 'PDF' as const }] }]);
    expect(paths.documents.get('d')?.files).toEqual(['01 - x.pdf']);
  });
});

import { describe, expect, it } from 'vitest';
import type { StorageInfo } from './api.ts';
import { bytesToGigabytes, gigabytesToBytes, storageLines, storageSummary } from './storage-model.ts';

const storage: StorageInfo = { imageBytes: 300_000_000, documentBytes: 1_200_000_000, previewBytes: 40_000_000, trashBytes: 0, usedBytes: 1_540_000_000, limitBytes: 5_000_000_000, ceilingBytes: 5_000_000_000, ownLimitBytes: null };

describe('storage view model (16.4)', () => {
  it('reads a limit typed in GB, in steps of 0.1, within 100 MB to 1000 GB', () => {
    expect(gigabytesToBytes('5')).toBe(5_000_000_000);
    expect(gigabytesToBytes('0.5')).toBe(500_000_000);
    expect(gigabytesToBytes('0,5')).toBe(500_000_000); // a comma, as typed in German or Italian
    expect(gigabytesToBytes(' 2.54 ')).toBe(2_500_000_000);
    expect(gigabytesToBytes('0.1')).toBe(100_000_000);
    expect(gigabytesToBytes('1000')).toBe(1_000_000_000_000);
    for (const bad of ['', ' ', 'five', '0', '0.04', '-1', '1000.1', '1e9', 'NaN', 'Infinity']) expect({ bad, bytes: gigabytesToBytes(bad) }).toEqual({ bad, bytes: null });
    expect(bytesToGigabytes(5_000_000_000)).toBe('5');
    expect(bytesToGigabytes(500_000_000)).toBe('0.5');
    expect(gigabytesToBytes(bytesToGigabytes(2_500_000_000))).toBe(2_500_000_000);
  });

  it('lists what is stored by tool, and always says what Trash holds', () => {
    expect(storageLines(storage)).toEqual([
      { key: 'images', label: 'Procedures — instruction photos', value: '300 MB' },
      { key: 'documents', label: 'Documents — original files', value: '1.2 GB' },
      { key: 'previews', label: 'Documents — previews', value: '40 MB' },
      { key: 'trash', label: 'Trash', value: '0 bytes' },
    ]);
    expect(storageLines({ ...storage, imageBytes: 0, documentBytes: 0, previewBytes: 0, trashBytes: 300_000_000 }).map((line) => [line.key, line.value])).toEqual([['trash', '300 MB']]);
  });

  it('says how full the Workspace is, in words and as a share that never exceeds 100', () => {
    expect(storageSummary(storage)).toEqual({ text: '1.54 GB of 5 GB used', percent: 31, full: false });
    expect(storageSummary({ usedBytes: 6_000_000_000, limitBytes: 5_000_000_000 })).toMatchObject({ percent: 100, full: true }); // a limit lowered below what is stored
    expect(storageSummary({ usedBytes: 5_000_000_000, limitBytes: 5_000_000_000 })).toMatchObject({ percent: 100, full: true });
    expect(storageSummary({ usedBytes: 0, limitBytes: 0 })).toMatchObject({ percent: 100, full: true });
  });
});

import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.ts';
import { effectiveStorageLimit, parseStorageCeiling, parseStorageLimit } from './storage.ts';

const code = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (caught) {
    return caught instanceof DomainValidationError ? caught.code : 'other';
  }
  return undefined;
};

describe('Workspace storage limits (16.4)', () => {
  it('accepts a ceiling between 100 MB and 1000 GB, in whole bytes', () => {
    expect(parseStorageCeiling(100_000_000)).toBe(100_000_000);
    expect(parseStorageCeiling(5_000_000_000)).toBe(5_000_000_000);
    expect(parseStorageCeiling(1_000_000_000_000)).toBe(1_000_000_000_000);
    for (const bad of [0, -1, 99_999_999, 1_000_000_000_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect({ bad, code: code(() => parseStorageCeiling(bad)) }).toEqual({ bad, code: 'invalid_storage_ceiling' });
  });

  it('accepts the same range for a Workspace’s own limit, or none', () => {
    expect(parseStorageLimit(null)).toBeNull();
    expect(parseStorageLimit(250_000_000)).toBe(250_000_000);
    for (const bad of [0, 1, 99_999_999, 1_000_000_000_001, 2.5]) expect({ bad, code: code(() => parseStorageLimit(bad)) }).toEqual({ bad, code: 'invalid_storage_limit' });
  });

  it('applies the lower of the two — the Workspace can never have more than the ceiling', () => {
    expect(effectiveStorageLimit(5_000_000_000, null)).toBe(5_000_000_000);
    expect(effectiveStorageLimit(5_000_000_000, 1_000_000_000)).toBe(1_000_000_000);
    expect(effectiveStorageLimit(500_000_000, 1_000_000_000)).toBe(500_000_000); // the ceiling was lowered afterwards
  });
});

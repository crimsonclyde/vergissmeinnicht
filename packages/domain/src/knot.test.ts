import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.ts';
import { knotExpiresAt, knotStatus, normalizeKnotLabel, parseKnotId } from './knot.ts';

const at = new Date('2026-09-27T12:00:00.000Z');
const by = { userId: 'u' as never, displayName: 'Ada' };

describe('Knot rules', () => {
  it('normalizes labels and rejects empty, long and spoofing text', () => {
    expect(normalizeKnotLabel('  Front door  ')).toBe('Front door');
    for (const [input, code] of [
      ['   ', 'knot_label_empty'],
      ['x'.repeat(81), 'knot_label_too_long'],
      ['Door‮gnp.exe', 'knot_label_invalid_characters'],
      ['Line\nbreak', 'knot_label_invalid_characters'],
    ] as const) {
      expect(() => normalizeKnotLabel(input)).toThrow(expect.objectContaining({ code }));
    }
  });

  it('computes expiry for 1..365 whole days or none', () => {
    expect(knotExpiresAt(at, null)).toBeNull();
    expect(knotExpiresAt(at, 1)?.toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(knotExpiresAt(at, 365)?.getTime()).toBe(at.getTime() + 365 * 86_400_000);
    for (const days of [0, -1, 366, 1.5, Number.NaN]) {
      expect(() => knotExpiresAt(at, days)).toThrow(DomainValidationError);
    }
  });

  it('derives the status: revoked wins, expiry is inclusive', () => {
    const expiresAt = new Date(at.getTime() + 1000);
    expect(knotStatus({ expiresAt: null, revoked: null }, at)).toBe('ACTIVE');
    expect(knotStatus({ expiresAt, revoked: null }, at)).toBe('ACTIVE');
    expect(knotStatus({ expiresAt, revoked: null }, expiresAt)).toBe('EXPIRED');
    expect(knotStatus({ expiresAt: null, revoked: { at, by } }, at)).toBe('REVOKED');
  });

  it('accepts only canonical Knot ids', () => {
    expect(parseKnotId('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f')).toBe('3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f');
    expect(() => parseKnotId('3F1C2B9A-6D4E-4F8A-9B7C-1A2B3C4D5E6F')).toThrow(DomainValidationError);
  });
});

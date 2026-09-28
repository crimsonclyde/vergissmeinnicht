import { describe, expect, it } from 'vitest';
import { normalizeTotpCode, requiresTotpChallenge, totpLockDurationMs } from './index.ts';

const MINUTE = 60_000;

describe('MFA policy', () => {
  it('requires the TOTP challenge exactly when TOTP is enabled', () => {
    expect(requiresTotpChallenge({ totpEnabled: true })).toBe(true);
    expect(requiresTotpChallenge({ totpEnabled: false })).toBe(false);
  });

  it('escalates TOTP locks per block of ten failures, capped at 24 h', () => {
    expect(totpLockDurationMs(1)).toBe(0);
    expect(totpLockDurationMs(9)).toBe(0);
    expect(totpLockDurationMs(10)).toBe(15 * MINUTE);
    expect(totpLockDurationMs(11)).toBe(0);
    expect(totpLockDurationMs(20)).toBe(30 * MINUTE);
    expect(totpLockDurationMs(30)).toBe(60 * MINUTE);
    expect(totpLockDurationMs(200)).toBe(24 * 60 * MINUTE);
  });

  it.each([
    ['123456', '123456'],
    [' 123 456 ', '123456'],
    ['12345', undefined],
    ['1234567', undefined],
    ['12345a', undefined],
    ['１２３４５６', undefined],
    ['٤٥٦٧٨٩', undefined],
    ['', undefined],
  ])('normalizes TOTP code %j to %j', (input, expected) => {
    expect(normalizeTotpCode(input)).toBe(expected);
  });
});

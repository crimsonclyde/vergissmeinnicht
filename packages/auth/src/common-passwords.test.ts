import { describe, expect, it } from 'vitest';
import { passwordComparisonForm } from '@vergissmeinnicht/domain';
import { commonPasswords } from './common-passwords.ts';

describe('offline common/breached-password list (13.3)', () => {
  it('is bundled, sizeable and in comparison form', () => {
    expect(commonPasswords.size()).toBeGreaterThan(50_000);
    for (const entry of ['correcthorsebatterystaple', 'manchesterunited', 'qwertyuiopasdfghjkl', '123456789987654321', 'vergissmeinnicht1']) {
      expect({ entry, listed: commonPasswords.has(entry) }).toEqual({ entry, listed: true });
    }
  });

  it('only matches the comparison form of a password, and not ordinary passphrases', () => {
    expect(commonPasswords.has(passwordComparisonForm('Manchester United'))).toBe(true);
    expect(commonPasswords.has('Manchester United')).toBe(false);
    expect(commonPasswords.has(passwordComparisonForm('violet anchor lantern marmalade'))).toBe(false);
  });
});

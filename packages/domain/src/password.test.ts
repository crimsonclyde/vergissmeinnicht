import { describe, expect, it } from 'vitest';
import { DomainValidationError, validateNewPassword } from './index.ts';

describe('validateNewPassword', () => {
  it('accepts 15 to 128 characters without composition rules', () => {
    expect(() => validateNewPassword('a'.repeat(15))).not.toThrow();
    expect(() => validateNewPassword('x'.repeat(128))).not.toThrow();
  });

  it('counts code points for the minimum', () => {
    expect(() => validateNewPassword('🌼'.repeat(15))).not.toThrow();
  });

  it.each([
    ['', 'password_too_short'],
    ['a'.repeat(14), 'password_too_short'],
    ['x'.repeat(129), 'password_too_long'],
  ])('rejects %j with %s and never echoes it', (password, code) => {
    try {
      validateNewPassword(password);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).code).toBe(code);
      if (password.length > 0) expect((error as Error).message).not.toContain(password);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { DomainValidationError, passwordComparisonForm, passwordContextOf, validateNewPassword, type CommonPasswordList } from './index.ts';

const LIST: CommonPasswordList = new Set(['correcthorsebatterystaple', 'manchesterunited1']);
const screen = (context: readonly string[] = []) => ({ common: LIST, context });
const codeOf = (password: string, context: readonly string[] = []): string | undefined => {
  try {
    validateNewPassword(password, screen(context));
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    // Never echoes the rejected password.
    if (password.length > 0) expect((error as Error).message).not.toContain(password);
    return (error as DomainValidationError).code;
  }
};

describe('validateNewPassword', () => {
  it('accepts 15 to 128 characters without composition rules', () => {
    expect(codeOf('violet anchor lantern')).toBeUndefined();
    expect(codeOf('marmalade kettle drum'.padEnd(128, 'z'))).toBeUndefined();
    expect(codeOf('all lower case words only here')).toBeUndefined();
  });

  it('counts code points for the minimum', () => {
    expect(codeOf('🌼🌻🌷🌹🌺🌸💐🍀🌿🌱🌾🍁🍂🍃🌵')).toBeUndefined();
  });

  it.each([
    ['', 'password_too_short'],
    ['abcdefghijklmn'.slice(0, 14), 'password_too_short'],
    ['x'.repeat(129), 'password_too_long'],
  ])('rejects %j with %s', (password, code) => {
    expect(codeOf(password)).toBe(code);
  });

  it('rejects common/breached passwords, ignoring case, spaces and Unicode compatibility forms', () => {
    expect(codeOf('correcthorsebatterystaple')).toBe('password_too_common');
    expect(codeOf('Correct Horse Battery Staple')).toBe('password_too_common');
    expect(codeOf('ＭＡＮＣＨＥＳＴＥＲＵＮＩＴＥＤ１')).toBe('password_too_common'); // full-width → NFKC
    expect(passwordComparisonForm(' A b\tC ')).toBe('abc');
  });

  it('rejects repetitive and sequential passwords', () => {
    for (const password of ['a'.repeat(15), 'abcabcabcabcabcabc', '121212121212121212', 'abcdefghijklmnop', '123456789012345', 'zyxwvutsrqponmlk', 'qwertyuiopasdfgh', 'qwertzuiopasdfgh', '1qaz2wsx3edc4rfv']) {
      expect({ password, code: codeOf(password) }).toEqual({ password, code: 'password_too_predictable' });
    }
  });

  it('rejects passwords made mostly of the service name or the account’s own email and name', () => {
    expect(codeOf('vergissmeinnicht2026!')).toBe('password_too_predictable');
    expect(codeOf('Forget me not 1234')).toBe('password_too_predictable');
    const ada = passwordContextOf({ email: 'ada.lovelace@example.org', displayName: 'Ada Lovelace' });
    expect(codeOf('ada.lovelace@example.org', ada)).toBe('password_too_predictable');
    expect(codeOf('AdaLovelace1815!!', ada)).toBe('password_too_predictable');
    expect(codeOf('lovelace lovelace lovelace', ada)).toBe('password_too_predictable');
    // Enough of its own: accepted.
    expect(codeOf('ada likes violet anchors', ada)).toBeUndefined();
    expect(codeOf('vergissmeinnicht keeps my kettle safe')).toBeUndefined();
  });
});

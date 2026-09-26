import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  canAuthenticate,
  normalizeDisplayName,
  normalizeEmail,
  parseUserId,
} from './index.ts';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainValidationError');
}

describe('normalizeEmail', () => {
  it('trims and lower-cases the whole address', () => {
    expect(normalizeEmail('  Alice.Example@Example.ORG ')).toBe('alice.example@example.org');
  });

  it('maps case and Unicode-composition variants to the same identity', () => {
    const composed = normalizeEmail('Jörg@example.org');
    const decomposed = normalizeEmail('JÖRG@EXAMPLE.org');
    expect(decomposed).toBe(composed);
  });

  it.each([
    '',
    'no-at-sign',
    'two@@example.org',
    'a@b@example.org',
    'space in@example.org',
    'user@nodot',
    'user@.example.org',
    'user@example..org',
    'user@example.org\u0000',
    'line\nbreak@example.org',
  ])('rejects %j', (input) => {
    expect(codeOf(() => normalizeEmail(input))).toBe('invalid_email');
  });

  it('enforces length limits', () => {
    expect(codeOf(() => normalizeEmail(`${'a'.repeat(65)}@example.org`))).toBe('email_too_long');
    expect(codeOf(() => normalizeEmail(`a@${'b'.repeat(250)}.org`))).toBe('email_too_long');
  });

  it('does not echo the rejected input in the error message', () => {
    try {
      normalizeEmail('secret-looking value');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-looking');
    }
  });
});

describe('normalizeDisplayName', () => {
  it('trims and NFC-normalizes', () => {
    expect(normalizeDisplayName('  Jörg ')).toBe('Jörg');
  });

  it('allows emoji and non-Latin scripts', () => {
    expect(normalizeDisplayName('Лена 🌼')).toBe('Лена 🌼');
  });

  it('rejects empty names', () => {
    expect(codeOf(() => normalizeDisplayName('   '))).toBe('display_name_empty');
  });

  it('counts length in code points', () => {
    expect(normalizeDisplayName('🌼'.repeat(80))).toHaveLength(160);
    expect(codeOf(() => normalizeDisplayName('a'.repeat(81)))).toBe('display_name_too_long');
  });

  it.each(['Eve‮nimda', 'Eve⁦x⁩', 'Tab\tName', 'New\nLine'])(
    'rejects control or bidi-override characters in %j',
    (input) => {
      expect(codeOf(() => normalizeDisplayName(input))).toBe('display_name_invalid_characters');
    },
  );
});

describe('parseUserId', () => {
  it('accepts a lower-case UUIDv4', () => {
    expect(parseUserId('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e')).toBe('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e');
  });

  it.each(['1', '3F2B8C1E-4D5A-4B6C-8D7E-9F0A1B2C3D4E', '3f2b8c1e-4d5a-1b6c-8d7e-9f0a1b2c3d4e', "' OR 1=1 --"])(
    'rejects %j',
    (input) => {
      expect(codeOf(() => parseUserId(input))).toBe('invalid_user_id');
    },
  );
});

describe('canAuthenticate', () => {
  it('allows only ACTIVE users', () => {
    expect(canAuthenticate({ status: 'ACTIVE' })).toBe(true);
    expect(canAuthenticate({ status: 'DISABLED' })).toBe(false);
  });
});

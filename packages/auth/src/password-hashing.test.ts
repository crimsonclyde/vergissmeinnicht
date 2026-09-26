import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password-hashing.ts';

const PASSWORD = 'correct horse battery staple';

describe('password hashing', () => {
  it('produces Argon2id PHC strings with the reviewed parameters', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(stored).not.toContain(PASSWORD);
  });

  it('salts every hash', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, `${PASSWORD} `)).toBe(false);
    expect(await verifyPassword(stored, PASSWORD.toUpperCase())).toBe(false);
    expect(await verifyPassword(stored, '')).toBe(false);
  });

  it('treats Unicode composition variants as the same password (NFKC)', async () => {
    const stored = await hashPassword('Jörg-passphrase-2026');
    expect(await verifyPassword(stored, 'Jörg-passphrase-2026')).toBe(true);
  });

  it.each(['', 'not-a-hash', 'salt:hex-from-scrypt', '$argon2id$v=19$m=65536,t=3,p=1$broken'])(
    'never matches (and never throws) for malformed stored hash %j',
    async (stored) => {
      expect(await verifyPassword(stored, PASSWORD)).toBe(false);
    },
  );
});

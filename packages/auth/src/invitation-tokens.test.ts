import { describe, expect, it } from 'vitest';
import { invitationTokens } from './invitation-tokens.ts';

describe('invitationTokens', () => {
  it('generates 256-bit url-safe tokens and stores only a SHA-256 hash', () => {
    const { token, hash } = invitationTokens.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(invitationTokens.hash(token)).toBe(hash);
  });

  it('never repeats tokens', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => invitationTokens.generate().token));
    expect(tokens.size).toBe(1000);
  });

  it.each(['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}/`, '../../etc/passwd'])(
    'rejects malformed token %j without hashing',
    (input) => {
      expect(invitationTokens.hash(input)).toBeUndefined();
    },
  );
});

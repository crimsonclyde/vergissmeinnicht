import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secret-box.ts';

const KEY = 'k'.repeat(48);
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('secret box', () => {
  const box = createSecretBox(KEY);

  it('round-trips and never contains the plaintext', () => {
    const sealed = box.seal(SECRET, 'totp-secret:user-1');
    expect(sealed).toMatch(/^v1\.[\w-]{16}\.[\w-]+\.[\w-]{22}$/);
    expect(sealed).not.toContain(SECRET);
    expect(box.open(sealed, 'totp-secret:user-1')).toBe(SECRET);
  });

  it('uses a fresh IV per seal', () => {
    expect(box.seal(SECRET, 'c')).not.toBe(box.seal(SECRET, 'c'));
  });

  it('does not open in another context (row swap)', () => {
    expect(box.open(box.seal(SECRET, 'totp-secret:user-1'), 'totp-secret:user-2')).toBeUndefined();
  });

  it('does not open with another key', () => {
    expect(createSecretBox('x'.repeat(48)).open(box.seal(SECRET, 'c'), 'c')).toBeUndefined();
  });

  it('detects tampering and malformed input', () => {
    const sealed = box.seal(SECRET, 'c');
    const parts = sealed.split('.');
    const flip = (value: string) => (value[0] === 'A' ? 'B' : 'A') + value.slice(1);
    for (const index of [1, 2, 3]) {
      const tampered = parts.map((part, i) => (i === index ? flip(part) : part)).join('.');
      expect(box.open(tampered, 'c')).toBeUndefined();
    }
    for (const bad of ['', 'v1', 'v2.a.b.c', `${sealed}.extra`, SECRET]) {
      expect(box.open(bad, 'c')).toBeUndefined();
    }
  });
});

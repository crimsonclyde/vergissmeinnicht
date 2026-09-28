import { describe, expect, it } from 'vitest';
import { recoveryCodes, totpAlgorithm } from './totp.ts';

// RFC 6238 appendix B: ASCII "12345678901234567890", SHA-1; at T=59 s the 8-digit code is 94287082.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const at = (seconds: number) => new Date(seconds * 1000);

describe('totpAlgorithm', () => {
  it('matches the RFC 6238 test vector and reports its time step', () => {
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287082', at(59))).toBe(1);
  });

  it('accepts one step of clock drift on each side, not more', () => {
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287082', at(89))).toBe(1);
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287082', at(29))).toBe(1);
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287082', at(95))).toBeUndefined();
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287082', at(0))).toBe(1);
  });

  it('rejects wrong codes', () => {
    expect(totpAlgorithm.matchStep(RFC_SECRET, '287083', at(59))).toBeUndefined();
    expect(totpAlgorithm.matchStep(RFC_SECRET, '000000', at(59))).toBeUndefined();
  });

  it('generates distinct 160-bit base32 secrets and a provisioning URI', () => {
    const secret = totpAlgorithm.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpAlgorithm.generateSecret()).not.toBe(secret);
    const uri = new URL(totpAlgorithm.provisioningUri(secret, 'ada@example.org'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('VergissMeinNicht');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
    expect(decodeURIComponent(uri.pathname)).toContain('ada@example.org');
  });
});

describe('recoveryCodes', () => {
  it('generates distinct 80-bit codes and stores only hashes', () => {
    const { codes, hashes } = recoveryCodes.generate(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const [index, code] of codes.entries()) {
      expect(code).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/);
      expect(hashes[index]).toMatch(/^[0-9a-f]{64}$/);
      expect(hashes[index]).not.toContain(code.replaceAll('-', ''));
      expect(recoveryCodes.hash(code)).toBe(hashes[index]);
    }
  });

  it('tolerates case, spaces and missing dashes when hashing input', () => {
    const { codes, hashes } = recoveryCodes.generate(1);
    const code = codes[0] ?? '';
    expect(recoveryCodes.hash(` ${code.toUpperCase().replaceAll('-', ' ')} `)).toBe(hashes[0]);
    expect(recoveryCodes.hash(code.replaceAll('-', ''))).toBe(hashes[0]);
  });

  it.each(['', '123456', 'abcd-efgh-ijkl-mno1', 'abcd-efgh-ijkl-mnopq', 'abcd-efgh-ijkl-mn0p'])('rejects %j', (input) => {
    expect(recoveryCodes.hash(input)).toBeUndefined();
  });
});

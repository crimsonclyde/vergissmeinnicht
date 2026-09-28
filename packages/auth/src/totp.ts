import { createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import type { RecoveryCodes, TotpAlgorithm } from '@vergissmeinnicht/application';
import { TOTP_DIGITS, TOTP_PERIOD_SECONDS, TOTP_SECRET_BYTES, TOTP_WINDOW } from '@vergissmeinnicht/domain';

const ISSUER = 'VergissMeinNicht';

function totpFor(secret: string, account = '') {
  return new TOTP({
    issuer: ISSUER,
    label: account,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(secret),
  });
}

/** RFC 6238 via `otpauth` (constant-time comparison inside the library). */
export const totpAlgorithm: TotpAlgorithm = {
  generateSecret() {
    // `otpauth` draws the bytes from node:crypto randomBytes.
    return new Secret({ size: TOTP_SECRET_BYTES }).base32;
  },
  provisioningUri(secret, account) {
    return totpFor(secret, account).toString();
  },
  matchStep(secret, code, now) {
    const timestamp = now.getTime();
    const delta = totpFor(secret).validate({ token: code, timestamp, window: TOTP_WINDOW });
    return delta === null ? undefined : TOTP.counter({ period: TOTP_PERIOD_SECONDS, timestamp }) + delta;
  },
};

// RFC 4648 base32 alphabet (no 0/1/8/9, avoids O/0 and I/1 confusion); 16 symbols = 80 bits.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const CODE_SYMBOLS = 16;
const CODE_FORMAT = /^[a-z2-7]{16}$/;

function randomCode(): string {
  // 5 bits per symbol taken from a CSPRNG byte: 256 is a multiple of 32, so there is no modulo bias.
  return Array.from(randomBytes(CODE_SYMBOLS), (byte) => ALPHABET[byte % 32]).join('');
}

const format = (code: string) => code.match(/.{4}/g)?.join('-') ?? code;
const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * 80-bit single-use recovery codes, displayed as `xxxx-xxxx-xxxx-xxxx`. Stored as SHA-256 hashes:
 * a fast hash is adequate for full-entropy random values (as for invitation tokens).
 */
export const recoveryCodes: RecoveryCodes = {
  generate(count) {
    const raw = Array.from({ length: count }, randomCode);
    return { codes: raw.map(format), hashes: raw.map(sha256Hex) };
  },
  hash(input) {
    const code = input.toLowerCase().replace(/[\s-]/g, '');
    return CODE_FORMAT.test(code) ? sha256Hex(code) : undefined;
  },
};

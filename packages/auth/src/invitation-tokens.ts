import { createHash, randomBytes } from 'node:crypto';
import type { InvitationTokens } from '@vergissmeinnicht/application';

const TOKEN_BYTES = 32;
/** 32 random bytes in unpadded base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/**
 * 256-bit CSPRNG tokens. A fast SHA-256 is appropriate here (unlike for passwords) because the
 * input already has full entropy; the hash only keeps a DB leak from yielding usable links.
 */
export const invitationTokens: InvitationTokens = {
  generate() {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    return { token, hash: sha256Hex(token) };
  },
  hash(token: string) {
    return TOKEN_FORMAT.test(token) ? sha256Hex(token) : undefined;
  },
};

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

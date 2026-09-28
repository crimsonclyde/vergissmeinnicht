import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { SecretBox } from '@vergissmeinnicht/application';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Purpose label for HKDF; a new purpose (or algorithm) gets a new label and version prefix. */
const HKDF_INFO = 'vergissmeinnicht/secret-box/aes-256-gcm/v1';

/**
 * AES-256-GCM (Node/OpenSSL) with a key derived by HKDF-SHA256 from DATA_ENCRYPTION_KEY.
 * Format: `v1.<iv>.<ciphertext>.<tag>` (base64url). `context` (e.g. `totp-secret:<userId>`) is
 * authenticated as associated data, so a sealed value copied to another row does not open.
 */
export function createSecretBox(masterKey: string): SecretBox {
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(masterKey, 'utf8'), Buffer.alloc(0), HKDF_INFO, 32));

  return {
    seal(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, ciphertext, cipher.getAuthTag()]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    open(sealed, context) {
      const [version, iv, ciphertext, tag, ...rest] = sealed.split('.');
      if (version !== VERSION || iv === undefined || ciphertext === undefined || tag === undefined || rest.length > 0) {
        return undefined;
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(context, 'utf8'));
        decipher.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
      } catch {
        return undefined;
      }
    },
  };
}

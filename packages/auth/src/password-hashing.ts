import { hash, verify, type Algorithm, type Options } from '@node-rs/argon2';
import type { PasswordHasher } from '@vergissmeinnicht/application';

/**
 * Argon2id parameters (docs/development/security.md §1). RFC 9106's memory profile (64 MiB, 3 passes) with a
 * single lane; above the OWASP minimum (19 MiB, 2 passes). Changing them affects only new hashes:
 * existing PHC strings carry their own parameters and keep verifying.
 */
export const ARGON2ID_OPTIONS = Object.freeze({
  // `Algorithm` is an ambient const enum, which isolated modules cannot reference by name. 2 = Argon2id.
  algorithm: 2 as Algorithm,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} satisfies Options);

/**
 * NFKC normalization makes visually identical input (e.g. composed vs. decomposed umlauts from
 * different keyboards) verify against the same hash, as recommended by NIST SP 800-63B.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/** Returns a PHC string (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`) with a random 16-byte salt. */
export async function hashPassword(password: string): Promise<string> {
  return hash(normalize(password), ARGON2ID_OPTIONS);
}

/**
 * Constant-time verification by the library. A malformed or foreign stored hash never matches;
 * it does not throw, so a corrupt credential row cannot turn into an error-based oracle.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, normalize(password));
  } catch {
    return false;
  }
}

export const passwordHasher: PasswordHasher = { hash: hashPassword };

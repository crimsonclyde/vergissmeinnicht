/** Memory-hard password hashing (Argon2id). Implementations own parameters and encoding. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
}

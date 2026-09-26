/** High-entropy single-use tokens. Only the hash is ever persisted. */
export interface InvitationTokens {
  generate(): { readonly token: string; readonly hash: string };
  /** Returns `undefined` for malformed input so callers can fail without touching storage. */
  hash(token: string): string | undefined;
}

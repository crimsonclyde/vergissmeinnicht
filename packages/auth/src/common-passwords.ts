import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CommonPasswordList } from '@vergissmeinnicht/domain';

/**
 * The offline list of common/breached passwords (13.3): ~60 000 passwords of 15+ characters from
 * public breach corpora, in comparison form (NFKC, lower case, no white space), one per line,
 * gzip-compressed. Passwords are never sent anywhere; the list is loaded once, on first use.
 * Provenance and update procedure: `data/README.md`, `scripts/update-common-passwords.ts`.
 */
const LIST_FILE = new URL('../data/common-passwords.txt.gz', import.meta.url);

let loaded: ReadonlySet<string> | undefined;

function load(): ReadonlySet<string> {
  loaded ??= new Set(
    gunzipSync(readFileSync(LIST_FILE))
      .toString('utf8')
      .split('\n')
      .filter((line) => line.length > 0),
  );
  return loaded;
}

export const commonPasswords: CommonPasswordList & { readonly size: () => number } = {
  has: (comparisonForm) => load().has(comparisonForm),
  size: () => load().size,
};

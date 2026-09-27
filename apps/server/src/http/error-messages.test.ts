import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every stable error code the API maps must have user-facing text in the web catalog (steps.md 8.4).
const errorsSource = readFileSync(resolve(import.meta.dirname, 'errors.ts'), 'utf8');
const catalogSource = readFileSync(resolve(import.meta.dirname, '../../../web/src/i18n/en.ts'), 'utf8');
/** Deliberately generic on the client. */
const WITHOUT_OWN_TEXT = new Set(['internal_error']);

describe('API error codes', () => {
  it('all have a message in the web catalog', () => {
    const codes = [...new Set([...errorsSource.matchAll(/error: '([a-z_]+)'/g)].map((match) => match[1] ?? ''))];
    expect(codes.length).toBeGreaterThan(30);
    const missing = codes.filter((code) => !WITHOUT_OWN_TEXT.has(code) && !catalogSource.includes(`'error.${code}':`));
    expect(missing).toEqual([]);
  });
});

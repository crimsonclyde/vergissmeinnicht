import { describe, expect, it } from 'vitest';
import { en } from './en.ts';

// Every message must be used somewhere, so the catalog does not collect dead text (steps.md 8.4/8.6).
const sources = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const code = Object.entries(sources)
  // Files next to this test appear as './…', the rest as '../…'; the catalog itself must not count.
  .filter(([path]) => !path.startsWith('./') && !path.includes('/i18n/') && !path.endsWith('.test.ts'))
  .map(([, text]) => text)
  .join('\n');

/** Keys built at runtime, e.g. t(`state.${state}`); `error.*` keys are chosen by server error codes. */
const DYNAMIC_PREFIXES = [
  'state.',
  'stateCount.',
  'runState.',
  'role.',
  'roleHelp.',
  'live.',
  'appearance.',
  'icon.',
  'policy.',
  'knot.target.',
  'knot.status.',
  'knot.lifetime.',
  'admin.status.',
  'securityEvent.',
  'criticalConfirm.',
  'history.',
  'error.',
];

describe('message catalog', () => {
  it('has no unused messages', () => {
    const unused = Object.keys(en).filter(
      (key) => !code.includes(`'${key}'`) && !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });
});

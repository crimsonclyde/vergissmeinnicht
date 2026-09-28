import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noticesFor, packageRootOf } from '../third-party-notices.ts';

describe('third-party notices (10.4)', () => {
  const nm = `${sep}app${sep}node_modules${sep}`;
  it('finds the package directory of bundled modules', () => {
    expect(packageRootOf(`${nm}.pnpm${sep}react@19.3.0${sep}node_modules${sep}react${sep}index.js`)).toBe(
      `${nm}.pnpm${sep}react@19.3.0${sep}node_modules${sep}react`,
    );
    expect(packageRootOf(`${nm}@scope${sep}pkg${sep}lib${sep}a.js?commonjs-proxy`)).toBe(`${nm}@scope${sep}pkg`);
    expect(packageRootOf(`${sep}app${sep}apps${sep}web${sep}src${sep}main.tsx`)).toBeNull();
  });

  it('includes name, version, license and the license text', () => {
    const react = resolve(import.meta.dirname, '../node_modules/react');
    const text = noticesFor([react, react]);
    expect(text).toMatch(/react@\d+\.\d+\.\d+ \(MIT\)/);
    expect(text).toContain('Permission is hereby granted');
    expect(text.match(/react@/g)).toHaveLength(1);
  });
});

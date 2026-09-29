import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for output escaping (13.2): user text (Procedure/Step titles, reasons, names) reaches
 * the page only through React's escaped text rendering — never through an HTML sink.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('HTML sinks in the web client (13.2)', () => {
  it('uses none', () => {
    const sink = /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
    const offenders = sourceFiles(resolve(import.meta.dirname, '../../../web/src')).filter((path) => sink.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

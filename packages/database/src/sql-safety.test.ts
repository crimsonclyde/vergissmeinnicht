import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static guard for SQL safety (13.2): queries are built by Drizzle, whose `sql` template parameterizes
 * every interpolated value. Raw SQL fragments are allowed only in the schema's CHECK constraints,
 * where they are built from compile-time domain constants — never from input.
 */
const SOURCE_DIR = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'test-support.ts' ? [path] : [];
  });
}

describe('SQL construction (13.2)', () => {
  const files = sourceFiles(SOURCE_DIR).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('uses sql.raw only in schema CHECK constraints', () => {
    const offenders = files.filter((file) => file.text.includes('sql.raw(') && !file.path.endsWith('schema.ts'));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('never builds prepare()/exec() statements from template literals with interpolation', () => {
    const offenders = files.filter((file) => /\.(prepare|exec|run|all|get)\(\s*`[^`]*\$\{/.test(file.text));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  it('never concatenates strings into prepare()/exec()', () => {
    const offenders = files.filter((file) => /\.(prepare|exec)\(\s*['"][^'"]*['"]\s*\+/.test(file.text));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

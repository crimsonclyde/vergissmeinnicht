import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The web client's sources; checked here because the web package must not import Node modules. */
const root = fileURLToPath(new URL('../../web/src/', import.meta.url));

/**
 * Where a theme id may appear in CSS (45.5). Theme files define tokens and their own chrome; feature
 * CSS reads the surface roles (see the comment block in `styles.css`) and `data-scheme` only.
 */
const THEME_CSS: Readonly<Record<string, string>> = {
  'styles.css': 'theme token blocks and shell chrome',
  'everyday-themes.css': 'Light theme chrome',
  'tokyo-nights.css': 'Tokyo Nights theme',
  'witch-forest.css': 'Witch Forest theme',
  'places.css': 'Places themes',
  'settings-theme.css': 'the Settings theme (45.6)',
  'nav/navigation.css': 'the navigation each theme decides (46): the Places dock',
  'guide/guide.css': 'the Galactic Guide layout',
  'applets/sky-card.css': 'Galactic Guide card art behind the sky card',
  'applets/combined-instruments.css': 'Galactic Guide instrument layout',
};

function cssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [relative(root, path)] : [];
  });
}

describe('feature CSS uses surface roles, not theme ids (45.5)', () => {
  it('names no theme outside the theme files', () => {
    const offenders = cssFiles(root).filter((file) => !(file in THEME_CSS) && /data-theme\s*=/.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('lists only theme files that exist', () => {
    const files = new Set(cssFiles(root));
    expect(Object.keys(THEME_CSS).filter((file) => !files.has(file))).toEqual([]);
  });
});

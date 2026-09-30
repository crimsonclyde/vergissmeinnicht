import { describe, expect, it } from 'vitest';
import { buildCatalog, curatedEntries, pascal, type CatalogInput } from '../icon-catalog.ts';

const REGISTRY = `const CURATED_ICONS = {
  home: { art: IconHome, group: 'home', keywords: 'house' },
  'fuse-box': { art: FuseBoxArt, group: 'utilities', keywords: 'fuse' },
};`;

const TABLER: CatalogInput['tabler'] = {
  home: { name: 'home', tags: ['house', 'living'], styles: { outline: {} } },
  outlet: { name: 'outlet', tags: ['socket', 'plug', 'electricity', 12], styles: { outline: {} } },
  propeller: { name: 'propeller', tags: ['fan', 'air', 'blade'], styles: { outline: {} } },
  'filled-only': { name: 'filled-only', tags: [], styles: {} },
};

const input = (selection: CatalogInput['selection'], previousKeys: readonly string[] = []): CatalogInput => ({
  selection,
  tabler: TABLER,
  tablerVersion: '3.48.0',
  registrySource: REGISTRY,
  previousKeys,
});

describe('icon catalogue generator', () => {
  it('reads the hand-written registry and names Tabler components', () => {
    expect([...curatedEntries(REGISTRY)]).toEqual([
      ['home', 'IconHome'],
      ['fuse-box', 'FuseBoxArt'],
    ]);
    expect(pascal('device-tv-old')).toBe('IconDeviceTvOld');
  });

  it('writes keys, labels, VMN aliases and Tabler tags — never artwork into data', () => {
    const output = buildCatalog(input({ utilities: ['outlet|Socket|wall socket', 'propeller'] }));
    expect(output.keys).toEqual(['outlet', 'propeller']);
    expect(output.catalog).toContain("outlet: { art: IconOutlet, group: 'utilities', label: 'Socket', aliases: 'wall socket', tags: 'plug electricity' },");
    expect(output.catalog).toContain("propeller: { art: IconPropeller, group: 'utilities', label: 'Propeller', aliases: '', tags: 'fan air blade' },");
    expect(output.catalog).toContain("home: 'house living',"); // tags of hand-written artwork
    expect(output.domainKeys).toContain("  'outlet',\n  'propeller',\n] as const;");
    expect(output.domainKeys).not.toMatch(/Icon[A-Z]/);
  });

  it('refuses unknown or non-outline Tabler icons, clashing keys, reused artwork and bad key formats', () => {
    expect(() => buildCatalog(input({ misc: ['no-such-icon'] }))).toThrow(/not an outline icon/);
    expect(() => buildCatalog(input({ misc: ['filled-only'] }))).toThrow(/not an outline icon/);
    expect(() => buildCatalog(input({ misc: ['outlet>fuse-box'] }))).toThrow(/already a hand-written icon/);
    expect(() => buildCatalog(input({ misc: ['home>house'] }))).toThrow(/already the artwork of "home"/);
    expect(() => buildCatalog(input({ misc: ['outlet', 'propeller>outlet'] }))).toThrow(/selected twice/);
    expect(() => buildCatalog(input({ misc: ['outlet>Outlet'] }))).toThrow(/must match/);
    expect(() => buildCatalog(input({ misc: ['outlet>__proto__'] }))).toThrow(/must match/);
  });

  it('drops misleading Tabler tags listed in $ignoreTags, and refuses unknown keys there', () => {
    const output = buildCatalog(input({ $ignoreTags: { propeller: 'air', home: 'living' }, utilities: ['propeller'] }));
    expect(output.catalog).toContain("tags: 'fan blade' },");
    expect(output.catalog).toContain("  home: 'house',");
    expect(() => buildCatalog(input({ $ignoreTags: { nope: 'x' }, utilities: ['propeller'] }))).toThrow(/unknown key "nope"/);
  });

  it('never drops or reorders a key generated before (stored data depends on it)', () => {
    expect(() => buildCatalog(input({ utilities: ['outlet'] }, ['propeller', 'outlet']))).toThrow(/"propeller" was generated before/);
    const output = buildCatalog(input({ utilities: ['outlet', 'propeller'] }, ['propeller']));
    expect(output.keys).toEqual(['propeller', 'outlet']);
  });
});

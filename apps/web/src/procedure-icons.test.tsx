import { PROCEDURE_ICONS } from '@vergissmeinnicht/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { hasMessage } from './i18n/index.ts';
import { SUGGESTED_ICONS } from './IconPicker.tsx';
import { AppIcon, ICON_COUNT, ICON_GROUPS, ICON_REGISTRY, isIconKey, searchIcons, type IconGroupKey } from './procedure-icons.tsx';

/** Every key stored before the Tabler icon set (0.2.0-beta.2): these must keep working forever. */
const KEYS_BEFORE_TABLER = (
  'checklist home kitchen cleaning laundry garden pet car travel tools health shopping document security star power water gas ' +
  'heating internet wifi lights trash recycling door window key plant bed bath onboarding offboarding team work calendar mail ' +
  'phone school computer server backup update launch medication baby food coffee fitness fire-safety warning alarm bike weather ' +
  'snow sun delivery money clock settings camera chimney'
).split(' ');

const found = (query: string, group: IconGroupKey | null = null) => searchIcons(query, group).flatMap((entry) => entry.icons);

describe('icon registry', () => {
  it('covers exactly the trusted keys, each with artwork, a name and one category', () => {
    expect(Object.keys(ICON_REGISTRY).sort()).toEqual([...PROCEDURE_ICONS].sort());
    for (const icon of PROCEDURE_ICONS) {
      expect(ICON_REGISTRY[icon].art, icon).toBeTruthy();
      expect(hasMessage(`icon.${icon}`), icon).toBe(true);
    }
    const grouped = ICON_GROUPS.flatMap((group) => group.icons);
    expect([...grouped].sort()).toEqual([...PROCEDURE_ICONS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const group of ICON_GROUPS) {
      expect(hasMessage(group.name), group.name).toBe(true);
      expect(group.icons.length, group.key).toBeGreaterThan(0);
    }
    expect(ICON_COUNT).toBe(PROCEDURE_ICONS.length);
  });

  it('is much broader than before and covers the requested topics', () => {
    expect(PROCEDURE_ICONS.length).toBeGreaterThanOrEqual(200);
    for (const icon of ['freezer', 'fridge', 'stove', 'vacuum', 'lawn-mower', 'smoke-alarm', 'first-aid', 'box', 'compost', 'reminder', 'repeat', 'dog', 'router'] as const) {
      expect(PROCEDURE_ICONS).toContain(icon);
    }
  });

  it('keeps every key stored before the Tabler set (backwards compatibility)', () => {
    for (const key of KEYS_BEFORE_TABLER) {
      expect(isIconKey(key), key).toBe(true);
      expect(renderToStaticMarkup(<AppIcon name={key} />)).not.toContain('Other icon');
    }
  });

  it('suggests a few distinct, existing icons first (13.16)', () => {
    expect(SUGGESTED_ICONS.length).toBeGreaterThanOrEqual(6);
    expect(SUGGESTED_ICONS.length).toBeLessThanOrEqual(10);
    expect(new Set(SUGGESTED_ICONS).size).toBe(SUGGESTED_ICONS.length);
    for (const icon of SUGGESTED_ICONS) expect(PROCEDURE_ICONS).toContain(icon);
  });
});

describe('AppIcon', () => {
  it('renders a known key as one outline SVG in the text colour, labelled for screen readers', () => {
    const html = renderToStaticMarkup(<AppIcon name="freezer" />);
    expect(html).toMatch(/^<span class="app-icon" role="img" aria-label="Freezer" title="Freezer"><svg /);
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.75"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/fill="#|stroke="#/); // no hard-coded (multi)colour
    // The drawn gas bottle and chimney follow the same style.
    for (const name of ['gas', 'chimney']) {
      const drawn = renderToStaticMarkup(<AppIcon name={name} />);
      expect(drawn).toContain('stroke="currentColor"');
      expect(drawn).toContain('stroke-width="1.75"');
    }
  });

  it('can be decorative next to a visible label', () => {
    const html = renderToStaticMarkup(<AppIcon name="home" decorative />);
    expect(html).toMatch(/^<span class="app-icon" aria-hidden="true"><svg /);
    expect(html).not.toContain('role="img"');
  });

  it('falls back to a neutral icon for unknown, removed or malicious values', () => {
    const fallback = renderToStaticMarkup(<AppIcon name="no-such-icon" />);
    expect(fallback).toContain('aria-label="Other icon"');
    for (const value of [
      'IconSnowflake', // a library component name is not a VMN key
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      '<img src=x onerror=alert(1)>',
      '"><script>alert(1)</script>',
      'javascript:alert(1)',
      'https://evil.example/icon.svg',
      '../../etc/passwd',
      '',
      'HOME',
    ]) {
      expect(isIconKey(value), value).toBe(false);
      const html = renderToStaticMarkup(<AppIcon name={value} />);
      expect(html, value).toBe(fallback);
    }
    expect(isIconKey(undefined)).toBe(false);
    expect(isIconKey(null)).toBe(false);
    expect(isIconKey(42)).toBe(false);
  });
});

describe('icon search and categories', () => {
  it('finds icons by name, key and aliases', () => {
    expect(found('power')).toContain('power');
    expect(found('electricity')).toContain('power');
    expect(found('plug')).toContain('power');
    expect(found('fridge')).toEqual(expect.arrayContaining(['fridge', 'freezer']));
    expect(found('refrigerator')).toEqual(expect.arrayContaining(['fridge', 'freezer']));
    expect(found('trash')).toContain('trash');
    expect(found('bin')).toContain('trash');
    expect(found('car')).toContain('car');
    expect(found('vehicle')).toEqual(expect.arrayContaining(['car', 'motorbike', 'truck']));
    expect(found('door')).toContain('door');
    expect(found('key')).toContain('key');
    expect(found('access')).toEqual(expect.arrayContaining(['door', 'key']));
    expect(found('fire')).toEqual(expect.arrayContaining(['heating', 'fire-safety', 'chimney']));
    expect(found('water')).toContain('water');
    expect(found('plumbing')).toContain('water');
  });

  it('matches word starts, case-insensitively, with every word of the query', () => {
    expect(found('TRAV')).toContain('travel');
    expect(found('trav')).not.toContain('power');
    expect(found('washing machine')).toEqual(['laundry']);
    expect(found('zzzz')).toEqual([]);
    // Punctuation and markup are just separators, never patterns.
    expect(found('.*')).toHaveLength(PROCEDURE_ICONS.length);
    expect(found('<script>')).toEqual([]);
  });

  it('filters by category, alone or with a search', () => {
    const kitchen = searchIcons('', 'kitchen');
    expect(kitchen).toHaveLength(1);
    expect(kitchen[0]?.icons).toEqual(expect.arrayContaining(['kitchen', 'fridge', 'freezer', 'stove']));
    expect(found('', 'utilities').slice(0, 2)).toEqual(['power', 'water']); // keyboard order in the picker
    expect(found('fridge', 'kitchen')).toEqual(['fridge', 'freezer']);
    expect(found('fridge', 'garden')).toEqual([]);
    expect(searchIcons('')).toHaveLength(ICON_GROUPS.length);
  });
});

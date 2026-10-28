import { describe, expect, it } from 'vitest';
import { THEMES, THEME_MODES, canonicalThemeMode, effectiveMode, isThemeMode, parseWorkspaceThemes, resolveTheme } from './theme.ts';

describe('theme selection', () => {
  it('resolves System from the device setting and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('memento-mori');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('memento-mori');
    expect(resolveTheme('memento-mori', false)).toBe('memento-mori');
    expect(resolveTheme('tokyo-nights', false)).toBe('tokyo-nights');
    expect(resolveTheme('witch-forest', false)).toBe('witch-forest');
  });

  it('keeps the old dark id valid but offers only one dark base theme', () => {
    expect(isThemeMode('dark')).toBe(true);
    expect(canonicalThemeMode('dark')).toBe('memento-mori');
    expect(canonicalThemeMode('light')).toBe('light');
    expect(THEME_MODES).not.toContain('dark');
    expect(THEME_MODES).toContain('memento-mori');
  });

  it('accepts only known modes from storage', () => {
    for (const mode of THEME_MODES) expect(isThemeMode(mode)).toBe(true);
    for (const value of [null, '', 'Dark', 'Memento Mori', 'Tokyo Nights', 'tokyo_nights', 'Witch Forest', 'witch_forest', '__proto__', 1]) expect(isThemeMode(value)).toBe(false);
  });

  it('resolves every mode to a theme that exists', () => {
    for (const mode of THEME_MODES) {
      for (const dark of [true, false]) expect(THEMES).toContain(resolveTheme(mode, dark));
    }
  });

  it('uses a Workspace’s own theme, else the default (section 28)', () => {
    expect(effectiveMode('witch-forest', null)).toBe('witch-forest');
    expect(effectiveMode('witch-forest', 'tokyo-nights')).toBe('tokyo-nights');
    expect(effectiveMode('system', 'light')).toBe('light');
    expect(resolveTheme(effectiveMode('light', 'dark'), false)).toBe('memento-mori');
  });

  it('keeps only known themes of plausible Workspace ids from this browser’s copy', () => {
    const id = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
    expect(parseWorkspaceThemes({ [id]: 'dark' })).toEqual({ [id]: 'dark' });
    expect(parseWorkspaceThemes({ [id]: 'tokyo-nights', other: 'dark', [id.replace('3', '4')]: 'neon', __proto__: 'dark' })).toEqual({ [id]: 'tokyo-nights' });
    for (const value of [null, 'dark', [], 1]) expect(parseWorkspaceThemes(value)).toEqual({});
  });
});

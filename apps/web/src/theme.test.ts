import { describe, expect, it } from 'vitest';
import { THEMES, THEME_MODES, isThemeMode, resolveTheme } from './theme.ts';

describe('theme selection', () => {
  it('resolves System from the device setting and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('memento-mori', false)).toBe('memento-mori');
  });

  it('accepts only known modes from storage', () => {
    for (const mode of THEME_MODES) expect(isThemeMode(mode)).toBe(true);
    for (const value of [null, '', 'Dark', 'Memento Mori', '__proto__', 1]) expect(isThemeMode(value)).toBe(false);
  });

  it('resolves every mode to a theme that exists', () => {
    for (const mode of THEME_MODES) {
      for (const dark of [true, false]) expect(THEMES).toContain(resolveTheme(mode, dark));
    }
  });
});

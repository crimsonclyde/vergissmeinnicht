import { describe, expect, it } from 'vitest';
import { TOP_BAR_THEMES, THEME_PREFERENCES } from './preferences.ts';
import { describeTheme, registryCoversPreferences, sceneOfTheme, schemeOfTheme, THEME_REGISTRY } from './theme-registry.ts';

describe('theme registry (45.4)', () => {
  it('describes every stored theme exactly once', () => {
    expect(registryCoversPreferences()).toBe(true);
    expect(new Set(THEME_REGISTRY.map((theme) => theme.id)).size).toBe(THEME_PREFERENCES.length);
  });
  it('agrees with the top-bar themes of 46', () => {
    expect(THEME_REGISTRY.filter((theme) => theme.navigation === 'top-bar').map((theme) => theme.id)).toEqual([...TOP_BAR_THEMES]);
    expect(describeTheme('places-it')).toMatchObject({ navigation: 'sidebar', kind: 'place' });
  });
  it('names one scene per scenic theme, and none for the Settings theme', () => {
    expect(sceneOfTheme('tokyo-nights')).toBe('city');
    expect(sceneOfTheme('witch-forest')).toBe('forest');
    expect(sceneOfTheme('places-it')).toBe('place');
    expect(sceneOfTheme('memento-mori')).toBeNull();
    expect(sceneOfTheme('settings')).toBeNull();
  });
  it('gives every resolved theme a scheme for feature CSS', () => {
    expect(schemeOfTheme('light')).toBe('light');
    for (const id of ['memento-mori', 'dark', 'tokyo-nights', 'witch-forest', 'space-guide', 'settings']) expect(schemeOfTheme(id)).toBe('dark');
    expect(schemeOfTheme('places-it')).toBeNull();
  });
});

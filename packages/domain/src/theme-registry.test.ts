import { describe, expect, it } from 'vitest';
import { TOP_BAR_THEMES, THEME_PREFERENCES } from './preferences.ts';
import { describeTheme, registryCoversPreferences, THEME_REGISTRY } from './theme-registry.ts';

describe('theme registry (45.4)', () => {
  it('describes every stored theme exactly once', () => {
    expect(registryCoversPreferences()).toBe(true);
    expect(new Set(THEME_REGISTRY.map((theme) => theme.id)).size).toBe(THEME_PREFERENCES.length);
  });
  it('agrees with the top-bar themes of 46', () => {
    expect(THEME_REGISTRY.filter((theme) => theme.navigation === 'top-bar').map((theme) => theme.id)).toEqual([...TOP_BAR_THEMES]);
    expect(describeTheme('places-it')).toMatchObject({ navigation: 'sidebar', kind: 'place' });
  });
});

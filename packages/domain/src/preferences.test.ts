import { describe, expect, it } from 'vitest';
import { DEFAULT_GUIDE_PREFERENCES, TOP_BAR_THEMES, effectiveGuideLayout, mergeGuidePreferences, normalizeGuidePreferences, topBarTheme } from './preferences.ts';

describe('Top bar (46)', () => {
  it('Tokyo Nights and Galactic Guide always use the top bar; every other theme uses the sidebar', () => {
    expect([...TOP_BAR_THEMES]).toEqual(['tokyo-nights', 'space-guide']);
    for (const theme of TOP_BAR_THEMES) {
      expect(topBarTheme(theme)).toBe(true);
      expect(effectiveGuideLayout(theme)).toBe('guide');
    }
    for (const theme of ['system', 'light', 'dark', 'memento-mori', 'witch-forest', 'places-it'] as const) {
      expect(topBarTheme(theme)).toBe(false);
      expect(effectiveGuideLayout(theme)).toBe('classic');
    }
  });

  it('hides the All / Mine / Shared filter by default; a Guide saved before 46 reads as hidden', () => {
    expect(DEFAULT_GUIDE_PREFERENCES.scopeFilter).toBe(false);
    const legacy = { layout: 'classic', cardStyle: 'glass', cardOpacity: 40, images: false } as const;
    expect(normalizeGuidePreferences(legacy)).toEqual({ ...legacy, scopeFilter: false });
    expect(mergeGuidePreferences(legacy as never, { cardOpacity: 60 })).toEqual({ ...legacy, cardOpacity: 60, scopeFilter: false });
    expect(mergeGuidePreferences(DEFAULT_GUIDE_PREFERENCES, { scopeFilter: true }).scopeFilter).toBe(true);
  });
});

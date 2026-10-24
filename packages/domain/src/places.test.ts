import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACE_PREFERENCES, PLACE_IDS, PLACE_THEMES, normalizePlacePreferences, parsePlacePreferences, placeOfTheme } from './places.ts';
import { BASE_THEME_PREFERENCES, THEME_PREFERENCES } from './preferences.ts';

describe('Places (section 30)', () => {
  it('registers one theme per country next to the fixed themes', () => {
    expect(PLACE_IDS).toEqual(['de', 'it', 'uk', 'scotland']);
    expect(PLACE_THEMES).toEqual(['places-de', 'places-it', 'places-uk', 'places-scotland']);
    expect(THEME_PREFERENCES).toEqual([...BASE_THEME_PREFERENCES, ...PLACE_THEMES]);
    expect(new Set(THEME_PREFERENCES).size).toBe(THEME_PREFERENCES.length);
  });

  it('finds the country of a theme, and nothing for any other value', () => {
    expect(placeOfTheme('places-scotland')).toBe('scotland');
    expect(placeOfTheme('places-de')).toBe('de');
    for (const value of ['witch-forest', 'places-', 'places-fr', 'places-DE', 'Places-de', '', null, undefined]) expect(placeOfTheme(value)).toBeNull();
  });

  it('validates saved settings strictly', () => {
    const valid = { ...DEFAULT_PLACE_PREFERENCES, background: 'photo', focusDesktop: { x: 0, y: 100 }, overlay: 15, blur: 12, vignette: 60 };
    expect(parsePlacePreferences(valid)).toEqual(valid);
    expect(parsePlacePreferences(DEFAULT_PLACE_PREFERENCES)).toEqual(DEFAULT_PLACE_PREFERENCES);
    for (const bad of [
      { ...valid, overlay: 14 },
      { ...valid, overlay: 86 },
      { ...valid, blur: 13 },
      { ...valid, vignette: 61 },
      { ...valid, blur: null },
      { ...valid, focusMobile: { x: -1, y: 0 } },
      { ...valid, focusMobile: { x: 1 } },
      { ...valid, background: 'Photo' },
      { ...valid, atmosphere: 'yes' },
      { ...valid, extra: 1 },
      { ...valid, version: 0 },
      [],
      'x',
    ]) {
      expect(() => parsePlacePreferences(bad)).toThrow();
    }
  });

  it('reads stored or cached settings tolerantly, field by field', () => {
    expect(normalizePlacePreferences(null)).toEqual(DEFAULT_PLACE_PREFERENCES);
    expect(normalizePlacePreferences('garbage')).toEqual(DEFAULT_PLACE_PREFERENCES);
    // A newer version's extra fields are ignored; broken fields fall back alone.
    expect(normalizePlacePreferences({ version: 3, background: 'none', blur: 99, overlay: 40, glitter: true })).toEqual({ ...DEFAULT_PLACE_PREFERENCES, background: 'none', overlay: 40 });
  });
});

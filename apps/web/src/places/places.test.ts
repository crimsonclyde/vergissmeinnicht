import {
  DEFAULT_PLACE_PREFERENCES,
  PLACE_BLUR_MAX,
  PLACE_IDS,
  PLACE_OVERLAY_MAX,
  PLACE_OVERLAY_MIN,
  PLACE_THEMES,
  PLACE_VIGNETTE_MAX,
  THEME_PREFERENCES,
  type PlaceSettings,
} from '@vergissmeinnicht/domain';
import { describe, expect, it } from 'vitest';
import css from '../places.css?raw';
import { en } from '../i18n/en.ts';
import { THEMES, isThemeMode, placeAttributes, resolveTheme } from '../theme.ts';
import { effectiveOverlay, placeLook } from './look.ts';
import { PLACES, PLACE_LIST, placeForTheme, placeOfWorkspace } from './registry.ts';
import { parseStoredPlaces } from './settings-store.ts';
import { PLACE_EFFECTS, PLACE_TOKEN_NAMES } from './types.ts';

const HEX = /^#[0-9a-f]{6}$/;
const WS = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const USER = '11111111-2222-4333-8444-555555555555';
const withPhoto = (preferences: Partial<typeof DEFAULT_PLACE_PREFERENCES>, photo: PlaceSettings['photo'] = { version: '1700000000000', width: 2400, height: 1600 }): PlaceSettings => ({
  preferences: { ...DEFAULT_PLACE_PREFERENCES, ...preferences },
  photo,
});

describe('Places registry (section 30)', () => {
  it('registers exactly the countries the server knows, in its order, each as a theme', () => {
    expect(PLACE_LIST.map((place) => place.id)).toEqual([...PLACE_IDS]);
    for (const id of PLACE_IDS) {
      expect(PLACES[id].id).toBe(id);
      expect(THEME_PREFERENCES).toContain(`places-${id}`);
      expect(isThemeMode(`places-${id}`)).toBe(true);
      expect(placeForTheme(`places-${id}`)).toBe(PLACES[id]);
    }
    for (const value of ['places-fr', 'places-', 'places', 'Places-de', 'places-de ', 'witch-forest', null, undefined]) {
      expect(placeForTheme(value)).toBeNull();
      if (typeof value === 'string' && value.startsWith('places')) expect(isThemeMode(value)).toBe(false);
    }
  });

  it('gives every country a name, a hint, artwork, framing, defaults and known effects', () => {
    for (const place of PLACE_LIST) {
      expect(en[place.name]).toBeTruthy();
      expect(en[place.hint]).toBeTruthy();
      expect(place.style.length).toBeGreaterThan(0);
      for (const set of [place.artwork.day, place.artwork.lights]) {
        for (const file of [set.wide, set.wideSmall, set.portrait, set.portraitSmall]) expect(typeof file).toBe('string');
      }
      for (const focus of [place.artwork.focusDesktop, place.artwork.focusMobile]) {
        for (const value of [focus.x, focus.y]) expect(value >= 0 && value <= 100).toBe(true);
      }
      expect(place.defaults.overlay).toBeGreaterThanOrEqual(PLACE_OVERLAY_MIN);
      expect(place.defaults.overlay).toBeLessThanOrEqual(PLACE_OVERLAY_MAX);
      expect(place.defaults.vignette).toBeGreaterThanOrEqual(0);
      expect(place.defaults.vignette).toBeLessThanOrEqual(PLACE_VIGNETTE_MAX);
      for (const effect of place.effects) expect(PLACE_EFFECTS).toContain(effect);
    }
  });

  it('defines every token as a plain colour in both schemes, and a page gradient', () => {
    for (const place of PLACE_LIST) {
      for (const scheme of [place.light, place.dark]) {
        expect(Object.keys(scheme.tokens).sort()).toEqual([...PLACE_TOKEN_NAMES].sort());
        for (const value of Object.values(scheme.tokens)) expect(value).toMatch(HEX);
        expect(scheme.gradient.length).toBeGreaterThanOrEqual(2);
        for (const stop of scheme.gradient) expect(stop).toMatch(HEX);
      }
    }
  });

  it('resolves a country theme to the Places theme and its tokens for the device scheme', () => {
    for (const theme of PLACE_THEMES) {
      expect(resolveTheme(theme, false)).toBe('places');
      expect(THEMES).toContain(resolveTheme(theme, true));
    }
    const day = placeAttributes('places-it', false);
    const night = placeAttributes('places-it', true);
    expect(day).toMatchObject({ place: 'it', scheme: 'light' });
    expect(night).toMatchObject({ place: 'it', scheme: 'dark' });
    expect(day?.properties['--bg']).toBe(PLACES.it.light.tokens.bg);
    expect(night?.properties['--bg']).toBe(PLACES.it.dark.tokens.bg);
    expect(day?.properties['--place-gradient']).toMatch(/^linear-gradient\(180deg, #/);
    expect(placeAttributes('witch-forest', true)).toBeNull();
    expect(placeAttributes('system', true)).toBeNull();
  });
});

describe('Places tab visibility', () => {
  it('follows the Workspace in use: its own theme first, else the person’s default', () => {
    expect(placeOfWorkspace('places-uk', {}, WS)?.id).toBe('uk');
    expect(placeOfWorkspace('dark', { [WS]: 'places-scotland' }, WS)?.id).toBe('scotland');
    expect(placeOfWorkspace('places-de', { [WS]: 'tokyo-nights' }, WS)).toBeNull();
    expect(placeOfWorkspace('places-de', { [OTHER]: 'light' }, WS)?.id).toBe('de');
    expect(placeOfWorkspace('places-de', {}, null)).toBeNull();
    expect(placeOfWorkspace('system', {}, WS)).toBeNull();
    // Inherited object keys are never a Workspace's theme.
    expect(placeOfWorkspace('places-it', {}, 'constructor')?.id).toBe('it');
  });
});

describe('Places look', () => {
  it('uses the country defaults until the person changes them', () => {
    const look = placeLook(PLACES.de, { preferences: DEFAULT_PLACE_PREFERENCES, photo: null }, WS);
    expect(look.background).toBe('illustration');
    expect(look.overlay).toBe(PLACES.de.defaults.overlay);
    expect(look.vignette).toBe(PLACES.de.defaults.vignette);
    expect(look.focusDesktop).toEqual(PLACES.de.artwork.focusDesktop);
    expect(look.focusMobile).toEqual(PLACES.de.artwork.focusMobile);
    expect(look.blur).toBe(0);
    expect(look.photoUrl).toBeNull();
  });

  it('shows a stored photo by its private, versioned address; without one it falls back to the illustration', () => {
    const look = placeLook(PLACES.uk, withPhoto({ background: 'photo', blur: 4 }), WS);
    expect(look.background).toBe('photo');
    expect(look.photoUrl).toBe(`/api/account/places/${WS}/background?v=1700000000000`);
    expect(look.focusDesktop).toEqual({ x: 50, y: 50 });
    expect(look.blur).toBe(4);
    expect(placeLook(PLACES.uk, withPhoto({ background: 'photo' }, null), WS)).toMatchObject({ background: 'illustration', photoUrl: null });
    expect(placeLook(PLACES.uk, withPhoto({ background: 'photo' }), null)).toMatchObject({ background: 'illustration', photoUrl: null });
    expect(placeLook(PLACES.uk, withPhoto({ background: 'none' }), WS)).toMatchObject({ background: 'none', photoUrl: null });
  });

  it('keeps the readability floor, and covers working pages more than Today', () => {
    for (const overlay of [PLACE_OVERLAY_MIN, 40, PLACE_OVERLAY_MAX]) {
      const look = placeLook(PLACES.it, withPhoto({ overlay }), WS);
      expect(effectiveOverlay(look, 'today')).toBe(overlay);
      expect(effectiveOverlay(look, 'page')).toBeGreaterThanOrEqual(72);
      expect(effectiveOverlay(look, 'page')).toBeGreaterThan(effectiveOverlay(look, 'today'));
      expect(effectiveOverlay(look, 'page')).toBeLessThanOrEqual(92);
    }
    expect(PLACE_BLUR_MAX).toBeLessThanOrEqual(12);
  });
});

describe('this browser’s copy of the settings', () => {
  it('keeps only plausible keys and valid values, and never an image', () => {
    const key = `${USER}:${WS}`;
    const parsed = parseStoredPlaces({
      [key]: { preferences: { ...DEFAULT_PLACE_PREFERENCES, background: 'photo', overlay: 999, blur: 3 }, photo: { version: '42', width: 10, height: 20, data: 'x' } },
      [`${USER}:${OTHER}`]: { preferences: 'nonsense', photo: { version: 'javascript:alert(1)', width: 1, height: 1 } },
      'bad key': { preferences: DEFAULT_PLACE_PREFERENCES, photo: null },
      __proto__: { preferences: DEFAULT_PLACE_PREFERENCES },
    });
    expect(Object.keys(parsed).sort()).toEqual([key, `${USER}:${OTHER}`].sort());
    expect(parsed[key]).toEqual({ preferences: { ...DEFAULT_PLACE_PREFERENCES, background: 'photo', blur: 3 }, photo: { version: '42', width: 10, height: 20 } });
    expect(parsed[`${USER}:${OTHER}`]).toEqual({ preferences: DEFAULT_PLACE_PREFERENCES, photo: null });
    for (const value of [null, 'x', [], 1]) expect(parseStoredPlaces(value)).toEqual({});
  });
});

describe('Places stylesheet', () => {
  it('stops all motion for reduced motion and hides the scene in forced colours', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced.length).toBeLessThan(css.length);
    expect(reduced.slice(0, reduced.indexOf('\n}'))).toMatch(/animation:\s*none/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    // Every animation lives in a rule that the reduced-motion block switches off.
    const animated = [...css.matchAll(/^\s*animation:\s*(?!none)/gm)].length;
    expect(animated).toBeGreaterThan(0);
  });

  it('avoids costly or unreadable effects: no backdrop filters, no animated filters', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/backdrop-filter/);
    const frames = rules.slice(rules.indexOf('@keyframes'));
    expect(frames.slice(0, frames.indexOf('\n}'))).not.toMatch(/filter/);
  });

  it('frames the backdrop differently on phones, using the phone focal point', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 37.5rem), (max-aspect-ratio: 4/5)'));
    expect(phone.slice(0, phone.indexOf('\n}'))).toMatch(/--place-focus-m/);
  });
});

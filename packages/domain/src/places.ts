import { DomainValidationError } from './errors.ts';

/**
 * Places (section 30): a family of country-inspired themes. Each country is one theme in the existing
 * theme choice (`places-<id>`), so the theme a person picks for a Workspace (section 28) also picks its
 * country. Everything visual about a country lives in the web client's registry
 * (`apps/web/src/places/`); the server only needs to know which ids exist.
 *
 * Adding a country: add its id here, run `pnpm db:generate` (the theme CHECK constraints are generated
 * from this list), and register its configuration and artwork in the web registry.
 */
export const PLACE_IDS = ['de', 'it', 'uk', 'scotland'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

export type PlaceTheme = `places-${PlaceId}`;
export const PLACE_THEMES = PLACE_IDS.map((id) => `places-${id}` as const) as readonly PlaceTheme[];

/** The country of a Places theme, or null for every other theme. */
export function placeOfTheme(theme: string | null | undefined): PlaceId | null {
  if (typeof theme !== 'string' || !theme.startsWith('places-')) return null;
  const id = theme.slice('places-'.length);
  return (PLACE_IDS as readonly string[]).includes(id) ? (id as PlaceId) : null;
}

/**
 * A person's own look of Places in one Workspace. Personal presentation only: it never changes the
 * Workspace, its theme, its country or anyone else's view. Stored as validated JSON per person and
 * Workspace, so later versions can add fields; unknown fields of a newer version are ignored on read.
 */
export const PLACE_PREFERENCES_VERSION = 1;

/** `illustration`: the country's artwork (default). `photo`: the person's own picture. `none`: palette only. */
export const PLACE_BACKGROUNDS = ['illustration', 'photo', 'none'] as const;
export type PlaceBackground = (typeof PLACE_BACKGROUNDS)[number];

/** A focal point in percent of the image (0 = left/top, 100 = right/bottom). */
export interface PlaceFocus {
  readonly x: number;
  readonly y: number;
}

export interface PlacePreferences {
  readonly version: typeof PLACE_PREFERENCES_VERSION;
  readonly background: PlaceBackground;
  /** Focal point on wide screens, and on phones (portrait): the same image, cropped differently. */
  readonly focusDesktop: PlaceFocus | null;
  readonly focusMobile: PlaceFocus | null;
  /** How strongly the page colour covers the image, in percent; never below the readability floor. `null`: the country's default. */
  readonly overlay: number | null;
  /** Blur of the image in CSS pixels; 0 keeps photos sharp. */
  readonly blur: number;
  /** Darkening of the edges in percent; 0 is off. `null`: the country's default. */
  readonly vignette: number | null;
  /** Quiet atmosphere (light of the time of day, mist, a lit window); motion also stops for reduced motion. */
  readonly atmosphere: boolean;
}

/** Readability floor and ceiling of the overlay (percent): text never sits on a bare busy photo. */
export const PLACE_OVERLAY_MIN = 15;
export const PLACE_OVERLAY_MAX = 85;
export const PLACE_BLUR_MAX = 12;
export const PLACE_VIGNETTE_MAX = 60;

/**
 * Defaults: `null` means "what the country defines" — the artwork's own framing, and the country's
 * restrained overlay and vignette (each country in the web registry sets them).
 */
export const DEFAULT_PLACE_PREFERENCES: PlacePreferences = Object.freeze({
  version: PLACE_PREFERENCES_VERSION,
  background: 'illustration',
  focusDesktop: null,
  focusMobile: null,
  overlay: null,
  blur: 0,
  vignette: null,
  atmosphere: true,
});

/** A personal background photo: one per person and Workspace, re-encoded on the server. */
export const PLACE_BACKGROUND_EDGE = 2400;
export const MAX_STORED_PLACE_BACKGROUND_BYTES = 700_000;
/** Size limit of the stored settings JSON (far above what version 1 needs). */
export const MAX_PLACE_PREFERENCES_JSON = 2000;

const invalid = (field: string) => new DomainValidationError(field, 'invalid_place_preferences', 'Invalid Places settings');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerIn(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalid(field);
  return value;
}

function focusOf(value: unknown, field: string): PlaceFocus | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'x' && key !== 'y')) throw invalid(field);
  return { x: integerIn(value.x, 0, 100, field), y: integerIn(value.y, 0, 100, field) };
}

const KEYS = ['version', 'background', 'focusDesktop', 'focusMobile', 'overlay', 'blur', 'vignette', 'atmosphere'] as const;

/** Strict validation of what a person saves: exactly the version-1 fields, every value in range. */
export function parsePlacePreferences(input: unknown): PlacePreferences {
  if (!isRecord(input)) throw invalid('settings');
  for (const key of Object.keys(input)) if (!(KEYS as readonly string[]).includes(key)) throw invalid(key);
  if (input.version !== PLACE_PREFERENCES_VERSION) throw invalid('version');
  if (typeof input.background !== 'string' || !(PLACE_BACKGROUNDS as readonly string[]).includes(input.background)) throw invalid('background');
  if (typeof input.atmosphere !== 'boolean') throw invalid('atmosphere');
  return {
    version: PLACE_PREFERENCES_VERSION,
    background: input.background as PlaceBackground,
    focusDesktop: focusOf(input.focusDesktop, 'focusDesktop'),
    focusMobile: focusOf(input.focusMobile, 'focusMobile'),
    overlay: input.overlay === null ? null : integerIn(input.overlay, PLACE_OVERLAY_MIN, PLACE_OVERLAY_MAX, 'overlay'),
    blur: integerIn(input.blur, 0, PLACE_BLUR_MAX, 'blur'),
    vignette: input.vignette === null ? null : integerIn(input.vignette, 0, PLACE_VIGNETTE_MAX, 'vignette'),
    atmosphere: input.atmosphere,
  };
}

/**
 * Tolerant reading of stored (or cached) settings: every known field that is valid is kept, anything
 * missing, out of range or unknown falls back to the default. Never throws.
 */
export function normalizePlacePreferences(input: unknown): PlacePreferences {
  if (!isRecord(input)) return DEFAULT_PLACE_PREFERENCES;
  const pick = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  const d = DEFAULT_PLACE_PREFERENCES;
  return {
    version: PLACE_PREFERENCES_VERSION,
    background: typeof input.background === 'string' && (PLACE_BACKGROUNDS as readonly string[]).includes(input.background) ? (input.background as PlaceBackground) : d.background,
    focusDesktop: pick(() => focusOf(input.focusDesktop ?? null, 'focusDesktop'), d.focusDesktop),
    focusMobile: pick(() => focusOf(input.focusMobile ?? null, 'focusMobile'), d.focusMobile),
    overlay: pick(() => (input.overlay === null ? null : integerIn(input.overlay, PLACE_OVERLAY_MIN, PLACE_OVERLAY_MAX, 'overlay')), d.overlay),
    blur: pick(() => integerIn(input.blur, 0, PLACE_BLUR_MAX, 'blur'), d.blur),
    vignette: pick(() => (input.vignette === null ? null : integerIn(input.vignette, 0, PLACE_VIGNETTE_MAX, 'vignette')), d.vignette),
    atmosphere: typeof input.atmosphere === 'boolean' ? input.atmosphere : d.atmosphere,
  };
}

/** What a person's Places settings for one Workspace look like to them. */
export interface PlaceSettings {
  readonly preferences: PlacePreferences;
  /** Their own background photo, if any: a version (time saved, ms) and its size. */
  readonly photo: { readonly version: string; readonly width: number; readonly height: number } | null;
}

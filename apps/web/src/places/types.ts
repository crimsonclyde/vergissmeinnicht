import type { PlaceFocus, PlaceId } from '@vergissmeinnicht/domain';
import type { MessageKey } from '../i18n/index.ts';

/**
 * The semantic colour tokens every component already uses (styles.css `:root`), as a Places country
 * defines them. Names are the CSS custom properties without `--`. contrast.test.ts checks every pair of
 * every country in both schemes, like the fixed themes.
 */
export const PLACE_TOKEN_NAMES = [
  'bg',
  'surface',
  'surface-muted',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'accent-text',
  'accent-soft',
  'danger',
  'focus',
  'brand',
  'link',
  'on-pending',
  'state-pending',
  'state-pending-bg',
  'state-done',
  'state-done-bg',
  'state-done-text',
  'state-skipped',
  'state-skipped-bg',
  'state-na',
  'state-na-bg',
] as const;
export type PlaceTokenName = (typeof PLACE_TOKEN_NAMES)[number];
/** Every token as `#rrggbb`. */
export type PlaceTokens = Readonly<Record<PlaceTokenName, string>>;

/** One colour scheme of a country: its tokens and the page gradient used when there is no image. */
export interface PlaceScheme {
  readonly tokens: PlaceTokens;
  /** Two or three `#rrggbb` stops, top to bottom, for "No image" and while an image loads. */
  readonly gradient: readonly string[];
}

/** One rendering of the artwork: a wide (landscape) and a portrait composition, each at two sizes. */
export interface PlaceArtworkSet {
  readonly wide: string;
  readonly wideSmall: string;
  readonly portrait: string;
  readonly portraitSmall: string;
}

export interface PlaceArtwork {
  /** The façade by day (shown at every hour; time of day is layered on top). */
  readonly day: PlaceArtworkSet;
  /** Only the lit windows, on transparent: fades in after sunset when the atmosphere is on. */
  readonly lights?: PlaceArtworkSet;
  /** Framing of the artwork on wide screens and on phones (percent of the image). */
  readonly focusDesktop: PlaceFocus;
  readonly focusMobile: PlaceFocus;
}

/** Quiet effects a country supports; each is optional and stops for reduced motion. */
export const PLACE_EFFECTS = ['window-glow', 'mist', 'haze', 'drift', 'fireflies', 'bee', 'leaves'] as const;
export type PlaceEffect = (typeof PLACE_EFFECTS)[number];

/**
 * A Places country (section 30). Declarative only: components read this, never branch on a country.
 * See places/ARTWORK.md for adding one.
 */
export interface PlaceConfig {
  readonly id: PlaceId;
  /** Display name and one-line description in the theme picker. */
  readonly name: MessageKey;
  readonly hint: MessageKey;
  /** Optional region and architectural style (documentation and future variants of one country). */
  readonly region?: string;
  readonly style: string;
  /** Light and dark scheme; the device setting chooses, like "System". */
  readonly light: PlaceScheme;
  readonly dark: PlaceScheme;
  readonly artwork: PlaceArtwork;
  /** Defaults this country suggests for a person who never changed them. */
  readonly defaults: { readonly overlay: number; readonly vignette: number };
  readonly effects: readonly PlaceEffect[];
}

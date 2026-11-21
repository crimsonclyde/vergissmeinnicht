/**
 * One description per user theme (45.4, first slice): what the rest of the app needs to know about a
 * theme lives here instead of in separate lists. The theme picker reads it, and the web app's one
 * scene slot (`ThemeScene`) picks the theme's scene from it. The Settings theme (45.6) is not a user theme
 * and is not listed.
 */
import { PLACE_THEMES } from './places.ts';
import { THEME_PREFERENCES, type ThemePreference } from './preferences.ts';

export type ThemeNavigation = 'top-bar' | 'sidebar';
/** The painted background a theme brings (45.4); `null` for none. */
export type ThemeSceneId = 'city' | 'forest' | 'place';
export interface ThemeDescription {
  readonly id: ThemePreference;
  /** The navigation the theme decides (46). */
  readonly navigation: ThemeNavigation;
  /** `alias`: kept for stored values only (`dark` shows Memento Mori, `system` follows the device). */
  readonly kind: 'theme' | 'place' | 'alias';
  readonly scene: ThemeSceneId | null;
  /** Light or dark surfaces (45.5: `data-scheme`, read by feature CSS such as the Map); `null` when decided elsewhere (Places palette, `system`). */
  readonly scheme: 'light' | 'dark' | null;
}

const sidebar = (id: ThemePreference, kind: ThemeDescription['kind'], scene: ThemeSceneId | null, scheme: ThemeDescription['scheme']): ThemeDescription => ({ id, navigation: 'sidebar', kind, scene, scheme });

export const THEME_REGISTRY: readonly ThemeDescription[] = Object.freeze([
  sidebar('system', 'alias', null, null),
  sidebar('light', 'theme', null, 'light'),
  sidebar('dark', 'alias', null, 'dark'),
  sidebar('memento-mori', 'theme', null, 'dark'),
  { id: 'tokyo-nights', navigation: 'top-bar', kind: 'theme', scene: 'city', scheme: 'dark' },
  sidebar('witch-forest', 'theme', 'forest', 'dark'),
  { id: 'space-guide', navigation: 'top-bar', kind: 'theme', scene: null, scheme: 'dark' },
  ...PLACE_THEMES.map((id) => sidebar(id, 'place', 'place', null)),
]);

export function describeTheme(id: ThemePreference): ThemeDescription {
  const found = THEME_REGISTRY.find((theme) => theme.id === id);
  if (found === undefined) throw new Error(`Unknown theme ${id}`);
  return found;
}

/** Every stored theme value has exactly one description. */
export const registryCoversPreferences = (): boolean =>
  THEME_REGISTRY.length === THEME_PREFERENCES.length && THEME_PREFERENCES.every((id) => THEME_REGISTRY.some((theme) => theme.id === id));

/** The scene of a displayed theme; unknown ids (the Settings theme) have none. */
export const sceneOfTheme = (id: string): ThemeSceneId | null => THEME_REGISTRY.find((theme) => theme.id === id)?.scene ?? null;

/** The scheme of a resolved theme id (`data-theme`); the Settings theme (45.6) is dark. */
export const schemeOfTheme = (id: string): 'light' | 'dark' | null => (id === 'settings' ? 'dark' : (THEME_REGISTRY.find((theme) => theme.id === id)?.scheme ?? null));

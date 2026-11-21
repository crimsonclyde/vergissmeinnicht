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
}

const sidebar = (id: ThemePreference, kind: ThemeDescription['kind'] = 'theme', scene: ThemeSceneId | null = null): ThemeDescription => ({ id, navigation: 'sidebar', kind, scene });

export const THEME_REGISTRY: readonly ThemeDescription[] = Object.freeze([
  sidebar('system', 'alias'),
  sidebar('light'),
  sidebar('dark', 'alias'),
  sidebar('memento-mori'),
  { id: 'tokyo-nights', navigation: 'top-bar', kind: 'theme', scene: 'city' },
  sidebar('witch-forest', 'theme', 'forest'),
  { id: 'space-guide', navigation: 'top-bar', kind: 'theme', scene: null },
  ...PLACE_THEMES.map((id) => sidebar(id, 'place', 'place')),
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

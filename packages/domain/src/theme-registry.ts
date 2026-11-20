/**
 * One description per user theme (45.4, first slice): what the rest of the app needs to know about a
 * theme lives here instead of in separate lists. `TOP_BAR_THEMES` is derived from it. Scenes, tokens
 * and the Settings theme (45.6, not a user theme) follow in later slices.
 */
import { PLACE_THEMES } from './places.ts';
import { THEME_PREFERENCES, type ThemePreference } from './preferences.ts';

export type ThemeNavigation = 'top-bar' | 'sidebar';
export interface ThemeDescription {
  readonly id: ThemePreference;
  /** The navigation the theme decides (46). */
  readonly navigation: ThemeNavigation;
  /** `alias`: kept for stored values only (`dark` shows Memento Mori, `system` follows the device). */
  readonly kind: 'theme' | 'place' | 'alias';
}

const sidebar = (id: ThemePreference, kind: ThemeDescription['kind'] = 'theme'): ThemeDescription => ({ id, navigation: 'sidebar', kind });

export const THEME_REGISTRY: readonly ThemeDescription[] = Object.freeze([
  sidebar('system', 'alias'),
  sidebar('light'),
  sidebar('dark', 'alias'),
  sidebar('memento-mori'),
  { id: 'tokyo-nights', navigation: 'top-bar', kind: 'theme' },
  sidebar('witch-forest'),
  { id: 'space-guide', navigation: 'top-bar', kind: 'theme' },
  ...PLACE_THEMES.map((id) => sidebar(id, 'place')),
]);

export function describeTheme(id: ThemePreference): ThemeDescription {
  const found = THEME_REGISTRY.find((theme) => theme.id === id);
  if (found === undefined) throw new Error(`Unknown theme ${id}`);
  return found;
}

/** Every stored theme value has exactly one description. */
export const registryCoversPreferences = (): boolean =>
  THEME_REGISTRY.length === THEME_PREFERENCES.length && THEME_PREFERENCES.every((id) => THEME_REGISTRY.some((theme) => theme.id === id));

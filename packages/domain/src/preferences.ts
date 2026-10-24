/**
 * Per-account presentation preferences (Step 8.7). Not security-relevant: they change how the web
 * client looks and how critical Steps are confirmed, never what the server allows.
 */
import { PLACE_THEMES, type PlaceTheme } from './places.ts';

/** Fixed themes; then one theme per Places country (section 30), generated from `PLACE_IDS`. */
export const BASE_THEME_PREFERENCES = ['system', 'light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest'] as const;
export type ThemePreference = (typeof BASE_THEME_PREFERENCES)[number] | PlaceTheme;
export const THEME_PREFERENCES = [...BASE_THEME_PREFERENCES, ...PLACE_THEMES] as unknown as readonly [ThemePreference, ...ThemePreference[]];

/** `hold`: press and hold for one second (5.3). `tap-confirm`: tap, then confirm in a second step. */
export const CRITICAL_CONFIRM_MODES = ['hold', 'tap-confirm'] as const;
export type CriticalConfirmMode = (typeof CRITICAL_CONFIRM_MODES)[number];

export interface UserPreferences {
  readonly theme: ThemePreference;
  readonly criticalConfirm: CriticalConfirmMode;
}

export const DEFAULT_PREFERENCES: UserPreferences = Object.freeze({ theme: 'system', criticalConfirm: 'hold' });

/**
 * A person's own choices per Workspace (section 28): which Workspace opens first, and a theme for a
 * Workspace that differs from their default theme. Presentation only; never shared, never in a backup.
 * Only Workspaces the person is currently a member of are listed.
 */
export interface WorkspacePreferences {
  readonly defaultWorkspaceId: string | null;
  /** Workspace id → theme. A Workspace without an entry uses the default theme. */
  readonly themes: Readonly<Record<string, ThemePreference>>;
}

export const EMPTY_WORKSPACE_PREFERENCES: WorkspacePreferences = Object.freeze({ defaultWorkspaceId: null, themes: Object.freeze({}) });

/**
 * Per-account presentation preferences (Step 8.7). Not security-relevant: they change how the web
 * client looks and how critical Steps are confirmed, never what the server allows.
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark', 'memento-mori'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** `hold`: press and hold for one second (5.3). `tap-confirm`: tap, then confirm in a second step. */
export const CRITICAL_CONFIRM_MODES = ['hold', 'tap-confirm'] as const;
export type CriticalConfirmMode = (typeof CRITICAL_CONFIRM_MODES)[number];

export interface UserPreferences {
  readonly theme: ThemePreference;
  readonly criticalConfirm: CriticalConfirmMode;
}

export const DEFAULT_PREFERENCES: UserPreferences = Object.freeze({ theme: 'system', criticalConfirm: 'hold' });

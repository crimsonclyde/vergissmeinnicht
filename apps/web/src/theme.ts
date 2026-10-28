import { THEME_PREFERENCES, placeOfTheme, type ThemePreference } from '@vergissmeinnicht/domain';
import { PLACES } from './places/registry.ts';
import { PLACE_TOKEN_NAMES } from './places/types.ts';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme selection (Steps 8.3, 8.7). The user picks a mode; the mode resolves to one theme whose
 * semantic tokens live in `styles.css` under `:root[data-theme='…']`. Components never know the theme.
 * The choice is part of the account (8.7); this browser keeps a copy so the first paint is right.
 *
 * A named preset (such as "Memento Mori") is one more entry in THEMES plus one token block in the
 * stylesheet, and one more mode — no component changes.
 */
// `dark` remains a valid saved/API value, but has one visible successor.
export const THEME_MODES = THEME_PREFERENCES.filter(mode => mode !== 'dark');
export const canonicalThemeMode = (mode: ThemePreference): ThemePreference => mode === 'dark' ? 'memento-mori' : mode;
export type ThemeMode = ThemePreference;

/**
 * Theme ids = `data-theme` values; each has a token block (incl. `color-scheme`) in styles.css — except
 * `places` (section 30), whose tokens come from the country registry and are set on <html> by `apply`.
 */
export const THEMES = ['light', 'dark', 'memento-mori', 'tokyo-nights', 'witch-forest', 'places'] as const;
export type ThemeId = (typeof THEMES)[number];

const STORAGE_KEY = 'vmn.theme';
/** This browser's copy of the per-Workspace themes (section 28), for the first paint only. */
const WORKSPACE_STORAGE_KEY = 'vmn.workspaceThemes';
const LAST_WORKSPACE_KEY = 'vmn.lastWorkspace';
const WORKSPACE_PATH = /^\/w\/([0-9a-f-]{36})(?:\/|$)/;
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ThemeId {
  if (mode === 'system') return systemPrefersDark ? 'memento-mori' : 'light';
  if (mode === 'dark') return 'memento-mori';
  if (placeOfTheme(mode) !== null) return 'places';
  return mode as Exclude<ThemeMode, 'system' | `places-${string}`>;
}

/**
 * What a Places theme sets on <html>: the country, the scheme (a Places country follows the device's
 * light/dark setting, like System), and every colour token as a custom property. Null for other themes.
 */
export function placeAttributes(mode: ThemeMode, systemPrefersDark: boolean): { place: string; scheme: 'light' | 'dark'; properties: Record<string, string> } | null {
  const id = placeOfTheme(mode);
  if (id === null) return null;
  const config = PLACES[id];
  const scheme = systemPrefersDark ? 'dark' : 'light';
  const { tokens, gradient } = config[scheme];
  const properties: Record<string, string> = Object.fromEntries(PLACE_TOKEN_NAMES.map((name) => [`--${name}`, tokens[name]]));
  properties['--place-gradient'] = `linear-gradient(180deg, ${gradient.join(', ')})`;
  return { place: id, scheme, properties };
}

const PLACE_PROPERTIES = [...PLACE_TOKEN_NAMES.map((name) => `--${name}`), '--place-gradient'];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

// Per-viewer convenience only: storage may be unavailable (private mode) and is never required.
function storedMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

function storeMode(mode: ThemeMode): void {
  try {
    if (mode === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Only known modes keyed by plausible ids survive: a broken or edited copy is simply ignored. */
export function parseWorkspaceThemes(value: unknown): Record<string, ThemeMode> {
  const themes: Record<string, ThemeMode> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return themes;
  for (const [id, mode] of Object.entries(value)) if (/^[0-9a-f-]{36}$/.test(id) && isThemeMode(mode)) themes[id] = mode;
  return themes;
}

/** This browser's copy of the per-Workspace themes (empty when unavailable). */
export function storedWorkspaceThemes(): Record<string, ThemeMode> {
  try {
    return parseWorkspaceThemes(JSON.parse(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

function storedWorkspaceTheme(): ThemeMode | null {
  try {
    const themes = storedWorkspaceThemes();
    const id = WORKSPACE_PATH.exec(window.location.pathname)?.[1] ?? window.localStorage.getItem(LAST_WORKSPACE_KEY);
    return id === null ? null : (themes[id] ?? null);
  } catch {
    return null;
  }
}

/** Keeps this browser's copy of the account's per-Workspace themes (the account is the source). */
export function storeWorkspaceThemes(themes: Readonly<Record<string, ThemeMode>>): void {
  try {
    if (Object.keys(themes).length === 0) window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    else window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(themes));
  } catch {
    /* ignore */
  }
}

const listeners = new Set<() => void>();
/** The account's default theme. */
let currentMode: ThemeMode = 'system';
/** The person's theme for the Workspace being shown, if they chose one (section 28). */
let workspaceMode: ThemeMode | null = null;

/** What is shown: the Workspace's own theme, else the default theme. */
export function effectiveMode(defaultMode: ThemeMode, forWorkspace: ThemeMode | null): ThemeMode {
  return forWorkspace ?? defaultMode;
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

function apply(): void {
  const root = document.documentElement;
  const mode = effectiveMode(currentMode, workspaceMode);
  const dark = systemPrefersDark();
  root.dataset.theme = resolveTheme(mode, dark);
  const place = placeAttributes(mode, dark);
  if (place === null) {
    delete root.dataset.place;
    delete root.dataset.scheme;
    for (const name of PLACE_PROPERTIES) root.style.removeProperty(name);
    root.style.removeProperty('color-scheme');
  } else {
    root.dataset.place = place.place;
    root.dataset.scheme = place.scheme;
    for (const [name, value] of Object.entries(place.properties)) root.style.setProperty(name, value);
    root.style.setProperty('color-scheme', place.scheme);
  }
  // The phone's browser bar takes the page colour of the theme.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg !== '') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

/** Called once before the first render so the page never shows the wrong theme. */
export function initTheme(): void {
  currentMode = storedMode();
  workspaceMode = storedWorkspaceTheme();
  apply();
  // "System" follows changes of the operating-system setting while the app is open.
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    const mode = effectiveMode(currentMode, workspaceMode);
    if (mode === 'system' || placeOfTheme(mode) !== null) apply();
  });
}

function changed(): void {
  apply();
  for (const listener of listeners) listener();
}

/** Sets the default theme and keeps it as this browser's copy (the account's value is saved by the caller). */
export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  storeMode(mode);
  changed();
}

/** Shows the person's theme for the current Workspace, or with `null` the default theme (section 28). */
export function setWorkspaceThemeMode(mode: ThemeMode | null): void {
  if (workspaceMode === mode) return;
  workspaceMode = mode;
  changed();
}

/** The mode being shown (a Workspace's own theme or the default); the setter changes the default. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => effectiveMode(currentMode, workspaceMode),
  );
  return [mode, setThemeMode];
}

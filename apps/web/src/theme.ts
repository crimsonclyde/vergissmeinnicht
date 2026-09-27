import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme selection (Step 8.3). The user picks a mode; the mode resolves to one theme whose semantic
 * tokens live in `styles.css` under `:root[data-theme='…']`. Components never know the theme.
 *
 * A future named preset (e.g. "Memento Mori") is one more entry in THEMES plus one token block in
 * the stylesheet, and one more mode — no component changes.
 */
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Theme ids = `data-theme` values; each has a token block (incl. `color-scheme`) in styles.css. */
export const THEMES = ['light', 'dark'] as const;
export type ThemeId = (typeof THEMES)[number];

const STORAGE_KEY = 'vmn.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ThemeId {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light';
  return mode;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);
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

const listeners = new Set<() => void>();
let currentMode: ThemeMode = 'system';

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

function apply(): void {
  document.documentElement.dataset.theme = resolveTheme(currentMode, systemPrefersDark());
}

/** Called once before the first render so the page never shows the wrong theme. */
export function initTheme(): void {
  currentMode = storedMode();
  apply();
  // "System" follows changes of the operating-system setting while the app is open.
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    if (currentMode === 'system') apply();
  });
}

export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  storeMode(mode);
  apply();
  for (const listener of listeners) listener();
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(
    useCallback((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []),
    () => currentMode,
  );
  return [mode, setThemeMode];
}

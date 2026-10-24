import { DEFAULT_PREFERENCES, type ThemePreference, type UserPreferences, type WorkspacePreferences } from '@vergissmeinnicht/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { setThemeMode, setWorkspaceThemeMode, storeWorkspaceThemes, storedWorkspaceThemes } from './theme.ts';

interface PreferencesValue {
  readonly preferences: UserPreferences;
  /** Saves to the account; the new value is shown at once and kept if saving fails (next load corrects it). */
  readonly update: (changes: Partial<UserPreferences>) => Promise<void>;
  /** Default Workspace and per-Workspace themes (section 28). */
  readonly workspacePreferences: WorkspacePreferences;
  /** True once the account's per-Workspace choices were loaded — or could not be (offline). */
  readonly workspacePreferencesSettled: boolean;
  /** `null` returns the Workspace to the default theme. Shown at once; saved to the account. */
  readonly setWorkspaceTheme: (workspaceId: string, theme: ThemePreference | null) => Promise<void>;
  readonly setDefaultWorkspace: (workspaceId: string | null) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue>({
  preferences: DEFAULT_PREFERENCES,
  update: async () => undefined,
  workspacePreferences: { defaultWorkspaceId: null, themes: {} },
  workspacePreferencesSettled: true,
  setWorkspaceTheme: async () => undefined,
  setDefaultWorkspace: async () => undefined,
});

/**
 * Loads the signed-in user's preferences (Step 8.7, section 28) and applies the theme: the theme the
 * person chose for `workspaceId` (the Workspace being shown, or last used), else their default theme.
 */
export function PreferencesProvider({ workspaceId, children }: { workspaceId: string | null; children: ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  // Until the account answers, this browser's copy keeps the first paint right.
  const [workspacePreferences, setWorkspacePreferences] = useState<WorkspacePreferences>(() => ({ defaultWorkspaceId: null, themes: storedWorkspaceThemes() }));
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    let active = true;
    api.preferences().then(
      (loaded) => {
        if (!active) return;
        setPreferences(loaded);
        setThemeMode(loaded.theme);
      },
      // Presentation only: without the account's values the defaults and this browser's theme stay.
      () => undefined,
    );
    api.workspacePreferences().then(
      (loaded) => {
        if (!active) return;
        setWorkspacePreferences(loaded);
        setSettled(true);
      },
      () => active && setSettled(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const themeHere = workspaceId === null ? null : (workspacePreferences.themes[workspaceId] ?? null);
  useEffect(() => setWorkspaceThemeMode(themeHere), [themeHere]);
  useEffect(() => storeWorkspaceThemes(workspacePreferences.themes), [workspacePreferences.themes]);

  const update = useCallback(async (changes: Partial<UserPreferences>) => {
    setPreferences((current) => ({ ...current, ...changes }));
    if (changes.theme !== undefined) setThemeMode(changes.theme);
    setPreferences(await api.updatePreferences(changes));
  }, []);

  const setWorkspaceTheme = useCallback(async (id: string, theme: ThemePreference | null) => {
    setWorkspacePreferences((current) => ({
      ...current,
      themes: Object.fromEntries([...Object.entries(current.themes).filter(([key]) => key !== id), ...(theme === null ? [] : [[id, theme] as const])]),
    }));
    setWorkspacePreferences(await api.setWorkspaceTheme(id, theme));
  }, []);

  const setDefaultWorkspace = useCallback(async (id: string | null) => {
    setWorkspacePreferences((current) => ({ ...current, defaultWorkspaceId: id }));
    setWorkspacePreferences(await api.setDefaultWorkspace(id));
  }, []);

  const value = useMemo(
    () => ({ preferences, update, workspacePreferences, workspacePreferencesSettled: settled, setWorkspaceTheme, setDefaultWorkspace }),
    [preferences, update, workspacePreferences, settled, setWorkspaceTheme, setDefaultWorkspace],
  );
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

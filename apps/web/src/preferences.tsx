import { DEFAULT_PREFERENCES, type UserPreferences } from '@vergissmeinnicht/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api.ts';
import { setThemeMode } from './theme.ts';

interface PreferencesValue {
  readonly preferences: UserPreferences;
  /** Saves to the account; the new value is shown at once and kept if saving fails (next load corrects it). */
  readonly update: (changes: Partial<UserPreferences>) => Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue>({
  preferences: DEFAULT_PREFERENCES,
  update: async () => undefined,
});

/** Loads the signed-in user's preferences (Step 8.7) and applies the theme. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

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
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback(async (changes: Partial<UserPreferences>) => {
    setPreferences((current) => ({ ...current, ...changes }));
    if (changes.theme !== undefined) setThemeMode(changes.theme);
    setPreferences(await api.updatePreferences(changes));
  }, []);

  const value = useMemo(() => ({ preferences, update }), [preferences, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export const usePreferences = () => useContext(PreferencesContext);

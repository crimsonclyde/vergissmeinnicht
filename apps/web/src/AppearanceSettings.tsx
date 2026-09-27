import { THEME_MODES, useThemeMode, type ThemeMode } from './theme.ts';

const MODE_TEXT: Record<ThemeMode, { label: string; hint: string }> = {
  system: { label: 'System', hint: 'Follow the setting of this device.' },
  light: { label: 'Light', hint: 'Always light.' },
  dark: { label: 'Dark', hint: 'Always dark: black and grey with red accents.' },
};

/** Theme choice for this browser (stored locally; not part of the account). */
export function AppearanceSettings() {
  const [mode, setMode] = useThemeMode();
  return (
    <fieldset>
      <legend>Appearance</legend>
      <p className="muted" style={{ marginTop: 0 }}>
        Saved in this browser only.
      </p>
      <div className="stack">
        {THEME_MODES.map((value) => (
          <label key={value} className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name="theme" value={value} checked={mode === value} onChange={() => setMode(value)} />
            <span>
              <strong>{MODE_TEXT[value].label}</strong> — {MODE_TEXT[value].hint}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

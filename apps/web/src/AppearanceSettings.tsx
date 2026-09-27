import { t } from './i18n/index.ts';
import { THEME_MODES, useThemeMode } from './theme.ts';

/** Theme choice for this browser (stored locally; not part of the account). */
export function AppearanceSettings() {
  const [mode, setMode] = useThemeMode();
  return (
    <fieldset>
      <legend>{t('appearance.legend')}</legend>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('appearance.localOnly')}
      </p>
      <div className="stack">
        {THEME_MODES.map((value) => (
          <label key={value} className="row" style={{ fontWeight: 400 }}>
            <input type="radio" name="theme" value={value} checked={mode === value} onChange={() => setMode(value)} />
            <span>
              <strong>{t(`appearance.${value}`)}</strong> — {t(`appearance.${value}Hint`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

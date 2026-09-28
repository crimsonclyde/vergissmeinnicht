import { useState } from 'react';
import { messageFor } from './api.ts';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { THEME_MODES } from './theme.ts';

/** Theme choice, saved to the account (Step 8.7) so it follows the user to every device. */
export function AppearanceSettings() {
  const { preferences, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <fieldset>
      <legend>{t('appearance.legend')}</legend>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('appearance.savedToAccount')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <div className="stack">
        {THEME_MODES.map((value) => (
          <label key={value} className="row" style={{ fontWeight: 400 }}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preferences.theme === value}
              onChange={() => {
                setMessage(null);
                update({ theme: value }).catch((caught: unknown) => setMessage(messageFor(caught)));
              }}
            />
            <span>
              <strong>{t(`appearance.${value}`)}</strong> — {t(`appearance.${value}Hint`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

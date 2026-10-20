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
      <div className="theme-options">
        {THEME_MODES.map((value) => (
          <label key={value} className="theme-option">
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
            {/* A small picture of the theme: page, a card, the main button and the brand colour. */}
            <span className="theme-swatch" data-swatch={value} aria-hidden="true">
              <span className="theme-swatch-card">
                <span className="theme-swatch-line" />
                <span className="theme-swatch-line theme-swatch-short" />
                <span className="theme-swatch-button" />
              </span>
            </span>
            <span className="theme-option-text">
              <strong>{t(`appearance.${value}`)}</strong>
              <small className="muted">{t(`appearance.${value}Hint`)}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

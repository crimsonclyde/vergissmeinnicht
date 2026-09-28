import { CRITICAL_CONFIRM_MODES } from '@vergissmeinnicht/domain';
import { useState } from 'react';
import { messageFor } from './api.ts';
import { t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';

/** How critical Steps are confirmed (Step 8.7): press and hold, or tap and confirm. Saved to the account. */
export function CriticalConfirmSettings() {
  const { preferences, update } = usePreferences();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <fieldset>
      <legend>{t('criticalConfirm.legend')}</legend>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('criticalConfirm.intro')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <div className="stack">
        {CRITICAL_CONFIRM_MODES.map((value) => (
          <label key={value} className="row" style={{ fontWeight: 400 }}>
            <input
              type="radio"
              name="critical-confirm"
              value={value}
              checked={preferences.criticalConfirm === value}
              onChange={() => {
                setMessage(null);
                update({ criticalConfirm: value }).catch((caught: unknown) => setMessage(messageFor(caught)));
              }}
            />
            <span>
              <strong>{t(`criticalConfirm.${value}`)}</strong> — {t(`criticalConfirm.${value}Hint`)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

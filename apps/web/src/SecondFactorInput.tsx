import { t } from './i18n/index.ts';

export type FactorMode = 'code' | 'recovery';

/** Authenticator code or recovery code entry, shared by sign-in and disabling TOTP. */
export function SecondFactorInput(props: {
  mode: FactorMode;
  value: string;
  onChange: (value: string) => void;
  onModeChange: (mode: FactorMode) => void;
}) {
  const { mode, value, onChange, onModeChange } = props;
  return (
    <>
      {mode === 'code' ? (
        <p>
          <label>
            {t('factor.code')}
            <br />
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </p>
      ) : (
        <p>
          <label>
            {t('factor.recoveryCode')}
            <br />
            <input autoComplete="off" spellCheck={false} maxLength={32} required value={value} onChange={(e) => onChange(e.target.value)} />
          </label>
        </p>
      )}
      <p>
        <button type="button" onClick={() => onModeChange(mode === 'code' ? 'recovery' : 'code')}>
          {t(mode === 'code' ? 'factor.useRecovery' : 'factor.useCode')}
        </button>
      </p>
    </>
  );
}

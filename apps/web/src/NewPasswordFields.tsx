import { t } from './i18n/index.ts';

export const MIN_PASSWORD_LENGTH = 15;

/** New password + confirmation, shared by invitation, recovery and password change. */
export function NewPasswordFields(props: {
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  label?: string;
}) {
  return (
    <>
      <p>
        <label>
          {t('password.field', { label: props.label ?? t('password.default'), min: MIN_PASSWORD_LENGTH })}
          <br />
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={128}
            value={props.password}
            onChange={(e) => props.onPassword(e.target.value)}
          />
        </label>
      </p>
      <p>
        <label>
          {t('password.repeat')}
          <br />
          <input
            type="password"
            autoComplete="new-password"
            required
            value={props.confirmation}
            onChange={(e) => props.onConfirmation(e.target.value)}
          />
        </label>
      </p>
    </>
  );
}

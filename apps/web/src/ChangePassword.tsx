import { useState, type FormEvent } from 'react';
import { api, messageFor } from './api.ts';
import { NewPasswordFields } from './NewPasswordFields.tsx';
import { t } from './i18n/index.ts';

export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset(next: boolean) {
    setOpen(next);
    setCurrent('');
    setPassword('');
    setConfirmation('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setMessage(t('password.mismatch'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.changePassword(current, password);
      reset(false);
      setMessage(t('password.changed'));
    } catch (caught) {
      setMessage(messageFor(caught));
      setCurrent('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="password-heading">
      <h3 id="password-heading">{t('password.heading')}</h3>
      {message !== null && <p role="status">{message}</p>}
      {!open ? (
        <button type="button" onClick={() => reset(true)}>
          {t('password.change')}
        </button>
      ) : (
        <form onSubmit={submit}>
          <p>
            <label>
              {t('password.current')}
              <br />
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
          </p>
          <NewPasswordFields
            label={t('password.new')}
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
          <button type="submit" disabled={busy}>
            {t('password.save')}
          </button>{' '}
          <button type="button" onClick={() => reset(false)}>
            {t('common.cancel')}
          </button>
        </form>
      )}
    </section>
  );
}

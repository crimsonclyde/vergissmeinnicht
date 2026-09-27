import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, messageFor } from './api.ts';
import { t } from './i18n/index.ts';
import { NewPasswordFields } from './NewPasswordFields.tsx';

type Recovery = Awaited<ReturnType<typeof api.resolveRecovery>>;
type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'form'; readonly recovery: Recovery }
  | { readonly kind: 'done' };

/** `/recover/{token}`. Opening the page changes nothing; only submitting the form does. */
export function RecoverAccount({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.resolveRecovery(token).then(
      (recovery) => active && setState({ kind: 'form', recovery }),
      () => active && setState({ kind: 'invalid' }),
    );
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: FormEvent, recovery: Recovery) {
    event.preventDefault();
    setError(null);
    if (recovery.resetPassword && password !== confirmation) {
      setError(t('password.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.completeRecovery(token, recovery.resetPassword ? { newPassword: password } : { currentPassword: current });
      window.history.replaceState(null, '', '/');
      setState({ kind: 'done' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_recovery') setState({ kind: 'invalid' });
      setError(messageFor(caught));
      setCurrent('');
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') return <p>{t('recover.checking')}</p>;
  if (state.kind === 'invalid') {
    return (
      <section aria-labelledby="recover-heading">
        <h2 id="recover-heading">{t('recover.invalidHeading')}</h2>
        <p role="alert">
          {t('error.invalid_recovery')} {t('recover.askAdmin')}
        </p>
      </section>
    );
  }
  if (state.kind === 'done') {
    return (
      <section aria-labelledby="recover-heading">
        <h2 id="recover-heading">{t('recover.doneHeading')}</h2>
        <p>{t('recover.done')}</p>
        <p>
          <a href="/">{t('invite.signIn')}</a>
        </p>
      </section>
    );
  }

  const { recovery } = state;
  return (
    <form onSubmit={(e) => void submit(e, recovery)} aria-labelledby="recover-heading">
      <h2 id="recover-heading">{t('recover.heading')}</h2>
      <p>{t('recover.account', { email: recovery.email })}</p>
      <input type="email" autoComplete="username" value={recovery.email} readOnly hidden />
      <ul>
        {recovery.resetPassword && <li>{t('recover.resetPassword')}</li>}
        {recovery.resetTotp && <li>{t('recover.resetTotp')}</li>}
      </ul>
      {recovery.resetPassword ? (
        <NewPasswordFields
          label={t('password.new')}
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
        />
      ) : (
        <p>
          <label>
            {t('password.current')}
            <br />
            <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        </p>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {t('recover.submit')}
      </button>
    </form>
  );
}

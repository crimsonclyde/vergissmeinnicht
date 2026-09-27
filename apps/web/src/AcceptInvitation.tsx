import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, messageFor } from './api.ts';
import { NewPasswordFields } from './NewPasswordFields.tsx';
import { t } from './i18n/index.ts';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'form'; readonly email: string }
  | { readonly kind: 'done' };

/**
 * `/invite/{token}`. Opening the page never changes anything (mail scanners may fetch links);
 * the account is created only by submitting the form (POST).
 */
export function AcceptInvitation({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api.resolveInvitation(token).then(
      ({ email }) => active && setState({ kind: 'form', email }),
      () => active && setState({ kind: 'invalid' }),
    );
    return () => {
      active = false;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError(t('password.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.acceptInvitation(token, displayName, password);
      // Keep the used token out of the browser history.
      window.history.replaceState(null, '', '/');
      setState({ kind: 'done' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'invalid_invitation') setState({ kind: 'invalid' });
      setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') return <p>{t('invite.checking')}</p>;
  if (state.kind === 'invalid') {
    return (
      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">{t('invite.invalidHeading')}</h2>
        <p role="alert">
          {t('error.invalid_invitation')} {t('invite.askAdmin')}
        </p>
      </section>
    );
  }
  if (state.kind === 'done') {
    return (
      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">{t('invite.doneHeading')}</h2>
        <p>{t('invite.ready')}</p>
        <p>
          <a href="/">{t('invite.signIn')}</a>
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby="invite-heading">
      <h2 id="invite-heading">{t('invite.heading')}</h2>
      <p>{t('invite.for', { email: state.email })}</p>
      <input type="email" autoComplete="username" value={state.email} readOnly hidden />
      <p>
        <label>
          {t('invite.displayName')}
          <br />
          <input autoComplete="name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
      </p>
      <NewPasswordFields
        password={password}
        confirmation={confirmation}
        onPassword={setPassword}
        onConfirmation={setConfirmation}
      />
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {t('invite.submit')}
      </button>
    </form>
  );
}

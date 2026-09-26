import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, ERROR_MESSAGES, api, messageFor } from './api.ts';
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
      setError('The passwords do not match.');
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

  if (state.kind === 'loading') return <p>Checking recovery link…</p>;
  if (state.kind === 'invalid') {
    return (
      <section aria-labelledby="recover-heading">
        <h2 id="recover-heading">Recovery link not valid</h2>
        <p role="alert">{ERROR_MESSAGES.invalid_recovery} Ask an administrator for a new one.</p>
      </section>
    );
  }
  if (state.kind === 'done') {
    return (
      <section aria-labelledby="recover-heading">
        <h2 id="recover-heading">Account recovered</h2>
        <p>
          All previous sessions were signed out. <a href="/">Sign in</a> again.
        </p>
      </section>
    );
  }

  const { recovery } = state;
  return (
    <form onSubmit={(e) => void submit(e, recovery)} aria-labelledby="recover-heading">
      <h2 id="recover-heading">Recover your account</h2>
      <p>
        Account <strong>{recovery.email}</strong>
      </p>
      <input type="email" autoComplete="username" value={recovery.email} readOnly hidden />
      <ul>
        {recovery.resetPassword && <li>Choose a new password.</li>}
        {recovery.resetTotp && <li>Two-factor authentication will be removed; you can set it up again afterwards.</li>}
      </ul>
      {recovery.resetPassword ? (
        <NewPasswordFields
          label="New password"
          password={password}
          confirmation={confirmation}
          onPassword={setPassword}
          onConfirmation={setConfirmation}
        />
      ) : (
        <p>
          <label>
            Current password
            <br />
            <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        </p>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Recover account
      </button>
    </form>
  );
}

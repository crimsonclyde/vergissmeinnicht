import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from './api.ts';

const MIN_PASSWORD_LENGTH = 15;

const MESSAGES: Record<string, string> = {
  invalid_invitation: 'This invitation link is invalid, has expired or was already used.',
  password_too_short: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  password_too_long: 'The password must be at most 128 characters.',
  display_name_empty: 'Please enter a display name.',
  display_name_too_long: 'The display name must be at most 80 characters.',
  display_name_invalid_characters: 'The display name contains characters that are not allowed.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
};

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
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.acceptInvitation(token, displayName, password);
      // Keep the used token out of the browser history.
      window.history.replaceState(null, '', '/');
      setState({ kind: 'done' });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'request_failed';
      if (code === 'invalid_invitation') setState({ kind: 'invalid' });
      setError(MESSAGES[code] ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') return <p>Checking invitation…</p>;
  if (state.kind === 'invalid') {
    return (
      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">Invitation not valid</h2>
        <p role="alert">{MESSAGES.invalid_invitation} Ask an administrator for a new invitation.</p>
      </section>
    );
  }
  if (state.kind === 'done') {
    return (
      <section aria-labelledby="invite-heading">
        <h2 id="invite-heading">Account created</h2>
        <p>
          Your account is ready. <a href="/">Sign in</a> with your email address and the password you chose.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={submit} aria-labelledby="invite-heading">
      <h2 id="invite-heading">Create your account</h2>
      <p>
        Invitation for <strong>{state.email}</strong>
      </p>
      <input type="email" autoComplete="username" value={state.email} readOnly hidden />
      <p>
        <label>
          Display name
          <br />
          <input autoComplete="name" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Password (at least {MIN_PASSWORD_LENGTH} characters)
          <br />
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </p>
      <p>
        <label>
          Repeat password
          <br />
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
      </p>
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Create account
      </button>
    </form>
  );
}

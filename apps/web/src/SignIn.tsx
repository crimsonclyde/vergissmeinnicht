import { useState, type FormEvent } from 'react';
import { ApiError, api, type CurrentUser } from './api.ts';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email or password is not correct.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
};

export function SignIn({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.signIn(email, password));
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : 'request_failed';
      setError(MESSAGES[code] ?? 'Sign-in failed. Please try again.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">Sign in</h2>
      <p>
        <label>
          Email
          <br />
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Password
          <br />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </p>
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Sign in
      </button>
    </form>
  );
}

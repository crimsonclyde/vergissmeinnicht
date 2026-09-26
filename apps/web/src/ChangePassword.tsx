import { useState, type FormEvent } from 'react';
import { api, messageFor } from './api.ts';
import { NewPasswordFields } from './NewPasswordFields.tsx';

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
      setMessage('The passwords do not match.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.changePassword(current, password);
      reset(false);
      setMessage('Password changed. All other sessions were signed out.');
    } catch (caught) {
      setMessage(messageFor(caught));
      setCurrent('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="password-heading">
      <h3 id="password-heading">Password</h3>
      {message !== null && <p role="status">{message}</p>}
      {!open ? (
        <button type="button" onClick={() => reset(true)}>
          Change password
        </button>
      ) : (
        <form onSubmit={submit}>
          <p>
            <label>
              Current password
              <br />
              <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
          </p>
          <NewPasswordFields
            label="New password"
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
          <button type="submit" disabled={busy}>
            Save new password
          </button>{' '}
          <button type="button" onClick={() => reset(false)}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}

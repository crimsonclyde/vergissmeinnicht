import { useState, type FormEvent } from 'react';
import { ApiError, api, messageFor, type CurrentUser } from './api.ts';
import { SecondFactorInput, type FactorMode } from './SecondFactorInput.tsx';
import { t } from './i18n/index.ts';

export function SignIn({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [mode, setMode] = useState<FactorMode>('code');
  const [factor, setFactor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.signIn(email, password);
      setPassword('');
      if ('mfaRequired' in result) setStep('mfa');
      else onSignedIn(result.user);
    } catch (caught) {
      setError(messageFor(caught, t('signIn.failed')));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function submitFactor(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.completeMfa(mode === 'code' ? { code: factor } : { recoveryCode: factor }));
    } catch (caught) {
      setError(messageFor(caught));
      setFactor('');
      if (caught instanceof ApiError && caught.code === 'mfa_challenge_invalid') setStep('password');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'mfa') {
    return (
      <form onSubmit={submitFactor} aria-labelledby="mfa-heading">
        <h2 id="mfa-heading">{t('signIn.mfaHeading')}</h2>
        <SecondFactorInput
          mode={mode}
          value={factor}
          onChange={setFactor}
          onModeChange={(next) => {
            setMode(next);
            setFactor('');
          }}
        />
        {error !== null && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {t('signIn.verify')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">{t('signIn.heading')}</h2>
      <p>
        <label>
          {t('signIn.email')}
          <br />
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          {t('signIn.password')}
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
        {t('signIn.submit')}
      </button>
    </form>
  );
}

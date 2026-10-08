import { CREDENTIAL_BUDGETS, type CredentialProviderId, type WeatherCredential } from '@vergissmeinnicht/domain';
import { useId, useState, type FormEvent } from 'react';
import { ApiError, messageFor, type CredentialStatus } from './api.ts';
import { formatDateTime, t, type MessageKey } from './i18n/index.ts';
import { PROVIDER_NAMES } from './weather-view.ts';

/** Why a credential action failed, in words (the server sends a stable reason, never the provider's text). */
function failure(caught: unknown): string {
  if (caught instanceof ApiError && caught.code === 'weather_unavailable' && typeof caught.details.reason === 'string') return t(`weather.noForecast.${caught.details.reason}` as MessageKey);
  return messageFor(caught);
}

/**
 * One optional provider's credential (19.4b) — personal or server-wide. Write-only: a saved secret is never
 * shown again, only its status. Saving tests it with one real request first; a failing one is not kept.
 */
export function WeatherCredentialForm(props: {
  provider: CredentialProviderId;
  status: CredentialStatus | null;
  /** Server-wide: the admin also decides whether people without their own may use it. */
  server: boolean;
  onSave: (credential: WeatherCredential | undefined, dailyBudget: number, availableToUsers: boolean) => Promise<CredentialStatus>;
  onTest: () => Promise<CredentialStatus>;
  onRemove: () => Promise<unknown>;
}) {
  const id = useId();
  const { provider, status } = props;
  const limits = CREDENTIAL_BUDGETS[provider];
  const [apiKey, setApiKey] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [budget, setBudget] = useState(status?.dailyBudget ?? limits.default);
  const [available, setAvailable] = useState(status?.availableToUsers ?? false);
  const [current, setCurrent] = useState<CredentialStatus | null>(status);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entered = provider === 'OPENWEATHER' ? apiKey.trim() !== '' : username.trim() !== '' || password !== '';
  const credential: WeatherCredential | undefined = !entered ? undefined : provider === 'OPENWEATHER' ? { provider, apiKey: apiKey.trim() } : { provider, username: username.trim(), password };
  const act = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    setDone(null);
    try {
      await action();
      setDone(success);
    } catch (caught) {
      setMessage(failure(caught));
    } finally {
      setBusy(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      setCurrent(await props.onSave(credential, budget, available));
      // The secret leaves the page as soon as it is stored.
      setApiKey('');
      setPassword('');
    }, t('weather.credential.saved'));
  };
  const state =
    current === null
      ? t('weather.credential.notSet')
      : !current.readable
        ? t('weather.credential.reenter')
        : [
            t('weather.credential.set'),
            t('weather.credential.used', { used: current.usedToday, budget: current.dailyBudget }),
            ...(current.lastTest === null ? [] : [t(current.lastTest.ok ? 'weather.credential.testOk' : 'weather.credential.testFailed', { time: formatDateTime(current.lastTest.at) })]),
          ].join(' · ');
  return (
    <form className="stack weather-credential" onSubmit={save} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`}>
        {PROVIDER_NAMES[provider]} <small className="muted">{t('weather.credential.optional')}</small>
      </h4>
      <p className="muted">{t(`weather.credential.terms.${provider}`)}</p>
      <p>
        <strong>{t('weather.credential.status')}:</strong> {state}
      </p>
      {provider === 'OPENWEATHER' ? (
        <>
          <label htmlFor={`${id}-key`}>{t(current === null ? 'weather.credential.apiKey' : 'weather.credential.newApiKey')}</label>
          <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} maxLength={64} value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </>
      ) : (
        <>
          <label htmlFor={`${id}-user`}>{t(current === null ? 'weather.credential.username' : 'weather.credential.newUsername')}</label>
          <input id={`${id}-user`} autoComplete="off" spellCheck={false} maxLength={64} value={username} onChange={(event) => setUsername(event.target.value)} />
          <label htmlFor={`${id}-password`}>{t('weather.credential.password')}</label>
          <input id={`${id}-password`} type="password" autoComplete="off" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />
        </>
      )}
      <label htmlFor={`${id}-budget`}>{t('weather.credential.budget')}</label>
      <input id={`${id}-budget`} type="number" min={1} max={limits.max} step={1} required value={budget} onChange={(event) => setBudget(Math.round(Number(event.target.value)))} />
      <small className="muted">{t('weather.credential.budgetHint', { max: limits.max })}</small>
      {props.server && (
        <label className="row">
          <input type="checkbox" checked={available} onChange={(event) => setAvailable(event.target.checked)} />
          {t('weather.credential.availableToUsers')}
        </label>
      )}
      {message !== null && <p role="alert">{message}</p>}
      <p role="status" className="muted">
        {done ?? ''}
      </p>
      <div className="row">
        <button type="submit" className="primary" disabled={busy || (current === null && !entered)}>
          {t(entered || current === null ? 'weather.credential.saveAndTest' : 'weather.credential.saveSettings')}
        </button>
        {current !== null && (
          <button type="button" disabled={busy} onClick={() => void act(async () => setCurrent(await props.onTest()), t('weather.credential.tested'))}>
            {t('weather.credential.test')}
          </button>
        )}
        {current !== null && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t('weather.credential.removeConfirm', { provider: PROVIDER_NAMES[provider] }))) return;
              void act(async () => {
                await props.onRemove();
                setCurrent(null);
              }, t('weather.credential.removed'));
            }}
          >
            {t('weather.credential.remove')}
          </button>
        )}
      </div>
    </form>
  );
}

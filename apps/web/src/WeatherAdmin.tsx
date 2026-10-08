import { WEATHER_PROVIDERS, type WeatherProviderId } from '@vergissmeinnicht/domain';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, messageFor, type ServerWeather } from './api.ts';
import { t } from './i18n/index.ts';
import { PROVIDER_NAMES } from './weather-view.ts';

/** Credential providers come with 19.4b: until then they can be allowed but not used. */
const NEEDS_CREDENTIALS: readonly WeatherProviderId[] = ['OPENWEATHER', 'METEOMATICS'];

/** Server admin → Weather (19.4): the master switch, allowed providers and MET Norway's contact. */
export function WeatherAdmin() {
  const id = useId();
  const [settings, setSettings] = useState<ServerWeather | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.serverWeather().then(setSettings, (caught: unknown) => setMessage(messageFor(caught)));
  }, []);
  if (settings === null) return <div className="card">{message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>}</div>;
  const save = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setSaved(false);
    api.saveServerWeather(settings).then(
      (next) => {
        setSettings(next);
        setSaved(true);
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  };
  return (
    <form className="card stack" onSubmit={save}>
      <h3>{t('weather.admin.heading')}</h3>
      <p className="muted">{t('weather.admin.lead')}</p>
      {message !== null && <p role="alert">{message}</p>}
      <label className="row">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
        <strong>{t('weather.admin.enabled')}</strong>
      </label>
      <small className="muted">{t('weather.admin.enabledHint')}</small>
      <fieldset disabled={!settings.enabled}>
        <legend>{t('weather.admin.allowed')}</legend>
        {WEATHER_PROVIDERS.map((provider) => (
          <label key={provider} className="row">
            <input
              type="checkbox"
              checked={settings.allowed.includes(provider)}
              onChange={(event) => setSettings({ ...settings, allowed: event.target.checked ? [...settings.allowed, provider] : settings.allowed.filter((each) => each !== provider) })}
            />
            {PROVIDER_NAMES[provider]}
            {NEEDS_CREDENTIALS.includes(provider) && <small className="muted"> — {t('weather.admin.needsCredentials')}</small>}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-contact`}>{t('weather.admin.metContact')}</label>
      <input id={`${id}-contact`} type="email" maxLength={254} value={settings.metContact ?? ''} onChange={(event) => setSettings({ ...settings, metContact: event.target.value === '' ? null : event.target.value })} />
      <small className="muted">{t('weather.admin.metContactHint')}</small>
      <p role="status" className="muted">
        {saved ? t('weather.saved') : ''}
      </p>
      <button type="submit" className="primary">
        {t('weather.admin.save')}
      </button>
    </form>
  );
}

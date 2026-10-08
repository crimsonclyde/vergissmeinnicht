import { DEFAULT_WEATHER_SETTINGS, KEYLESS_PROVIDERS, WEATHER_UNITS, type OpenMeteoModelId, type WeatherLocation, type WeatherProviderChoice, type WeatherSettings as Settings } from '@vergissmeinnicht/domain';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, api, messageFor, type ModelChoice, type MyForecast, type MyWeather, type PlaceResult } from './api.ts';
import { formatCalendarDate, formatDateTime, t, type MessageKey } from './i18n/index.ts';
import { browserTimeZone } from './schedule-dates.ts';
import { UiIcon } from './ui-icons.tsx';
import { WeatherCredentialForm } from './WeatherCredentialForm.tsx';
import { ATTRIBUTION, PROVIDER_NAMES, conditionIcon, sourceLabel, temperature } from './weather-view.ts';

const zones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [browserTimeZone()];
  }
})();

/** The detailed forecast: up to 3 days with every value the provider has — "—" where it has none. */
/** Days shown before "Show all": a week fits a phone screen; the rest is one tap away. */
const FIRST_DAYS = 7;

function ForecastDetails({ answer }: { answer: MyForecast | null }) {
  const [all, setAll] = useState(false);
  if (answer === null) return <p>{t('common.loading')}</p>;
  if (answer.forecast === null) return <p className="muted">{t(`weather.noForecast.${answer.reason}` as MessageKey)}</p>;
  const { forecast, unit } = answer;
  const value = (text: string | null) => text ?? t('weather.missing');
  const attribution = ATTRIBUTION[forecast.provider];
  return (
    <div className="stack">
      <p>
        {forecast.current?.temperature !== undefined && <strong>{temperature(forecast.current.temperature, unit)} </strong>}
        {forecast.current?.condition !== undefined && t(`weather.condition.${forecast.current.condition}`)}
      </p>
      <p className="muted">{t('weather.horizon', { count: answer.horizon })}</p>
      <ul className="plain-list weather-days">
        {(all ? forecast.days : forecast.days.slice(0, FIRST_DAYS)).map((day) => (
          <li key={day.date}>
            <strong>{formatCalendarDate(day.date)}</strong>
            {day.partial === true && <small className="muted"> · {t('weather.partial')}</small>}
            <p className="row weather-day-condition">
              <UiIcon name={conditionIcon(day.condition)} size="1.5em" /> {day.condition === undefined ? t('weather.missing') : t(`weather.condition.${day.condition}`)}
            </p>
            <dl>
              <dt>{t('weather.max')}</dt>
              <dd>{value(temperature(day.max, unit))}</dd>
              <dt>{t('weather.min')}</dt>
              <dd>{value(temperature(day.min, unit))}</dd>
              <dt>{t('weather.rain')}</dt>
              <dd>{day.precipitationSum === undefined ? t('weather.missing') : `${day.precipitationSum} mm`}</dd>
              <dt>{t('weather.rainProbability')}</dt>
              <dd>{day.precipitationProbabilityMax === undefined ? t('weather.missing') : `${day.precipitationProbabilityMax}%`}</dd>
              <dt>{t('weather.wind')}</dt>
              <dd>{day.windSpeedMax === undefined ? t('weather.missing') : `${Math.round(day.windSpeedMax)} km/h`}</dd>
            </dl>
          </li>
        ))}
      </ul>
      {forecast.days.length > FIRST_DAYS && (
        <button type="button" className="quiet" aria-expanded={all} onClick={() => setAll((value) => !value)}>
          {all ? t('weather.showFewer') : t('weather.showAll', { count: forecast.days.length })}
        </button>
      )}
      <p className="muted">
        {t('weather.source', { source: sourceLabel(forecast.provider, forecast.model) })}
        {answer.fellBackFrom !== null && ` — ${t('weather.fellBackFrom', { provider: PROVIDER_NAMES[answer.fellBackFrom] })}`}
        <br />
        {forecast.issuedAt !== undefined && <>{t('weather.issued', { time: formatDateTime(forecast.issuedAt) })} · </>}
        {t('weather.fetched', { time: formatDateTime(answer.fetchedAt) })}
        <br />
        <a href={attribution.href} target="_blank" rel="noreferrer noopener">
          {attribution.text}
        </a>
      </p>
    </div>
  );
}

/**
 * Profile & settings → Weather (19.4): the person's own place (search or coordinates, elevation),
 * provider, Open-Meteo model (only those covering the place), fallback and display — and the detailed
 * forecast. Nothing is fetched until the person searches or saves; never the device's location.
 */
export function WeatherSettings() {
  const id = useId();
  const [mine, setMine] = useState<MyWeather | null>(null);
  const [off, setOff] = useState(false);
  const [draft, setDraft] = useState<Settings>(DEFAULT_WEATHER_SETTINGS);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<readonly PlaceResult[] | null>(null);
  const [manual, setManual] = useState({ name: '', latitude: '', longitude: '', timeZone: browserTimeZone(), elevation: '' });
  const [models, setModels] = useState<readonly ModelChoice[] | null>(null);
  const [forecast, setForecast] = useState<MyForecast | null>(null);

  useEffect(() => {
    api.myWeather().then(
      (loaded) => {
        setMine(loaded);
        setDraft(loaded.settings);
      },
      (caught: unknown) => {
        if (caught instanceof ApiError && caught.code === 'weather_off') setOff(true);
        else setMessage(messageFor(caught));
      },
    );
    api.myForecast().then(setForecast, () => undefined);
  }, []);

  // Which models cover the chosen place (asked once per place; the server caches it for a day).
  const place = draft.location;
  useEffect(() => {
    if (place === null || mine?.providers.includes('OPEN_METEO') !== true) return;
    let active = true;
    api.weatherModels(place).then(
      (found) => active && setModels(found),
      () => active && setModels([]),
    );
    return () => {
      active = false;
    };
  }, [place, mine]);

  if (off) return <p>{t('weather.off')}</p>;
  if (mine === null) return message === null ? <p>{t('common.loading')}</p> : <p role="alert">{message}</p>;

  const choose = (location: WeatherLocation) => {
    setModels(null);
    setSaved(false);
    // A model that may not cover the new place goes back to Automatic; everything else stays.
    setDraft((current) => ({ ...current, location, model: 'best_match' }));
    setPlaces(null);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    api.searchPlaces(query, (navigator.language || 'en').slice(0, 2).toLowerCase()).then(setPlaces, (caught: unknown) => setMessage(messageFor(caught)));
  };
  const useCoordinates = (event: FormEvent) => {
    event.preventDefault();
    const latitude = Number(manual.latitude);
    const longitude = Number(manual.longitude);
    const elevation = manual.elevation.trim() === '' ? null : Number(manual.elevation);
    choose({ name: manual.name.trim() || `${latitude}, ${longitude}`, latitude, longitude, timeZone: manual.timeZone, elevation });
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setSaved(false);
    api.saveMyWeather(draft).then(
      (result) => {
        setMine(result);
        setDraft(result.settings);
        setSaved(true);
        setForecast(null);
        api.myForecast().then(setForecast, (caught: unknown) => setMessage(messageFor(caught)));
      },
      (caught: unknown) => setMessage(messageFor(caught)),
    );
  };
  const modelLabel = (model: ModelChoice) =>
    [
      model.label,
      ...(model.days === null ? [] : [t('weather.modelDays', { count: model.days })]),
      ...(model.hasPrecipitationProbability === false ? [t('weather.modelNoRain')] : []),
      ...(model.hasCondition === false ? [t('weather.modelNoCondition')] : []),
    ].join(' · ');

  return (
    <div className="stack weather-settings">
      <h3>{t('weather.heading')}</h3>
      <p className="muted">{t('weather.lead')}</p>
      {message !== null && <p role="alert">{message}</p>}

      <fieldset>
        <legend>{t('weather.place')}</legend>
        <p>
          {place === null ? (
            <span className="muted">{t('weather.noPlace')}</span>
          ) : (
            <>
              <UiIcon name="place" /> <strong>{place.name}</strong>{' '}
              <small className="muted">
                {place.latitude}, {place.longitude}
                {place.elevation === null ? '' : ` · ${place.elevation} m`} · {place.timeZone}
              </small>
            </>
          )}
        </p>
        {mine.providers.includes('OPEN_METEO') && (
          <form className="row" onSubmit={search} role="search">
            <label htmlFor={`${id}-q`}>{t('weather.search')}</label>
            <input id={`${id}-q`} value={query} minLength={2} maxLength={80} onChange={(event) => setQuery(event.target.value)} />
            <button type="submit">{t('weather.searchButton')}</button>
          </form>
        )}
        {mine.providers.includes('OPEN_METEO') && <small className="muted">{t('weather.searchHint')}</small>}
        {places !== null &&
          (places.length === 0 ? (
            <p className="muted">{t('weather.noResults')}</p>
          ) : (
            <ul className="plain-list weather-places">
              {places.map((found) => (
                <li key={`${found.latitude},${found.longitude},${found.name}`}>
                  <button type="button" className="quiet" aria-label={t('weather.choose', { name: `${found.name}, ${found.context}` })} onClick={() => choose({ name: found.name, latitude: found.latitude, longitude: found.longitude, timeZone: found.timeZone, elevation: found.elevation })}>
                    <strong>{found.name}</strong>&nbsp;<small className="muted">{found.context}{found.elevation === null ? '' : ` · ${found.elevation} m`}</small>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        <details>
          <summary>{t('weather.manual')}</summary>
          <form className="stack" onSubmit={useCoordinates}>
            <label htmlFor={`${id}-name`}>{t('weather.name')}</label>
            <input id={`${id}-name`} value={manual.name} maxLength={120} onChange={(event) => setManual({ ...manual, name: event.target.value })} />
            <div className="weather-coordinates">
              <label>
                {t('weather.latitude')}
                <input type="number" required min={-90} max={90} step="any" value={manual.latitude} onChange={(event) => setManual({ ...manual, latitude: event.target.value })} />
              </label>
              <label>
                {t('weather.longitude')}
                <input type="number" required min={-180} max={180} step="any" value={manual.longitude} onChange={(event) => setManual({ ...manual, longitude: event.target.value })} />
              </label>
            </div>
            <label htmlFor={`${id}-zone`}>{t('weather.timeZone')}</label>
            <select id={`${id}-zone`} value={manual.timeZone} onChange={(event) => setManual({ ...manual, timeZone: event.target.value })}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <button type="submit">{t('weather.useCoordinates')}</button>
          </form>
        </details>
      </fieldset>

      <form className="stack" onSubmit={save}>
        {place !== null && (
          <>
            <label htmlFor={`${id}-elevation`}>{t('weather.elevation')}</label>
            <input
              id={`${id}-elevation`}
              type="number"
              min={-500}
              max={9000}
              step={1}
              value={place.elevation ?? ''}
              onChange={(event) => setDraft({ ...draft, location: { ...place, elevation: event.target.value === '' ? null : Math.round(Number(event.target.value)) } })}
            />
            <small className="muted">{t('weather.elevationHint')}</small>
          </>
        )}
        <label htmlFor={`${id}-provider`}>{t('weather.provider')}</label>
        <select id={`${id}-provider`} value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value as WeatherProviderChoice })}>
          <option value="AUTO">{t('weather.provider.AUTO')}</option>
          {mine.providers.map((provider) => (
            <option key={provider} value={provider}>
              {PROVIDER_NAMES[provider]}
              {!KEYLESS_PROVIDERS.includes(provider) && ` — ${t('weather.withCredentials')}`}
            </option>
          ))}
          {/* Optional providers without a usable credential are listed, not selectable: what they need is said. */}
          {mine.credentialProviders
            .filter((entry) => entry.allowed && !mine.providers.includes(entry.provider))
            .map((entry) => (
              <option key={entry.provider} value={entry.provider} disabled>
                {PROVIDER_NAMES[entry.provider]} — {t('weather.needsCredentials')}
              </option>
            ))}
        </select>
        {(draft.provider === 'AUTO' || draft.provider === 'OPEN_METEO') && mine.providers.includes('OPEN_METEO') && place !== null && (
          <>
            <label htmlFor={`${id}-model`}>{t('weather.model')}</label>
            {models === null ? (
              <p className="muted">{t('weather.modelsLoading')}</p>
            ) : (
              <select id={`${id}-model`} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value as OpenMeteoModelId })}>
                {(models.length === 0 ? [{ id: 'best_match' as const, label: 'Automatic (best match)', days: null, hasCondition: null, hasPrecipitationProbability: null }] : models).map((model) => (
                  <option key={model.id} value={model.id}>
                    {modelLabel(model)}
                  </option>
                ))}
              </select>
            )}
            <small className="muted">{t('weather.modelHint')}</small>
          </>
        )}
        {draft.provider !== 'AUTO' && (
          <label className="row">
            <input type="checkbox" checked={draft.fallback} onChange={(event) => setDraft({ ...draft, fallback: event.target.checked })} />
            {t('weather.fallback')}
          </label>
        )}
        <fieldset>
          <legend>{t('weather.unit')}</legend>
          {WEATHER_UNITS.map((unit) => (
            <label key={unit} className="row">
              <input type="radio" name={`${id}-unit`} checked={draft.unit === unit} onChange={() => setDraft({ ...draft, unit })} />
              {t(`weather.unit.${unit}`)}
            </label>
          ))}
        </fieldset>
        <label className="row">
          <input type="checkbox" checked={draft.showTomorrow} onChange={(event) => setDraft({ ...draft, showTomorrow: event.target.checked })} />
          {t('weather.showTomorrow')}
        </label>
        <p className="muted">{t('weather.privacy')}</p>
        <p role="status" className="muted">
          {saved ? t('weather.saved') : ''}
        </p>
        <button type="submit" className="primary">
          {t('weather.save')}
        </button>
      </form>

      {mine.credentialProviders.some((entry) => entry.allowed) && (
        <details className="weather-credentials">
          <summary>{t('weather.credentials.heading')}</summary>
          <p className="muted">{t('weather.credentials.lead')}</p>
          {mine.credentialProviders
            .filter((entry) => entry.allowed)
            .map((entry) => (
              <div key={entry.provider} className="stack">
                {entry.serverAvailable && <p className="muted">{t(entry.personal === null ? 'weather.credentials.serverInUse' : 'weather.credentials.serverOverridden')}</p>}
                <WeatherCredentialForm
                  provider={entry.provider}
                  status={entry.personal}
                  server={false}
                  onSave={async (credential, budget) => {
                    const saved = await api.savePersonalCredential(entry.provider, credential, budget);
                    setMine(await api.myWeather());
                    return saved;
                  }}
                  onTest={() => api.testPersonalCredential(entry.provider)}
                  onRemove={async () => {
                    await api.removePersonalCredential(entry.provider);
                    setMine(await api.myWeather());
                  }}
                />
              </div>
            ))}
        </details>
      )}

      <section aria-labelledby={`${id}-forecast`}>
        <h3 id={`${id}-forecast`}>{t('weather.forecast')}</h3>
        <ForecastDetails answer={forecast} />
      </section>
    </div>
  );
}

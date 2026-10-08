import type { WeatherProviderId } from '@vergissmeinnicht/domain';
import { useId, useState } from 'react';
import { ApiError, api, messageFor, type CompareResult, type Comparison, type ModelChoice, type MyWeather } from './api.ts';
import { formatCalendarDate, formatDateTime, formatTime, t, type MessageKey } from './i18n/index.ts';
import { todayIn } from './schedule-dates.ts';
import { UiIcon } from './ui-icons.tsx';
import { compareDates, dayOf, defaultSources, paidCost, sourceKey, spread, type SourceChoice } from './weather-compare.ts';
import { ATTRIBUTION, PROVIDER_NAMES, conditionIcon, sourceLabel, temperature } from './weather-view.ts';

const MAX_SOURCES = 8;

const reasonText = (reason: string) => t(`weather.noForecast.${reason}` as MessageKey);

/**
 * Compare forecasts (19.4c): the sources a person can use — providers and several Open-Meteo models —
 * side by side for one day at a time. Nothing is fetched until the person asks; paid sources only with
 * a second, explicit request that says how many paid calls it uses. No averages, no "best" forecast.
 */
export function WeatherCompare({ mine, models, unit }: { mine: MyWeather; models: readonly ModelChoice[]; unit: 'C' | 'F' }) {
  const id = useId();
  const [initial] = useState<readonly SourceChoice[]>(() => defaultSources(mine.providers, models));
  const [selected, setSelected] = useState<readonly SourceChoice[]>(initial);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const choices: (SourceChoice & { readonly label: string; readonly note?: string; readonly paid: boolean })[] = [
    ...(mine.providers.includes('OPEN_METEO') ? models.map((model) => ({ provider: 'OPEN_METEO' as const, model: model.id, label: `Open-Meteo · ${model.label}`, ...(model.days === null ? {} : { note: t('weather.modelDays', { count: model.days }) }), paid: false })) : []),
    ...(mine.providers.includes('MET_NORWAY') ? [{ provider: 'MET_NORWAY' as const, label: PROVIDER_NAMES.MET_NORWAY, paid: false }] : []),
    ...mine.credentialProviders
      .filter((entry) => mine.providers.includes(entry.provider))
      .map((entry) => ({
        provider: entry.provider,
        label: PROVIDER_NAMES[entry.provider],
        note:
          entry.personal === null
            ? t('weather.compare.paidServer')
            : t('weather.compare.paidOwn', { used: entry.personal.usedToday, budget: entry.personal.dailyBudget }),
        paid: true,
      })),
  ];
  const isSelected = (choice: SourceChoice) => selected.some((each) => sourceKey(each) === sourceKey(choice));
  // The many other Open-Meteo models are folded away unless one of them is ticked — the list stays short on a phone.
  const folded = (choice: SourceChoice) => choice.provider === 'OPEN_METEO' && !initial.some((each) => sourceKey(each) === sourceKey(choice));
  const checkbox = (choice: (typeof choices)[number]) => (
    <label key={sourceKey(choice)} className="row">
      <input type="checkbox" checked={isSelected(choice)} disabled={!isSelected(choice) && selected.length >= MAX_SOURCES} onChange={() => toggle(choice)} />
      <span>
        {choice.label}
        {choice.note !== undefined && <small className="muted"> · {choice.note}</small>}
      </span>
    </label>
  );
  const toggle = (choice: SourceChoice) => setSelected((current) => (isSelected(choice) ? current.filter((each) => sourceKey(each) !== sourceKey(choice)) : [...current, { provider: choice.provider, ...(choice.model === undefined ? {} : { model: choice.model }) }]));

  const run = (fetchPaid: boolean) => {
    setBusy(true);
    setMessage(null);
    api.compareForecasts(selected, fetchPaid).then(
      (answer) => {
        setComparison(answer);
        const dates = compareDates(answer.results);
        const today = answer.location === null ? null : todayIn(answer.location.timeZone);
        setDate((current) => (current !== null && dates.includes(current) ? current : today !== null && dates.includes(today) ? today : (dates[0] ?? null)));
        if (answer.reason !== undefined) setMessage(reasonText(answer.reason));
        setBusy(false);
      },
      (caught: unknown) => {
        setMessage(caught instanceof ApiError && typeof caught.details.reason === 'string' ? reasonText(caught.details.reason) : messageFor(caught));
        setBusy(false);
      },
    );
  };

  const results = comparison?.results ?? [];
  const dates = compareDates(results);
  const index = date === null ? -1 : dates.indexOf(date);
  const locationToday = comparison?.location === null || comparison?.location === undefined ? null : todayIn(comparison.location.timeZone);
  const cost = paidCost(results);
  const costText = (Object.entries(cost) as [WeatherProviderId, number][]).map(([provider, queries]) => t('weather.compare.cost', { count: queries, provider: PROVIDER_NAMES[provider] })).join(', ');
  const range = (field: Parameters<typeof spread>[2], format: (value: number) => string) => {
    if (date === null) return null;
    const found = spread(results, date, field);
    if (found === null) return null;
    // Compared as shown: 17.9° and 18.4° both read "18°" — one value, not "18° – 18°".
    const low = format(found.low);
    const high = format(found.high);
    return `${low === high ? low : `${low} – ${high}`}${found.missing > 0 ? ` (${t('weather.compare.notGiven', { count: found.missing })})` : ''}`;
  };
  const temp = (value: number) => temperature(value, unit) ?? '—';

  return (
    <section className="stack weather-compare" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>{t('weather.compare.heading')}</h3>
      <p className="muted">{t('weather.compare.lead')}</p>
      <fieldset className="weather-compare-sources">
        <legend>{t('weather.compare.sources')}</legend>
        {choices.filter((choice) => !folded(choice)).map(checkbox)}
        {choices.some(folded) && (
          <details>
            <summary>{t('weather.compare.moreModels', { count: choices.filter(folded).length })}</summary>
            {choices.filter(folded).map(checkbox)}
          </details>
        )}
      </fieldset>
      <button type="button" className="primary" disabled={busy || selected.length === 0} onClick={() => run(false)}>
        {t('weather.compare.run')}
      </button>
      {message !== null && <p role="alert">{message}</p>}
      {costText !== '' && (
        <div className="weather-compare-paid">
          <p>{t('weather.compare.paidPending', { cost: costText })}</p>
          <button type="button" disabled={busy} onClick={() => run(true)}>
            {t('weather.compare.fetchPaid')}
          </button>
        </div>
      )}
      {comparison !== null && dates.length > 0 && date !== null && (
        <>
          <div className="row weather-compare-day">
            <button type="button" className="quiet" aria-label={t('weather.compare.previous')} disabled={index <= 0} onClick={() => setDate(dates[index - 1] ?? date)}>
              <UiIcon name="back" />
            </button>
            <label htmlFor={`${id}-date`} className="visually-hidden">
              {t('weather.compare.day')}
            </label>
            <select id={`${id}-date`} value={date} onChange={(event) => setDate(event.target.value)}>
              {dates.map((each) => (
                <option key={each} value={each}>
                  {formatCalendarDate(each)}
                  {each === locationToday ? ` (${t('weather.compare.today')})` : ''}
                </option>
              ))}
            </select>
            <button type="button" className="quiet" aria-label={t('weather.compare.next')} disabled={index >= dates.length - 1} onClick={() => setDate(dates[index + 1] ?? date)}>
              <UiIcon name="forward" />
            </button>
          </div>
          <dl className="weather-compare-spread" aria-label={t('weather.compare.spread')}>
            {[
              [t('weather.max'), range('max', temp)],
              [t('weather.min'), range('min', temp)],
              [t('weather.rain'), range('precipitationSum', (value) => `${value} mm`)],
              [t('weather.rainProbability'), range('precipitationProbabilityMax', (value) => `${value}%`)],
              [t('weather.wind'), range('windSpeedMax', (value) => `${Math.round(value)} km/h`)],
            ]
              .filter((entry): entry is [string, string] => entry[1] !== null)
              .map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          <ul className="plain-list weather-compare-results">
            {results.map((result) => (
              <SourceDay key={sourceKey(result)} result={result} date={date} isToday={date === locationToday} unit={unit} />
            ))}
          </ul>
          <p className="muted weather-compare-attribution">
            {[...new Set(results.map((result) => result.provider))].map((provider) => (
              <a key={provider} href={ATTRIBUTION[provider].href} target="_blank" rel="noreferrer noopener">
                {ATTRIBUTION[provider].text}
              </a>
            ))}
          </p>
        </>
      )}
    </section>
  );
}

/** One source for one day: what it says, and — clearly — what it does not. */
function SourceDay({ result, date, isToday, unit }: { result: CompareResult; date: string; isToday: boolean; unit: 'C' | 'F' }) {
  const label = sourceLabel(result.provider, result.model ?? undefined);
  const value = (text: string | null) => text ?? t('weather.missing');
  if (result.state === 'not_fetched' || result.state === 'failed') {
    return (
      <li className="weather-compare-source">
        <strong>{label}</strong>
        <p className="muted">{result.state === 'not_fetched' ? t('weather.compare.notFetched') : reasonText(result.reason)}</p>
      </li>
    );
  }
  const day = dayOf(result, date);
  const updated = result.forecast.issuedAt ?? result.fetchedAt;
  return (
    <li className="weather-compare-source">
      <strong>{label}</strong>
      <small className="muted">
        {result.forecast.issuedAt !== undefined ? t('weather.issued', { time: formatDateTime(updated) }) : t('weather.fetched', { time: formatDateTime(updated) })}
        {result.state === 'cached' && ` · ${t('weather.asOf', { time: formatTime(result.fetchedAt) })}`}
        {result.refreshFailed !== null && ` · ${reasonText(result.refreshFailed)}`}
        {` · ${t('weather.compare.offers', { count: result.horizon })}`}
      </small>
      {day === undefined ? (
        <p className="muted">{t('weather.compare.noDay', { count: result.horizon })}</p>
      ) : (
        <>
          <p className="row weather-day-condition">
            <UiIcon name={conditionIcon(day.condition)} size="1.4em" /> {day.condition === undefined ? t('weather.missing') : t(`weather.condition.${day.condition}`)}
            {day.partial === true && <small className="muted"> · {t('weather.partial')}</small>}
          </p>
          <dl>
            {isToday && result.forecast.current?.temperature !== undefined && (
              <>
                <dt>{t('weather.compare.now')}</dt>
                <dd>{temperature(result.forecast.current.temperature, unit)}</dd>
              </>
            )}
            <dt>{t('weather.max')}</dt>
            <dd>{value(temperature(day.max, unit))}</dd>
            <dt>{t('weather.min')}</dt>
            <dd>{value(temperature(day.min, unit))}</dd>
            <dt>{t('weather.rain')}</dt>
            <dd>{day.precipitationSum === undefined ? t('weather.compare.notGivenShort') : `${day.precipitationSum} mm`}</dd>
            <dt>{t('weather.rainProbability')}</dt>
            <dd>{day.precipitationProbabilityMax === undefined ? t('weather.compare.notGivenShort') : `${day.precipitationProbabilityMax}%`}</dd>
            <dt>{t('weather.wind')}</dt>
            <dd>{day.windSpeedMax === undefined ? t('weather.compare.notGivenShort') : `${Math.round(day.windSpeedMax)} km/h`}</dd>
          </dl>
        </>
      )}
    </li>
  );
}

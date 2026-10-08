import { useEffect, useState } from 'react';
import { api, isNetworkError, type MyForecast } from './api.ts';
import { formatTime, t } from './i18n/index.ts';
import { offlineStore } from './offline/store.ts';
import { Link, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { conditionIcon, rainIndication, showable, sourceLabel, temperature } from './weather-view.ts';

type Shown = Extract<MyForecast, { forecast: object }>;

/** The person's forecast for Today, kept on the device for a while (offline, a provider outage). */
export function useMyForecast(userId: string, wanted: boolean): Shown | null {
  const [shown, setShown] = useState<Shown | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let active = true;
    api.myForecast().then(
      (answer) => {
        if (!active) return;
        if (answer.forecast === null) {
          setShown(null);
          return;
        }
        setShown(answer);
        void offlineStore.saveForecast(userId, answer);
      },
      async (caught: unknown) => {
        // Weather never shows an error on Today: offline, the last forecast (≤ 6 h, with its time); otherwise nothing.
        const saved = isNetworkError(caught) ? ((await offlineStore.loadForecast(userId)) as Shown | undefined) : undefined;
        if (active) setShown(saved !== undefined && showable(saved.fetchedAt) ? { ...saved, stale: true } : null);
      },
    );
    return () => {
      active = false;
    };
  }, [userId, wanted]);
  return shown !== null && showable(shown.fetchedAt) ? shown : null;
}

/**
 * Weather on Today (19.4): place, condition, temperature, today's high/low, rain (probability or amount,
 * whichever the provider has) and who supplied it; tomorrow as a small line. Opens the detailed forecast.
 * Monochrome icons; the condition is always written out.
 */
export function WeatherCard({ data }: { data: Shown }) {
  const { forecast, unit } = data;
  const [today, tomorrow] = forecast.days;
  const now = temperature(forecast.current?.temperature, unit);
  const condition = forecast.current?.condition ?? today?.condition;
  const rain = rainIndication(today);
  const high = temperature(today?.max, unit);
  const low = temperature(today?.min, unit);
  return (
    <section className="card today-card today-weather" aria-label={t('today.weatherIn', { place: data.location.name })} data-card="weather">
      <Link href={paths.account('weather')} className="today-weather-link">
        <span className="today-weather-main">
          <UiIcon name={conditionIcon(condition)} size="2em" />
          {now !== null && <span className="today-weather-now">{now}</span>}
          <span className="today-weather-text">
            <strong>{data.location.name}</strong>
            <span>
              {condition !== undefined && t(`weather.condition.${condition}`)}
              {high !== null && low !== null && ` · ${t('weather.highLow', { high, low })}`}
              {rain !== null && ` · ${rain.kind === 'probability' ? t('weather.rainChance', { value: rain.value }) : t('weather.rainAmount', { value: rain.value })}`}
            </span>
          </span>
        </span>
        {data.showTomorrow && tomorrow !== undefined && (
          <small className="muted today-weather-tomorrow">
            {t('weather.tomorrow')}: {tomorrow.condition === undefined ? '' : `${t(`weather.condition.${tomorrow.condition}`)} · `}
            {temperature(tomorrow.max, unit) ?? '—'} / {temperature(tomorrow.min, unit) ?? '—'}
          </small>
        )}
        <small className="muted today-weather-source">
          {sourceLabel(forecast.provider, forecast.model)}
          {data.fellBackFrom !== null && ` · ${t('weather.fellBack')}`}
          {data.stale && ` · ${t('weather.asOf', { time: formatTime(data.fetchedAt) })}`}
        </small>
      </Link>
    </section>
  );
}

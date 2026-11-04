import { t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { useId } from 'react';
import { InstrumentPicture } from './applets/InstrumentPicture.tsx';
import { UiIcon } from './ui-icons.tsx';
import { useForecast, type ShownForecast } from './applets/ForecastProvider.tsx';

import { formatNumber, formatTime } from './i18n/index.ts';
import { conditionIcon, rainIndication, temperature } from './weather-view.ts';
type Shown = ShownForecast;

/** The person's forecast for Today, kept on the device for a while (offline, a provider outage). */
export function useMyForecast(wanted: boolean): Shown | null {
  const { data } = useForecast();
  return wanted ? data : null;
}

/** A personal instrument tile, sharing the screen's canonical forecast and opt-in. */
export function WeatherCard({ data }: { data: Shown }) {
  const { forecast, unit } = data;
  const today = forecast.days[0];
  const condition = forecast.current?.condition ?? today?.condition;
  const description = useId();
  const degrees = temperature(forecast.current?.temperature, unit);
  const rain = rainIndication(today);
  return <Link href={paths.weather()} className="today-instrument-half" data-card="weather" aria-label={t('today.weatherIn', { place: data.location.name })} aria-describedby={description}>
    <InstrumentPicture kind="weather" />
    <span className="instrument-half-name">{t('weather.heading')}</span>
    {data.stale && <span className="instrument-half-stale">{t('weather.asOf', { time: formatTime(data.fetchedAt) })}</span>}
    <span className="instrument-half-copy" id={description}>
      <span className="instrument-half-value">{degrees ?? t('weather.missing')}<small>{degrees === null ? '°' : ''}{unit}</small></span>
      <span className="instrument-half-context" title={data.location.name}>{data.location.name}</span>
      <span className="instrument-half-context instrument-half-weather"><UiIcon name={conditionIcon(condition)} size="1.2rem" /><span>{rain === null ? t('weather.missing') : rain.kind === 'probability' ? `${rain.value}%` : `${formatNumber(rain.value, 1)} mm`}</span><span className="visually-hidden">{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}</span></span>
      {forecast.current?.condition === undefined && <span className="instrument-half-context">{t('weather.dailyOutlook')}</span>}
    </span>
  </Link>;
}

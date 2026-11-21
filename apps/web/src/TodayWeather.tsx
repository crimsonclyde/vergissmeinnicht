import { t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { useId } from 'react';
import { InstrumentPicture } from './applets/InstrumentPicture.tsx';
import { UiIcon } from './ui-icons.tsx';
import { useForecast, type ShownForecast } from './applets/ForecastProvider.tsx';
import type { PublishedWeather } from './applets/PublishedWeather.tsx';

import { formatNumber, formatTime } from './i18n/index.ts';
import { rainIndication, temperature } from './weather-view.ts';
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
    <InstrumentPicture kind="weather" condition={condition} />
    <span className="instrument-half-name">{t('weather.heading')}</span>
    {data.stale && <span className="instrument-half-stale">{t('weather.asOf', { time: formatTime(data.fetchedAt) })}</span>}
    <span className="instrument-half-copy" id={description}>
      <span className="instrument-half-value">{degrees ?? t('weather.missing')}<small>{degrees === null ? '°' : ''}{unit}</small></span>
      <span className="instrument-half-context" title={data.location.name}>{data.location.name}</span>
      <span className="instrument-half-context">{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}</span>
      <span className="instrument-half-context instrument-half-weather"><UiIcon name="weatherRain" size="1.2rem" /><span>{rain === null ? t('weather.missing') : rain.kind === 'probability' ? `${rain.value}%` : `${formatNumber(rain.value, 1)} mm`}</span></span>
      {forecast.current?.condition === undefined && <span className="instrument-half-context">{t('weather.dailyOutlook')}</span>}
    </span>
  </Link>;
}

/** Today's weather as published in The Daily Planet (46): high and low, the place, the sky and rain. Opens the edition. */
export function PublishedWeatherCard({ published, unit }: { published: PublishedWeather; unit: 'C' | 'F' }) {
  const { place } = published;
  const description = useId();
  const high = temperature(place.high ?? undefined, unit);
  const low = temperature(place.low ?? undefined, unit);
  const rain = place.precipitationProbability !== null ? `${Math.round(place.precipitationProbability)}%` : place.precipitationMm !== null ? `${formatNumber(place.precipitationMm, 1)} mm` : t('weather.missing');
  return <Link href={paths.gazetteWeather(published.workspaceId, published.date)} className="today-instrument-half" data-card="weather" data-source="daily-planet" aria-label={t('today.weatherPublished', { place: place.name })} aria-describedby={description}>
    <InstrumentPicture kind="weather" condition={place.condition} />
    <span className="instrument-half-name">{t('weather.heading')}</span>
    <span className="instrument-half-copy" id={description}>
      <span className="instrument-half-value">{high ?? t('weather.missing')}<small>{high === null ? '°' : ''}{unit}</small>{low !== null && <small className="instrument-half-low"> / {low}</small>}</span>
      <span className="instrument-half-context" title={place.name}>{place.name}</span>
      <span className="instrument-half-context">{t(`weather.condition.${place.condition}`)}</span>
      <span className="instrument-half-context instrument-half-weather"><UiIcon name="weatherRain" size="1.2rem" /><span>{rain}</span></span>
      <span className="instrument-half-context instrument-half-source"><UiIcon name="gazette" size="1rem" /><span>{t('weather.fromDailyPlanet')}</span></span>
    </span>
  </Link>;
}

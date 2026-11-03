import { t } from './i18n/index.ts';
import { Link, paths } from './router.tsx';
import { UiIcon } from './ui-icons.tsx';
import { useForecast, type ShownForecast } from './applets/ForecastProvider.tsx';

import { formatTime } from './i18n/index.ts';
import { conditionIcon, rainIndication, sourceLabel, temperature } from './weather-view.ts';
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
  const rain = rainIndication(today);
  return <section className="card today-card today-weather" aria-label={t('today.weatherIn', { place: data.location.name })} data-card="weather">
    <div className="instrument instrument-weather-compact">
      <header className="instrument-heading"><span>{t('weather.heading')}</span><h3>{data.location.name}</h3></header>
      <div className="instrument-weather-glance"><UiIcon name={conditionIcon(condition)} size="2.5em" /><span className="instrument-time">{temperature(forecast.current?.temperature, unit) ?? t('weather.missing')}<small>{unit}</small></span></div>
      <p>{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}{forecast.current?.condition === undefined && ` · ${t('weather.dailyOutlook')}`}</p>
      <p>{t('weather.max')} {temperature(today?.max, unit) ?? t('weather.missing')} · {t('weather.min')} {temperature(today?.min, unit) ?? t('weather.missing')}</p>
      {rain !== null && <p>{rain.kind === 'probability' ? t('weather.rainChance', { value: rain.value }) : t('weather.rainAmount', { value: rain.value })}{today?.partial === true && ` · ${t('weather.partial')}`}</p>}
      {data.showTomorrow && forecast.days[1] !== undefined && <p className="instrument-compact-source">{t('weather.tomorrow')}: {t(`weather.condition.${forecast.days[1].condition ?? 'UNKNOWN'}`)} · {temperature(forecast.days[1].max, unit) ?? t('weather.missing')} / {temperature(forecast.days[1].min, unit) ?? t('weather.missing')}</p>}
      <p className="instrument-compact-source">{sourceLabel(forecast.provider, forecast.model)}{data.fellBackFrom !== null && ` · ${t('weather.fellBack')}`}{data.stale && ` · ${t('weather.asOf', { time: formatTime(data.fetchedAt) })}`}</p>
    </div>
    <Link href={paths.weather()} className="today-weather-open">{t('guide.weatherOpenLink')} <UiIcon name="forward" /></Link>
  </section>;
}

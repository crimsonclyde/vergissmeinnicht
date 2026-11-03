import { formatCalendarDate, formatMoonDateTime, formatNumber, t } from '../i18n/index.ts';
import { UiIcon } from '../ui-icons.tsx';
import { ATTRIBUTION, PROVIDER_NAMES, conditionIcon, sourceLabel, temperature } from '../weather-view.ts';
import type { ShownForecast } from './ForecastProvider.tsx';
import './instruments.css';

/** Every reading is text. Decoration follows the condition, never substitutes for unavailable data. */
export function WeatherInstrument({ data, screen = false }: { data: ShownForecast; screen?: boolean }) {
  const Heading = screen ? 'h2' : 'h3';
  const { forecast, unit, location } = data;
  const [today, tomorrow] = forecast.days;
  const condition = forecast.current?.condition ?? today?.condition;
  const value = (number: number | undefined, suffix: string) => number === undefined ? t('weather.missing') : `${formatNumber(number, 1)}${suffix}`;
  const attribution = ATTRIBUTION[forecast.provider];
  return <div className="instrument instrument-weather">
    <header className="instrument-heading"><span>{today === undefined ? location.timeZone : formatCalendarDate(today.date)}</span><Heading>{t('weather.appletTitle')}</Heading><i aria-hidden="true" /><p>{location.name}</p><span>{location.timeZone}</span></header>
    <div className="instrument-weather-now"><div className="instrument-weather-art" aria-hidden="true"><span className="instrument-weather-orbit" /><UiIcon name={conditionIcon(condition)} /></div><span className="instrument-temperature">{temperature(forecast.current?.temperature, unit) ?? t('weather.missing')}<small>{unit}</small></span><p>{forecast.current?.condition === undefined ? t('weather.dailyOutlook') : t('weather.now')}</p><p>{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}</p><p>{t('weather.max')} {temperature(today?.max, unit) ?? t('weather.missing')} · {t('weather.min')} {temperature(today?.min, unit) ?? t('weather.missing')}</p></div>
    <dl className="instrument-weather-readings"><div><dt><UiIcon name="weatherDrizzle" />{t('weather.rainProbability')}</dt><dd>{value(today?.precipitationProbabilityMax, '%')}</dd></div><div><dt><UiIcon name="weatherRain" />{t('weather.rain')}{today?.partial === true && <span>{t('weather.partial')}</span>}</dt><dd>{value(today?.precipitationSum, ' mm')}</dd></div><div><dt><UiIcon name="wind" />{t(forecast.current?.windSpeed === undefined ? 'weather.windMax' : 'weather.windNow')}</dt><dd>{value(forecast.current?.windSpeed ?? today?.windSpeedMax, ' km/h')}</dd></div></dl>
    {data.showTomorrow && tomorrow !== undefined && <div className="instrument-weather-tomorrow"><div><span>{t('weather.tomorrow')} · {formatCalendarDate(tomorrow.date)}</span><p>{t(`weather.condition.${tomorrow.condition ?? 'UNKNOWN'}`)}</p>{tomorrow.partial === true && <small>{t('weather.partial')}</small>}</div><strong>{temperature(tomorrow.max, unit) ?? t('weather.missing')} / {temperature(tomorrow.min, unit) ?? t('weather.missing')}</strong></div>}
    <footer className="instrument-weather-source"><span>{sourceLabel(forecast.provider, forecast.model)}</span>{data.fellBackFrom !== null && <span>{t('weather.fellBackFrom', { provider: PROVIDER_NAMES[data.fellBackFrom] })}</span>}<span>{t('weather.fetched', { time: formatMoonDateTime(new Date(data.fetchedAt), location.timeZone) })}</span>{forecast.issuedAt !== undefined && <span>{t('weather.issued', { time: formatMoonDateTime(new Date(forecast.issuedAt), location.timeZone) })}</span>}<a href={attribution.href} target="_blank" rel="noreferrer noopener">{attribution.text}</a></footer>
    {data.stale && <p className="instrument-weather-stale">{t('weather.savedForecast')}</p>}
  </div>;
}

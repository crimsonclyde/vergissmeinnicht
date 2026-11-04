import type { WeatherDay } from '@vergissmeinnicht/domain';
import { formatCalendarDate, formatNumber, t } from '../i18n/index.ts';
import { navigate, paths, Link } from '../router.tsx';
import { MobileActionBar } from '../mobile/MobileActionBar.tsx';
import { UiIcon } from '../ui-icons.tsx';
import { conditionIcon, conditionSky, historyColumns, PROVIDER_NAMES, rainIndication, temperature } from '../weather-view.ts';
import { useForecast, type ShownForecast } from './ForecastProvider.tsx';
import './weather-screen.css';

export function WeatherScreen({ onBack }: { onBack: () => void }) {
  const { data, loading, message } = useForecast();
  return <section className="applet-screen weather-page" aria-labelledby="weather-heading">
    <div className="weather-heading-row">
      <h1 id="weather-heading">{t('weather.heading')}</h1>
      <Link href={paths.account('weather')}>{t('weather.forecastSettings')}</Link>
    </div>
    {data !== null ? <WeatherPage data={data} /> : <p role="status">{loading ? t('common.loading') : message ?? t('weather.noForecast.unavailable')}</p>}
    <MobileActionBar label={t('weather.actions')} actions={[{ id: 'back', icon: 'back', label: t('common.back'), onClick: onBack }]} primary={{ id: 'settings', icon: 'settings', label: t('weather.forecastSettings'), onClick: () => navigate(paths.account('weather')) }} />
  </section>;
}

/** Every reading is text; the icon only adds to it. */
function WeatherPage({ data }: { data: ShownForecast }) {
  const { forecast, unit, history } = data;
  const [today, ...ahead] = forecast.days;
  // "Show tomorrow" hides tomorrow's column; the days after it stay.
  const next = ahead.filter((day, index) => data.showTomorrow || index > 0);
  return <div className="weather-body">
    <WeatherNow data={data} today={today} />
    {today !== undefined && <WeatherHistory today={today.date} history={history} unit={unit} />}
    <WeatherNextDays days={next} unit={unit} />
  </div>;
}

function WeatherNow({ data, today }: { data: ShownForecast; today: WeatherDay | undefined }) {
  const { forecast, unit, location } = data;
  const condition = forecast.current?.condition ?? today?.condition;
  const value = (number: number | undefined, suffix: string) => number === undefined ? t('weather.missing') : `${formatNumber(number, 1)}${suffix}`;
  return <section className="weather-now" data-sky={conditionSky(condition)} aria-labelledby="weather-now-heading">
    <span className="weather-sky" aria-hidden="true" />
    <div className="weather-now-content">
      <p className="weather-place">{location.name} · {today === undefined ? location.timeZone : formatCalendarDate(today.date)}</p>
      <h2 id="weather-now-heading">{forecast.current?.condition === undefined ? t('weather.dailyOutlook') : t('weather.now')}</h2>
      <div className="weather-now-reading">
        <UiIcon name={conditionIcon(condition)} size="3.5rem" />
        <span className="weather-temperature">{temperature(forecast.current?.temperature, unit) ?? t('weather.missing')}</span>
      </div>
      <p className="visually-hidden">{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}</p>
      <p className="weather-minmax">{t('weather.max')} {temperature(today?.max, unit) ?? t('weather.missing')} · {t('weather.min')} {temperature(today?.min, unit) ?? t('weather.missing')}{today?.partial === true && <> · {t('weather.partial')}</>}</p>
      <dl className="weather-readings">
        <div><dt><UiIcon name="weatherDrizzle" />{t('weather.rainProbability')}</dt><dd>{value(today?.precipitationProbabilityMax, '%')}</dd></div>
        <div><dt><UiIcon name="weatherRain" />{t('weather.rain')}</dt><dd>{value(today?.precipitationSum, ' mm')}</dd></div>
        <div><dt><UiIcon name="wind" />{t(forecast.current?.windSpeed === undefined ? 'weather.windMax' : 'weather.windNow')}</dt><dd>{value(forecast.current?.windSpeed ?? today?.windSpeedMax, ' km/h')}</dd></div>
      </dl>
      {data.fellBackFrom !== null && <p className="muted">{t('weather.fellBackFrom', { provider: PROVIDER_NAMES[data.fellBackFrom] })}</p>}
      {data.stale && <p className="weather-stale" role="status">{t('weather.savedForecast')}</p>}
    </div>
  </section>;
}

/** The stored range of each of the last 14 days: one bar per day on the scale of the whole period. */
function WeatherHistory({ today, history, unit }: { today: string; history: ShownForecast['history']; unit: 'C' | 'F' }) {
  const heading = <h2 id="weather-history-heading">{t('weather.history.heading')}</h2>;
  if (history.length === 0) return <section className="weather-history" aria-labelledby="weather-history-heading">{heading}<p className="muted">{t('weather.history.none')}</p></section>;
  const low = Math.min(...history.map((day) => day.min));
  const high = Math.max(...history.map((day) => day.max));
  const span = high - low || 1;
  const place = (degrees: number) => ((degrees - low) / span) * 100;
  return <section className="weather-history" aria-labelledby="weather-history-heading">
    {heading}
    <p className="weather-history-scale muted">{temperature(high, unit) ?? t('weather.missing')} / {temperature(low, unit) ?? t('weather.missing')}</p>
    <ol className="weather-history-days">
      {historyColumns(today, history).map(({ date, range }) => <li key={date} className={date === today ? 'is-today' : undefined}>
        <span className="weather-history-track" aria-hidden="true">
          {range !== null && <span className="weather-history-bar" style={{ bottom: `${place(range.min)}%`, height: `${Math.max(place(range.max) - place(range.min), 6)}%` }} />}
        </span>
        <time dateTime={date} aria-hidden="true">{Number(date.slice(8))}</time>
        <span className="visually-hidden">{range === null
          ? t('weather.history.noReading', { date: formatCalendarDate(date) })
          : t('weather.history.range', { date: formatCalendarDate(date), min: temperature(range.min, unit) ?? t('weather.missing'), max: temperature(range.max, unit) ?? t('weather.missing') })}</span>
      </li>)}
    </ol>
  </section>;
}

function WeatherNextDays({ days, unit }: { days: readonly WeatherDay[]; unit: 'C' | 'F' }) {
  if (days.length === 0) return null;
  return <section className="weather-next" aria-labelledby="weather-next-heading">
    <h2 id="weather-next-heading">{t('weather.nextDays')}</h2>
    <ol className="weather-next-days">
      {days.map((day) => {
        const rain = rainIndication(day);
        return <li key={day.date}>
          <time dateTime={day.date}>{formatCalendarDate(day.date)}</time>
          <UiIcon name={conditionIcon(day.condition)} size="2rem" />
          <span className="visually-hidden">{day.condition === undefined ? t('weather.missing') : t(`weather.condition.${day.condition}`)}</span>
          <span className="weather-next-range">{temperature(day.max, unit) ?? t('weather.missing')} / {temperature(day.min, unit) ?? t('weather.missing')}</span>
          <span className="weather-next-rain">
            <UiIcon name="weatherDrizzle" />
            {rain === null ? t('weather.missing') : rain.kind === 'probability' ? `${rain.value}%` : `${formatNumber(rain.value, 1)} mm`}
            <span className="visually-hidden">{rain?.kind === 'amount' ? t('weather.rain') : t('weather.rainProbability')}</span>
          </span>
        </li>;
      })}
    </ol>
  </section>;
}

import { useEffect, useState, type CSSProperties } from 'react';
import type { WeatherDay, WeatherHour } from '@vergissmeinnicht/domain';
import { formatCalendarDate, formatNumber, formatWallTime, formatWeekdayShort, t, type MessageKey } from '../i18n/index.ts';
import { navigate, paths, Link } from '../router.tsx';
import { MobileActionBar } from '../mobile/MobileActionBar.tsx';
import { UiIcon } from '../ui-icons.tsx';
import {
  dayMoments, historyColumns, historyRuns, hourOf, PROVIDER_NAMES, rainIndication, rainSoon, smoothPath, STRONG_GUSTS_KMH, temperature, uvLevel, uvWindow, wallTimeAt,
} from '../weather-view.ts';
import { WeatherArt } from './InstrumentPicture.tsx';
import { Readings, type Reading } from './Readings.tsx';
import { useForecast, type ShownForecast } from './ForecastProvider.tsx';
import './weather-screen.css';

type Unit = 'C' | 'F';

export function WeatherScreen({ onBack }: { onBack: () => void }) {
  const { data, loading, message } = useForecast();
  return <section className="applet-screen weather-page" aria-labelledby="weather-heading">
    <div className="weather-heading-row">
      <h1 id="weather-heading">{t('weather.heading')}</h1>
      <Link href={paths.account('weather')} className="button quiet icon-button" aria-label={t('weather.forecastSettings')} title={t('weather.forecastSettings')}><UiIcon name="settings" /></Link>
    </div>
    {data !== null ? <WeatherPage data={data} /> : <p role="status">{loading ? t('common.loading') : message ?? t('weather.noForecast.unavailable')}</p>}
    <MobileActionBar label={t('weather.actions')} actions={[{ id: 'back', icon: 'back', label: t('common.back'), onClick: onBack }]} primary={{ id: 'settings', icon: 'settings', label: t('weather.forecastSettings'), onClick: () => navigate(paths.account('weather')) }} />
  </section>;
}

/** The place's wall time, kept current while the page is open (the "now" marker and "rain soon"). */
function useWallTime(timeZone: string): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return wallTimeAt(now, timeZone);
}

/** Every reading is text; pictures and lines only add to it. */
function WeatherPage({ data }: { data: ShownForecast }) {
  const { forecast, unit, history } = data;
  const [today, ...ahead] = forecast.days;
  const wall = useWallTime(data.location.timeZone);
  // "Show tomorrow" hides tomorrow's column; the days after it stay.
  const next = ahead.filter((_day, index) => data.showTomorrow || index > 0);
  // Hours belong to the first forecast day; on a day boundary (an older copy) they are not "today" any more.
  const hours = today !== undefined && wall.startsWith(today.date) ? (forecast.hours ?? []).filter((hour) => hour.time.startsWith(today.date)) : [];
  return <div className="weather-body">
    <WeatherNow data={data} today={today} hours={hours} wall={wall} />
    {today !== undefined && hours.length >= 2 && <WeatherToday today={today} hours={hours} unit={unit} wall={wall} />}
    <WeatherNextDays days={next} unit={unit} />
    {today !== undefined && <WeatherHistory today={today.date} history={history} unit={unit} />}
  </div>;
}


function WeatherNow({ data, today, hours, wall }: { data: ShownForecast; today: WeatherDay | undefined; hours: readonly WeatherHour[]; wall: string }) {
  const { forecast, unit, location } = data;
  const current = forecast.current;
  const condition = current?.condition ?? today?.condition;
  const degrees = temperature(current?.temperature, unit);
  const soon = rainSoon(forecast.quarters, wall);
  return <section className="card weather-now" aria-labelledby="weather-now-heading">
    <WeatherArt condition={condition} className="weather-now-art" />
    <div className="weather-now-content">
      <p className="weather-eyebrow"><span>{location.name}</span> · <span id="weather-now-heading">{current?.condition === undefined ? t('weather.dailyOutlook') : t('weather.now')}</span></p>
      <p className="weather-temperature">{degrees ?? t('weather.missing')}<small>{unit}</small></p>
      <p className="weather-condition">{t(`weather.condition.${condition ?? 'UNKNOWN'}`)}</p>
      <p className="weather-minmax">
        <span><UiIcon name="moveUp" /><span className="visually-hidden">{t('weather.max')} </span>{temperature(today?.max, unit) ?? t('weather.missing')}</span>
        <span><UiIcon name="moveDown" /><span className="visually-hidden">{t('weather.min')} </span>{temperature(today?.min, unit) ?? t('weather.missing')}</span>
        {today?.partial === true && <span className="weather-partial">{t('weather.partial')}</span>}
      </p>
      {soon !== null && <p className="weather-rain-soon" role="status"><UiIcon name="rainSoon" />{soon.kind === 'now' ? t('weather.rainSoon.now') : t('weather.rainSoon.in', { minutes: soon.minutes })}</p>}
      {data.fellBackFrom !== null && <p className="weather-note">{t('weather.fellBackFrom', { provider: PROVIDER_NAMES[data.fellBackFrom] })}</p>}
      {data.stale && <p className="weather-stale" role="status">{t('weather.savedForecast')}</p>}
    </div>
    <Readings readings={facts(data, today, hours)} label={t('weather.details')} />
  </section>;
}

/** The small readings under "now": each an icon and a value; a tap explains it in one line. Missing ones are left out. */
function facts(data: ShownForecast, today: WeatherDay | undefined, hours: readonly WeatherHour[]): Reading[] {
  const { forecast, unit } = data;
  const current = forecast.current;
  const list: Reading[] = [];
  // One rain reading: the chance where there is one (the amount in its explanation), else the amount.
  const amount = today?.precipitationSum === undefined ? null : `${formatNumber(today.precipitationSum, 1)} mm`;
  if (today?.precipitationProbabilityMax !== undefined) list.push({ id: 'chance', icon: 'weatherDrizzle', label: t('weather.rainProbability'), value: `${Math.round(today.precipitationProbabilityMax)}`, unit: '%', info: amount === null ? t('weather.info.chance') : t('weather.info.chanceAmount', { amount }) });
  else if (today?.precipitationSum !== undefined) list.push({ id: 'rain', icon: 'weatherRain', label: t('weather.rain'), value: formatNumber(today.precipitationSum, 1), unit: 'mm', info: t('weather.info.rain') });
  const wind = current?.windSpeed ?? today?.windSpeedMax;
  if (wind !== undefined) list.push({ id: 'wind', icon: 'wind', label: t(current?.windSpeed === undefined ? 'weather.windMax' : 'weather.windNow'), value: formatNumber(wind), unit: 'km/h', info: t(current?.windSpeed === undefined ? 'weather.info.windMax' : 'weather.info.wind') });
  const feels = temperature(current?.apparentTemperature, unit);
  if (feels !== null) list.push({ id: 'feels', icon: 'feelsLike', label: t('weather.feelsLike'), value: feels, info: t('weather.info.feelsLike') });
  const uv = current?.uvIndex ?? today?.uvIndexMax;
  if (uv !== undefined) {
    const window = uvWindow(hours);
    const level = uvLevel(uv);
    list.push({
      id: 'uv', icon: 'uvIndex', label: t('weather.uv'), value: formatNumber(Math.round(uv)), level,
      info: `${t(`weather.uvLevel.${level}` as MessageKey)}. ${window === null ? t('weather.info.uvNone') : t('weather.info.uvWindow', { from: formatWallTime(window.from), to: formatWallTime(window.to) })}`,
    });
  }
  if (today?.sunrise !== undefined && today.sunset !== undefined) list.push({ id: 'sun', icon: 'sunrise', label: t('weather.daylight'), value: formatWallTime(today.sunrise), unit: `– ${formatWallTime(today.sunset)}`, info: daylight(today.sunrise, today.sunset) });
  if (current?.windGusts !== undefined && current.windGusts >= STRONG_GUSTS_KMH) list.push({ id: 'gusts', icon: 'wind', label: t('weather.gusts'), value: formatNumber(current.windGusts), unit: 'km/h', level: 'high', info: t('weather.info.gusts') });
  return list;
}

function daylight(sunrise: string, sunset: string): string {
  const minutes = Math.max(0, Math.round((hourOf(sunset) - hourOf(sunrise)) * 60));
  return t('weather.info.daylight', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Vertical position (0 top – 100 bottom) of a temperature on a scale with a little room above and below. */
function scale(values: readonly number[]): (value: number) => number {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = Math.max(high - low, 4);
  const middle = (high + low) / 2;
  return (value: number) => 100 - ((value - (middle - span / 2)) / span) * 76 - 12;
}

const at = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

/** Today: the temperature through the day as one soft line, night shaded, the four moments painted below. */
function WeatherToday({ today, hours, unit, wall }: { today: WeatherDay; hours: readonly WeatherHour[]; unit: Unit; wall: string }) {
  const known = hours.filter((hour): hour is WeatherHour & { temperature: number } => hour.temperature !== undefined);
  if (known.length < 2) return null;
  const y = scale(known.map((hour) => hour.temperature));
  const points = known.map((hour) => ({ x: (hourOf(hour.time) / 24) * 100, y: y(hour.temperature) }));
  const line = smoothPath(points);
  const first = points[0] as { x: number };
  const last = points.at(-1) as { x: number };
  const nowHour = wall.startsWith(today.date) ? hourOf(wall) : null;
  // The line's height at "now", between the two nearest hours.
  const nowY = nowHour === null ? null : (() => {
    const after = known.findIndex((hour) => hourOf(hour.time) >= nowHour);
    if (after <= 0) return after === 0 ? y((known[0] as { temperature: number }).temperature) : null;
    const [a, b] = [known[after - 1], known[after]] as [{ time: string; temperature: number }, { time: string; temperature: number }];
    const share = (nowHour - hourOf(a.time)) / Math.max(hourOf(b.time) - hourOf(a.time), 0.01);
    return y(a.temperature + (b.temperature - a.temperature) * share);
  })();
  const sunrise = today.sunrise === undefined ? null : (hourOf(today.sunrise) / 24) * 100;
  const sunset = today.sunset === undefined ? null : (hourOf(today.sunset) / 24) * 100;
  const moments = dayMoments(hours);
  const temperatures = known.map((hour) => hour.temperature);
  return <section className="card weather-today" aria-labelledby="weather-today-heading">
    <h2 id="weather-today-heading" className="weather-eyebrow">{t('weather.today')}</h2>
    <div className="weather-chart weather-today-chart" role="img" aria-label={t('weather.today.chart', { min: temperature(Math.min(...temperatures), unit) ?? '', max: temperature(Math.max(...temperatures), unit) ?? '' })}>
      {sunrise !== null && <span className="weather-night" style={{ left: 0, width: `${sunrise}%` }} />}
      {sunset !== null && <span className="weather-night" style={{ left: `${sunset}%`, right: 0 }} />}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        <path className="weather-area" d={`${line} L${last.x} 100 L${first.x} 100 Z`} />
        <path className="weather-line weather-line-day" d={line} />
      </svg>
      {nowHour !== null && nowY !== null && <>
        <span className="weather-now-rule" style={{ left: `${(nowHour / 24) * 100}%` }} />
        <span className="weather-dot weather-dot-now" style={at((nowHour / 24) * 100, nowY)} />
      </>}
      <ol className="weather-hours-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <li key={hour} style={{ left: `${(hour / 24) * 100}%` }}>{hour}</li>)}</ol>
    </div>
    {moments.length > 0 && <ol className="weather-moments">
      {moments.map(({ id, hour }) => <li key={id}>
        <WeatherArt condition={hour.condition} />
        <span className="weather-moment-temperature">{temperature(hour.temperature, unit)}</span>
        {hour.precipitationProbability !== undefined && <span className="weather-moment-rain"><UiIcon name="weatherDrizzle" /><span className="visually-hidden">{t('weather.rainProbability')} </span>{Math.round(hour.precipitationProbability)}%</span>}
        <span className="weather-moment-name">{t(`weather.moment.${id}` as MessageKey)}</span>
        {hour.condition !== undefined && <span className="visually-hidden">{t(`weather.condition.${hour.condition}`)}</span>}
      </li>)}
    </ol>}
  </section>;
}

/** The next days: painted condition per day, highs and lows as two lines with their values on the points. */
function WeatherNextDays({ days, unit }: { days: readonly WeatherDay[]; unit: Unit }) {
  if (days.length === 0) return null;
  const values = days.flatMap((day) => [day.max, day.min].filter((value): value is number => value !== undefined));
  const y = scale(values.length > 0 ? values : [0]);
  const x = (index: number) => ((index + 0.5) / days.length) * 100;
  const line = (pick: (day: WeatherDay) => number | undefined) => days.flatMap((day, index) => { const value = pick(day); return value === undefined ? [] : [{ x: x(index), y: y(value) }]; });
  const highs = line((day) => day.max);
  const lows = line((day) => day.min);
  const polyline = (points: readonly { x: number; y: number }[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  // Days past the chosen model's range (from the Automatic blend) are drawn dashed: the same values, less sure.
  const firstExtended = days.findIndex((day) => day.extended === true);
  const split = (points: readonly { x: number; y: number }[]) => {
    if (firstExtended < 0) return { own: points, extended: [] as { x: number; y: number }[] };
    const edge = x(firstExtended);
    const own = points.filter((point) => point.x < edge);
    return { own, extended: [...own.slice(-1), ...points.filter((point) => point.x >= edge)] };
  };
  const high = split(highs);
  const low = split(lows);
  const columns = { '--weather-days': days.length } as CSSProperties;
  return <section className="card weather-next" aria-labelledby="weather-next-heading" style={columns}>
    <div className="weather-section-head">
      <h2 id="weather-next-heading" className="weather-eyebrow">{t('weather.nextDays')}</h2>
      <p className="weather-legend" aria-hidden="true"><span className="weather-key-high">{t('weather.max')}</span><span className="weather-key-low">{t('weather.min')}</span></p>
    </div>
    <ol className="weather-next-days">
      {days.map((day) => {
        const rain = rainIndication(day);
        const rainText = rain === null ? t('weather.missing') : rain.kind === 'probability' ? `${rain.value}%` : `${formatNumber(rain.value, 1)} mm`;
        return <li key={day.date} className={day.extended === true ? 'is-extended' : undefined}>
          <time dateTime={day.date} title={day.extended === true ? `${formatCalendarDate(day.date)} · ${t('weather.extended')}` : formatCalendarDate(day.date)}>{formatWeekdayShort(day.date)}</time>
          <WeatherArt condition={day.condition} />
          <span className="visually-hidden">{formatCalendarDate(day.date)}: {day.condition === undefined ? t('weather.missing') : t(`weather.condition.${day.condition}`)}, {t('weather.max')} {temperature(day.max, unit) ?? t('weather.missing')}, {t('weather.min')} {temperature(day.min, unit) ?? t('weather.missing')}, {rain?.kind === 'amount' ? t('weather.rain') : t('weather.rainProbability')} {rainText}{day.extended === true ? ` (${t('weather.extended')})` : ''}</span>
        </li>;
      })}
    </ol>
    <div className="weather-chart weather-next-chart" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        {highs.length > 1 && lows.length > 1 && <path className="weather-band" d={`${polyline(highs)} ${polyline([...lows].reverse()).replace(/^M/, 'L')} Z`} />}
        <path className="weather-line weather-line-high" d={polyline(high.own)} />
        <path className="weather-line weather-line-low" d={polyline(low.own)} />
        {high.extended.length > 1 && <path className="weather-line weather-line-high weather-line-extended" d={polyline(high.extended)} />}
        {low.extended.length > 1 && <path className="weather-line weather-line-low weather-line-extended" d={polyline(low.extended)} />}
      </svg>
      {days.map((day, index) => <span key={day.date}>
        {day.max !== undefined && <><span className="weather-dot weather-dot-high" style={at(x(index), y(day.max))} /><span className="weather-value weather-value-high" style={at(x(index), y(day.max))}>{temperature(day.max, unit)}</span></>}
        {day.min !== undefined && <><span className="weather-dot weather-dot-low" style={at(x(index), y(day.min))} /><span className="weather-value weather-value-low" style={at(x(index), y(day.min))}>{temperature(day.min, unit)}</span></>}
      </span>)}
    </div>
    <ol className="weather-next-rain-row" aria-hidden="true">
      {days.map((day) => {
        const rain = rainIndication(day);
        return <li key={day.date} className="weather-next-rain"><UiIcon name="weatherDrizzle" /><span>{rain === null ? t('weather.missing') : rain.kind === 'probability' ? `${rain.value}%` : <>{formatNumber(rain.value, 1)}<small> mm</small></>}</span></li>;
      })}
    </ol>
  </section>;
}

/** The last 14 days: the daily average as a line over the band from low to high; a day without a reading is bridged by a dashed line. */
function WeatherHistory({ today, history, unit }: { today: string; history: ShownForecast['history']; unit: Unit }) {
  const heading = <h2 id="weather-history-heading" className="weather-eyebrow">{t('weather.history.heading')}</h2>;
  if (history.length === 0) return <section className="card weather-history" aria-labelledby="weather-history-heading">{heading}<p className="weather-note">{t('weather.history.none')}</p></section>;
  const columns = historyColumns(today, history);
  const low = Math.min(...history.map((day) => day.min));
  const high = Math.max(...history.map((day) => day.max));
  const y = scale([low, high]);
  const x = (index: number) => ((index + 0.5) / columns.length) * 100;
  const runs = historyRuns(columns);
  const average = (range: { min: number; max: number }) => (range.min + range.max) / 2;
  const path = (points: readonly { x: number; y: number }[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const last = columns.at(-1);
  return <section className="card weather-history" aria-labelledby="weather-history-heading">
    <div className="weather-section-head">
      {heading}
      <p className="weather-legend" aria-hidden="true"><span className="weather-key-average">{t('weather.history.average')}</span><span className="weather-key-band">{t('weather.history.band')}</span></p>
    </div>
    <div className="weather-chart weather-history-chart" aria-hidden="true">
      <span className="weather-scale weather-scale-high" style={{ top: `${y(high)}%` }}>{temperature(high, unit)}</span>
      <span className="weather-scale weather-scale-low" style={{ top: `${y(low)}%` }}>{temperature(low, unit)}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
        {runs.map((run) => {
          const top = run.map(({ index, column }) => ({ x: x(index), y: y((column.range as { max: number }).max) }));
          const bottom = run.map(({ index, column }) => ({ x: x(index), y: y((column.range as { min: number }).min) })).reverse();
          return <path key={`band-${run[0]?.index}`} className="weather-band" d={run.length === 1 ? `M${(top[0]?.x ?? 0) - 1} ${top[0]?.y} L${(top[0]?.x ?? 0) + 1} ${top[0]?.y} L${(top[0]?.x ?? 0) + 1} ${bottom[0]?.y} L${(top[0]?.x ?? 0) - 1} ${bottom[0]?.y} Z` : `${path(top)} ${path(bottom).replace(/^M/, 'L')} Z`} />;
        })}
        {runs.slice(1).map((run, index) => {
          const before = runs[index]?.at(-1);
          const after = run[0];
          if (before === undefined || after === undefined) return null;
          return <path key={`gap-${after.index}`} className="weather-line weather-line-gap" d={`M${x(before.index)} ${y(average(before.column.range as { min: number; max: number }))} L${x(after.index)} ${y(average(after.column.range as { min: number; max: number }))}`} />;
        })}
        {runs.map((run) => <path key={`line-${run[0]?.index}`} className="weather-line weather-line-average" d={path(run.map(({ index, column }) => ({ x: x(index), y: y(average(column.range as { min: number; max: number })) })))} />)}
      </svg>
      {runs.flatMap((run) => run.filter(({ index }) => index === columns.length - 1 || run.length === 1)).map(({ index, column }) => <span key={column.date} className={`weather-dot weather-dot-average${index === columns.length - 1 ? ' is-today' : ''}`} style={at(x(index), y(average(column.range as { min: number; max: number })))} />)}
    </div>
    <ol className="weather-history-days">
      {columns.map(({ date, range }) => <li key={date} className={date === last?.date ? 'is-today' : undefined}>
        <time dateTime={date} aria-hidden="true">{Number(date.slice(8))}</time>
        <span className="visually-hidden">{range === null
          ? t('weather.history.noReading', { date: formatCalendarDate(date) })
          : t('weather.history.range', { date: formatCalendarDate(date), min: temperature(range.min, unit) ?? t('weather.missing'), max: temperature(range.max, unit) ?? t('weather.missing') })}</span>
      </li>)}
    </ol>
  </section>;
}

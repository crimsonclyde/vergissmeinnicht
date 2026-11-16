import type { CSSProperties } from 'react';
import type { GazetteSource, GazetteForecastDay, GazetteLocationForecast, GazetteWarning } from '@vergissmeinnicht/domain';
import { formatCalendarDate, formatDateTime, formatNumber, formatWeekdayShort, t } from '../../i18n/index.ts';
import { UiIcon } from '../../ui-icons.tsx';
import { conditionIcon } from '../../weather-view.ts';

const temperature = (value: number | null) => value === null ? '–' : `${formatNumber(value, 1)}°`;

function rainOf(value: NonNullable<GazetteForecastDay['precipitationMm']>): string {
  return typeof value === 'number'
    ? `${formatNumber(value, 1)}\u00a0mm`
    : `${formatNumber(value.min, 1)}–${formatNumber(value.max, 1)}\u00a0mm`;
}

function chartReadings(days: readonly GazetteForecastDay[]) {
  return days.flatMap(day => [day.high, day.low]).filter(value => value !== null);
}

/** Each day has a fixed slot, and missing readings break the line. */
function TemperatureChart({ days, values }: { days: readonly GazetteForecastDay[]; values: readonly number[] }) {
  const spread = Math.max(...values) - Math.min(...values);
  const step = Math.max(2, Math.ceil(spread / 6) * 2);
  const bottom = Math.floor(Math.min(...values) / step) * step;
  const top = Math.max(bottom + 2 * step, Math.ceil(Math.max(...values) / step) * step);
  const ticks = Array.from({ length: (top - bottom) / step + 1 }, (_, i) => top - i * step);
  const x = (i: number) => 700 * (i + 0.5) / days.length;
  const y = (value: number) => 16 + 68 * (top - value) / (top - bottom);

  return (
    <figure className="gazette-temperature" aria-hidden="true">
      <figcaption>
        <strong>{t('gazette.temperature')}</strong>
        <span className="gazette-chart-high">{t('gazette.high')}</span>
        <span className="gazette-chart-low">{t('gazette.low')}</span>
      </figcaption>
      <div className="gazette-plot">
        <div className="gazette-chart-scale">
          {ticks.map(value => <span key={value} style={{ top: `${y(value)}%` }}>{temperature(value)}</span>)}
        </div>
        <div className="gazette-chart-series">
          <svg viewBox="0 0 700 100" preserveAspectRatio="none" focusable="false">
            {ticks.map(value => <line key={value} className="gazette-chart-grid" x1="0" x2="700" y1={y(value)} y2={y(value)} />)}
            {(['high', 'low'] as const).map(series => (
              <g key={series} className={`gazette-chart-${series}`}>
                {days.map((day, i) => {
                  const value = day[series];
                  const previous = days[i - 1]?.[series];
                  return value === null ? null : (
                    <g key={day.date}>
                      {previous != null && <line x1={x(i - 1)} y1={y(previous)} x2={x(i)} y2={y(value)} />}
                      <path d={`M${x(i)} ${y(value)}h.05`} />
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
          {(['high', 'low'] as const).flatMap(series => days.flatMap((day, i) => {
            const value = day[series];
            return value === null ? [] : [
              <b key={`${day.date}:${series}`} className={`gazette-point gazette-point-${series}`} style={{ left: `${x(i) / 7}%`, top: `${y(value)}%` }}>{temperature(value)}</b>,
            ];
          }))}
        </div>
      </div>
    </figure>
  );
}

export function WeatherNotice({ notice, place }: { notice: GazetteWarning; place?: string }) {
  const info = notice.level === 'info';
  const validity = [notice.onset, notice.expires].flatMap(value => value == null ? [] : [formatDateTime(value)]).join(' – ');
  return (
    <li className={`gazette-notice gazette-notice-${notice.level}`}>
      <UiIcon name={info ? 'info' : 'warning'} size="1.15em" />
      <div>
        {!info && <strong className="gazette-notice-level">{t(`gazette.warningLevel.${notice.level}`)}{place && ` · ${place}`}</strong>}
        <p>{notice.text}</p>
        <div className="gazette-notice-meta">
          {notice.url ? <a href={notice.url} target="_blank" rel="noopener noreferrer">{notice.source}</a> : <span>{notice.source}</span>}
          {validity !== '' ? <span>{validity}</span> : notice.date !== null && <time dateTime={notice.date}>{formatCalendarDate(notice.date)}</time>}
        </div>
      </div>
    </li>
  );
}

/** Every source's own days, side by side: nothing merged out of sight. */
function SourceTable({ location }: { location: GazetteLocationForecast }) {
  const models = location.models ?? [];
  if (models.length < 2) return null;
  return (
    <details className="gazette-weather-details">
      <summary>{t('gazette.compareSources', { count: models.length })}</summary>
      <div className="gazette-compare" role="region" tabIndex={0} aria-label={t('gazette.compareSources', { count: models.length })}>
        <table>
          <caption className="visually-hidden">{t('gazette.compareSources', { count: models.length })}</caption>
          <thead><tr><th scope="col">{t('gazette.source')}</th>{location.days.map(day => <th key={day.date} scope="col">{formatWeekdayShort(day.date)}</th>)}</tr></thead>
          <tbody>
            {models.map(model => (
              <tr key={model.source}>
                <th scope="row">{model.source}<small className="muted">{t('gazette.family', { family: model.family })}</small></th>
                {location.days.map(day => {
                  const own = model.days.find(item => item.date === day.date);
                  return <td key={day.date} className={day.disagreement ? 'gazette-disagree' : undefined}>{own === undefined ? '–' : <>
                    <span>{own.high === null ? '–' : `${formatNumber(own.high, 0)}°`}/{own.low === null ? '–' : `${formatNumber(own.low, 0)}°`}</span>
                    {own.precipitationMm !== null && <small>{formatNumber(own.precipitationMm, 1)} mm</small>}
                    {own.gustKmh !== null && own.gustKmh >= 50 && <small>{t('gazette.gust', { value: formatNumber(own.gustKmh, 0) })}</small>}
                  </>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function GazetteForecast({ location, today }: { location: GazetteLocationForecast; today: string | null }) {
  const bulletins = location.warnings.filter(notice => notice.level === 'info');
  const values = chartReadings(location.days);
  const chart = values.length >= 2 && location.days.length >= 2;
  const lowConfidence = location.days.some(day => day.confidence === 'low');
  const forecastSources = location.sources.filter(source => source.role === undefined || source.role === 'forecast');
  const otherSources = location.sources.filter(source => source.role === 'warnings' || source.role === 'observations');
  const references = location.sources.filter(source => source.role === 'reference');
  const region = [location.region, location.place?.elevation != null ? `${formatNumber(location.place.elevation)} m` : ''].filter(Boolean).join(' · ');
  return (
    <section className="gazette-place" aria-label={location.name}>
      <header className="gazette-place-head">
        <h3>{location.name}</h3>
        {region !== '' && <span className="muted">{region}</span>}
      </header>
      <div className={chart ? 'gazette-outlook gazette-outlook-chart' : 'gazette-outlook'}>
        {chart && <TemperatureChart days={location.days} values={values} />}
        <ol className="plain-list gazette-week" style={{ '--gz-days': location.days.length } as CSSProperties}>
          {location.days.map(day => (
            <li key={day.date} className={day.date === today ? 'gazette-today' : undefined}>
              <ForecastDay day={day} today={today} />
            </li>
          ))}
        </ol>
      </div>
      {lowConfidence && <small className="gazette-confidence muted"><strong className="gazette-lower-confidence">{t('gazette.confidence.low')}</strong><span>{t('gazette.lowConfidenceNote')}</span></small>}
      {location.note !== '' && <p className="gazette-forecast-note"><UiIcon name="info" size="1.1em" /><span>{location.note}</span></p>}
      {bulletins.length > 0 && (
        <details className="gazette-weather-details">
          <summary>{t('gazette.weatherBulletins', { count: bulletins.length })}</summary>
          <ul className="plain-list gazette-notices">{bulletins.map((notice, index) => <WeatherNotice key={index} notice={notice} />)}</ul>
        </details>
      )}
      {location.comparison !== null && (
        <details className="gazette-weather-details">
          <summary>{t(`gazette.compare.${location.comparison.metric}`)}</summary>
          <div className="gazette-compare" role="region" tabIndex={0} aria-label={t(`gazette.compare.${location.comparison.metric}`)}>
            <table aria-label={t(`gazette.compare.${location.comparison.metric}`)}>
              <thead><tr><th scope="col">{t('gazette.forecastSources')}</th>{location.days.map(day => <th key={day.date} scope="col">{formatWeekdayShort(day.date)}</th>)}</tr></thead>
              <tbody>
                {location.comparison.rows.map((row, i) => (
                  <tr key={i}><th scope="row">{row.source}</th>{row.values.map((value, index) => <td key={index} className={location.days[index]?.disagreement ? 'gazette-disagree' : undefined}>{value === null ? '–' : formatNumber(value, 1)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <SourceTable location={location} />
      <footer className="gazette-sources">
        <strong>{t('gazette.forecastSources')}</strong>
        <SourceLinks sources={forecastSources} />
        {otherSources.length > 0 && <span>{t('gazette.warningSources')} <SourceLinks sources={otherSources} /></span>}
        {references.length > 0 && <span>{t('gazette.alsoRead')} <SourceLinks sources={references} /></span>}
        {location.fetchedAt !== null && <span>{t('gazette.fetched', { time: formatDateTime(location.fetchedAt) })}</span>}
      </footer>
    </section>
  );
}

function ForecastDay({ day, today }: { day: GazetteForecastDay; today: string | null }) {
  const chance = day.precipitationProbability != null && day.precipitationProbability >= 20
    ? t('gazette.chance', { value: formatNumber(day.precipitationProbability) })
    : null;
  const rain = day.precipitationMm === null ? null : rainOf(day.precipitationMm);
  const gust = day.gustKmh !== null && day.gustKmh >= 60 ? t('gazette.gust', { value: formatNumber(day.gustKmh) }) : null;
  const lowerConfidence = day.confidence === 'low';
  const expandable = Boolean(day.note || day.disagreement || lowerConfidence || day.highRange || day.lowRange);
  const overview = (
    <>
      <time className={lowerConfidence ? 'gazette-week-day gazette-lower-confidence' : 'gazette-week-day'} dateTime={day.date} aria-current={day.date === today ? 'date' : undefined}>
        {formatWeekdayShort(day.date)} <b>{Number(day.date.slice(-2))}</b>
      </time>
      <span className="gazette-week-condition" title={t(`weather.condition.${day.condition}`)}>
        <UiIcon name={conditionIcon(day.condition)} size="1.65em" />
        <span className="visually-hidden">{t(`weather.condition.${day.condition}`)}</span>
      </span>
      {gust && <span className="gazette-week-gust">{gust}</span>}
      <span className="gazette-week-temps">
        <span className="visually-hidden">{t('gazette.high')} </span><strong>{temperature(day.high)}</strong>
        <span aria-hidden="true"> / </span>
        <span className="visually-hidden">{t('gazette.low')} </span>{temperature(day.low)}
      </span>
      <span className="gazette-rain">
        <span className="visually-hidden">{t('gazette.precipitation')} </span>
        {[chance, rain].filter(Boolean).join(' · ') || '–'}
      </span>
      {expandable && <span className="gazette-day-info">
        <UiIcon name="info" size="1em" />
        <span className="visually-hidden">{[
          day.disagreement && t('gazette.disagree'),
          lowerConfidence && t('gazette.confidence.low'),
        ].filter(Boolean).join(' · ') || t('weather.details')}</span>
      </span>}
    </>
  );

  if (!expandable) return <div className="gazette-day-overview">{overview}</div>;
  return (
    <details className="gazette-day-details">
      <summary className="gazette-day-overview">{overview}</summary>
      <div className="gazette-day-detail">
        {day.disagreement && <strong>{t('gazette.disagree')}</strong>}
        {lowerConfidence && <span>{t('gazette.confidence.low')}</span>}
        {day.highRange && <span>{t('gazette.highRange')} · {temperature(day.highRange.min)}–{temperature(day.highRange.max)}</span>}
        {day.lowRange && <span>{t('gazette.low')} · {temperature(day.lowRange.min)}–{temperature(day.lowRange.max)}</span>}
        {day.note && <span>{day.note}</span>}
      </div>
    </details>
  );
}

function SourceLinks({ sources }: { sources: readonly GazetteSource[] }) {
  return <span>{sources.map(({ name, url }, index) => <span key={index}>{index > 0 && ', '}{url ? <a href={url} target="_blank" rel="noopener noreferrer">{name}</a> : name}</span>)}</span>;
}

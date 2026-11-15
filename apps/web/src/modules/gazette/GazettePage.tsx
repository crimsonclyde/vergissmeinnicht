import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gazettePriceChange, gazetteSignificantDiscount } from '@vergissmeinnicht/domain';
import type { GazetteArticle, GazetteForecastDay, GazetteIcon, GazetteLocationForecast, GazetteSectionDefinition, GazetteTable, GazetteWatchItem } from '@vergissmeinnicht/domain';
import { api, gazetteHeaderUrl, messageFor, type GazetteHeaderImage, type GazetteEditionSummaryView, type GazetteEditionView, type GazetteSectionContent, type GazetteSettings } from '../../api.ts';
import { formatCalendarDate, formatDateTime, formatNumber, formatShortTime, formatWeekdayShort, t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { Link, paths } from '../../router.tsx';
import { addDays } from '../../schedule-dates.ts';
import { UiIcon, type UiIconName } from '../../ui-icons.tsx';
import { conditionIcon } from '../../weather-view.ts';
import { GazetteLandscape, GazetteOrnament } from './GazetteArt.tsx';
import woodlandWide from '../../witch-forest/old-forest-wide.webp';
import woodlandPhone from '../../witch-forest/old-forest-portrait-480.webp';
import './gazette.css';

const SECTION_ICONS: Record<GazetteIcon, UiIconName> = {
  weather: 'weatherPartlyCloudy', chip: 'gazetteChip', map: 'gazetteMap', globe: 'timeZone', leaf: 'gazetteLeaf', tag: 'tag', news: 'gazette', book: 'gazetteBook',
  star: 'star', heart: 'gazetteHeart', home: 'today', flask: 'gazetteFlask', shield: 'gazetteShield', music: 'gazetteMusic', film: 'gazetteFilm', ball: 'gazetteBall', plane: 'plane', coins: 'gazetteCoins',
};
export const gazetteIcon = (icon: GazetteIcon): UiIconName => SECTION_ICONS[icon] ?? 'gazette';

/** Folded sections per person and Workspace on this device; the section's own default otherwise. */
const foldKey = (workspaceId: string) => `vmn.gazette.folded.${workspaceId}`;
function readFolds(workspaceId: string): Record<string, boolean> {
  try { const value = JSON.parse(localStorage.getItem(foldKey(workspaceId)) ?? '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, boolean> : {}; } catch { return {}; }
}
function writeFolds(workspaceId: string, folds: Record<string, boolean>) {
  try { localStorage.setItem(foldKey(workspaceId), JSON.stringify(folds)); } catch { /* private mode: folding still works for this visit */ }
}

/**
 * The full edition (43.2): an illustrated newspaper page built from the Workspace's section definitions.
 * Sections come in the settings' order; each folds, and a folded section renders only its first
 * headline (no pictures, no tables). Unknown renderer types get a quiet note instead of failing.
 */
export function GazettePage({ workspaceId, date, canManage = false }: { workspaceId: string; date: string | null; canManage?: boolean }) {
  const [settings, setSettings] = useState<{ settings: GazetteSettings; today: string; oldest: string } | null>(null);
  const [editions, setEditions] = useState<readonly GazetteEditionSummaryView[] | null>(null);
  const [loaded, setLoaded] = useState<{ readonly date: string; readonly edition: GazetteEditionView | 'missing' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folds, setFolds] = useState<Record<string, boolean>>(() => readFolds(workspaceId));

  useEffect(() => {
    let live = true;
    Promise.all([api.gazetteSettings(workspaceId), api.gazetteEditions(workspaceId)]).then(([loaded, list]) => {
      if (!live) return;
      setSettings(loaded); setEditions(list.editions.filter(item => item.state === 'PUBLISHED'));
    }, (caught: unknown) => { if (live) setError(messageFor(caught)); });
    return () => { live = false; };
  }, [workspaceId]);

  const published = editions ?? [];
  const wanted = date ?? published.find(item => settings === null || item.date <= settings.today)?.date ?? null;
  useEffect(() => {
    if (editions === null || wanted === null) return;
    let live = true;
    api.gazetteEdition(workspaceId, wanted).then(found => { if (live) setLoaded({ date: wanted, edition: found }); }, (caught: unknown) => {
      if (!live) return;
      if ((caught as { code?: string }).code === 'gazette_not_found') setLoaded({ date: wanted, edition: 'missing' }); else setError(messageFor(caught));
    });
    return () => { live = false; };
  }, [workspaceId, wanted, editions]);
  // While another date loads, nothing of the previous edition stays on screen.
  const edition: GazetteEditionView | 'missing' | null = editions === null ? null : wanted === null ? 'missing' : loaded?.date === wanted ? loaded.edition : null;

  const days = useMemo(() => {
    if (settings === null) return [];
    const result: string[] = [];
    for (let day = settings.today; day >= settings.oldest; day = addDays(day, -1)) result.unshift(day);
    return result;
  }, [settings]);

  // Newest day on the right: on a phone the strip starts scrolled to it, not to the oldest day.
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = strip.current; if (element === null) return;
    const current = element.querySelector<HTMLElement>('[aria-current="page"]');
    element.scrollLeft = current === null ? element.scrollWidth : current.offsetLeft + current.offsetWidth - element.clientWidth + 8;
  }, [days, edition]);

  const toggle = (id: string, folded: boolean) => setFolds(current => { const next = { ...current, [id]: !folded }; writeFolds(workspaceId, next); return next; });

  if (error !== null) return <section className="gazette-page"><p role="alert">{error}</p></section>;
  if (settings === null || editions === null) return <section className="gazette-page" aria-busy="true"><p className="muted">{t('common.loading')}</p></section>;

  const definitions = settings.settings.sections;
  const view = edition !== null && edition !== 'missing' ? edition : null;
  const sections = view === null ? [] : definitions.flatMap(definition => {
    const content = view.content.sections.find(section => section.sectionId === definition.id);
    return definition.enabled && content ? [{ definition, content }] : [];
  });
  const isToday = view?.date === settings.today;

  return (
    <article className="gazette-page" aria-labelledby="gazette-title">
      <header className="gazette-masthead">
        <MastheadArtwork workspaceId={workspaceId} header={view?.header ?? null} />
        <span className="gazette-tools">
          <Link href={paths.gazetteWatchlist(workspaceId)} className="icon-button" aria-label={t('gazette.openWatchlist')} title={t('gazette.watchlist')}><UiIcon name="tag" /></Link>
          {canManage && <Link href={paths.gazetteSettings(workspaceId)} className="icon-button" aria-label={t('gazette.settings')} title={t('gazette.settings')}><UiIcon name="settings" /></Link>}
        </span>
        <div className="gazette-meta">
          <span>{view === null ? '' : isToday ? t('gazette.today') : t('gazette.olderEdition')}</span>
          <span>{view === null ? '' : formatCalendarDate(view.date)}</span>
        </div>
        <div className="gazette-rule" />
        <h1 id="gazette-title">{view?.content.title || settings.settings.title}</h1>
        <div className="gazette-rule" />
      </header>

      <nav ref={strip} className="gazette-days" aria-label={t('gazette.archive')}>
        {days.map(day => {
          const has = published.some(item => item.date === day);
          const current = view?.date === day;
          const inner = <><span>{formatWeekdayShort(day)}</span><b>{Number(day.slice(8))}</b></>;
          return has ? (
            <Link key={day} href={paths.gazette(workspaceId, day)} className={current ? 'gazette-day gazette-day-current' : 'gazette-day'} aria-current={current ? 'page' : undefined} aria-label={formatCalendarDate(day)}>{inner}</Link>
          ) : (
            <span key={day} className="gazette-day gazette-day-none" aria-label={t('gazette.noEditionOn', { date: formatCalendarDate(day) })}>{inner}</span>
          );
        })}
      </nav>

      {edition === null && <p className="muted" aria-busy="true">{t('common.loading')}</p>}
      {edition === 'missing' && (
        <div className="card gazette-empty">
          <UiIcon name="gazette" size="2em" />
          <p>{date === null ? t('gazette.firstEdition') : t('gazette.noEditionOn', { date: formatCalendarDate(date) })}</p>
          {date !== null && published[0] !== undefined && <Link className="button" href={paths.gazette(workspaceId, published[0].date)}>{t('gazette.latest')}</Link>}
        </div>
      )}

      {view !== null && (
        <>
          {!isToday && <p className="gazette-chip gazette-chip-warn gazette-older"><UiIcon name="calendar" size="1em" />{t('gazette.olderNote', { date: formatCalendarDate(view.date) })}</p>}
          <div className="gazette-lede">
            {view.content.intro !== '' && <div className="gazette-intro"><Markdown source={view.content.intro} /></div>}
            {sections.length > 1 && (
              <nav className="gazette-contents" aria-label={t('gazette.contents')}>
                {sections.map(({ definition, content }) => (
                  <a key={definition.id} href={`#gazette-${definition.id}`}>
                    <UiIcon name={gazetteIcon(definition.icon)} /><span>{definition.title}</span><small>{countOf(content)}</small>
                  </a>
                ))}
              </nav>
            )}
          </div>
          {sections.map(({ definition, content }) => {
            const folded = folds[definition.id] ?? definition.collapsed;
            return (
              <section key={definition.id} id={`gazette-${definition.id}`} className="gazette-section" aria-labelledby={`gazette-h-${definition.id}`} lang={definition.language}>
                <GazetteOrnament />
                <header className="gazette-section-head">
                  <span className="gazette-section-icon"><UiIcon name={gazetteIcon(definition.icon)} /></span>
                  <div>
                    <h2 id={`gazette-h-${definition.id}`}>{definition.title}</h2>
                    {definition.subtitle !== '' && <p className="muted">{definition.subtitle}</p>}
                  </div>
                  {content.type === 'watchlist' && <Link href={paths.gazetteWatchlist(workspaceId)} className="icon-button" aria-label={t('gazette.openWatchlist')} title={t('gazette.watchlist')}><UiIcon name="tag" /></Link>}
                  <button type="button" className="icon-button gazette-fold" aria-expanded={!folded} aria-controls={`gazette-b-${definition.id}`} aria-label={folded ? t('gazette.unfold', { title: definition.title }) : t('gazette.fold', { title: definition.title })} title={folded ? t('gazette.unfoldShort') : t('gazette.foldShort')} onClick={() => toggle(definition.id, folded)}>
                    <UiIcon name={folded ? 'chevron' : 'expand'} />
                  </button>
                </header>
                <div id={`gazette-b-${definition.id}`}>
                  {folded ? <Folded content={content} onOpen={() => toggle(definition.id, true)} /> : <SectionBody definition={definition} content={content} today={settings.today} images={settings.settings.images} discountThreshold={settings.settings.watchlist?.discountThreshold} workspaceId={workspaceId} canManage={canManage} />}
                </div>
              </section>
            );
          })}
          <footer className="gazette-footer">
            <span>{t('gazette.footerSources')}</span>
            <span>{view.publishedAt !== null && t('gazette.publishedAt', { time: formatDateTime(view.publishedAt) })} · {t('gazette.kept', { count: settings.settings.retentionDays })}</span>
          </footer>
        </>
      )}
    </article>
  );
}

function MastheadArtwork({ workspaceId, header }: { workspaceId: string; header: GazetteHeaderImage | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <>
    <picture className="gazette-masthead-art" aria-hidden="true">
      <source media="(max-width: 540px)" srcSet={woodlandPhone} />
      <img src={woodlandWide} alt="" />
    </picture>
    {header && failed !== header.id && <img className="gazette-masthead-art gazette-custom-art" alt="" src={gazetteHeaderUrl(workspaceId, header.id)} style={{ objectPosition: `${header.x}% ${header.y}%` }} onError={() => setFailed(header.id)} />}
  </>;
}

function countOf(content: GazetteSectionContent): string {
  switch (content.type) {
    case 'articles': return String(content.items.length);
    case 'watchlist': return content.items.length === 0 && content.summary !== '' ? '' : String(content.items.length);
    case 'weather': return content.locations.length === 0 ? '' : t('gazette.places', { count: content.locations.length });
    default: return '';
  }
}

function Folded({ content, onOpen }: { content: GazetteSectionContent; onOpen: () => void }) {
  const first = content.type === 'articles' ? content.items[0]?.title : content.type === 'watchlist' ? content.items[0]?.name : content.type === 'weather' ? content.locations.map(l => l.name).join(' · ') : content.summary;
  const more = content.type === 'articles' || content.type === 'watchlist' ? content.items.length - 1 : 0;
  return (
    <button type="button" className="gazette-folded" onClick={onOpen}>
      <span className="gazette-folded-title">{first || t(content.summary ? 'gazette.readSummary' : 'gazette.emptySection')}</span>
      {more > 0 && <span className="muted">{t('gazette.more', { count: more })}</span>}
    </button>
  );
}

/** Renderer registry: one component per section type; anything else gets a quiet note. */
function SectionBody({ definition, content, today, images, discountThreshold, workspaceId, canManage }: { definition: GazetteSectionDefinition; content: GazetteSectionContent; today: string; images: boolean; discountThreshold: number | undefined; workspaceId: string; canManage: boolean }): ReactNode {
  const summary = content.summary !== '' ? <div className="gazette-summary"><Markdown source={content.summary} /></div> : null;
  switch (content.type) {
    case 'articles': return <>{summary}<Articles items={content.items} lead={images && definition.dashboard} /></>;
    case 'weather': return <>{summary}{content.status === 'no_location' || content.status === 'unavailable' ? <WeatherMissing status={content.status} workspaceId={workspaceId} canManage={canManage} /> : <div className="gazette-weather">{content.locations.map(location => <Forecast key={location.name} location={location} today={today} />)}</div>}</>;
    case 'watchlist': return <>{content.summary !== '' && <div className="gazette-summary gazette-watch-summary"><Markdown source={content.summary} /></div>}{content.items.length > 0 ? <Watchlist items={content.items} threshold={discountThreshold} /> : summary === null && <p className="muted">{t('gazette.emptySection')}</p>}</>;
    case 'rich': return <>{summary}<div className="gazette-rich"><Markdown source={content.body} />{content.tables.map((table, index) => <Table key={index} table={table} />)}</div></>;
    default: return <p className="muted">{t('gazette.unsupported')}</p>;
  }
}

function Articles({ items, lead }: { items: readonly GazetteArticle[]; lead: boolean }) {
  if (items.length === 0) return <p className="muted">{t('gazette.emptySection')}</p>;
  return (
    <div className="gazette-articles">
      {items.map((item, index) => (
        <article key={item.id} className={lead && index === 0 && items.length > 2 ? 'gazette-article gazette-article-lead' : 'gazette-article'} lang={item.language ?? undefined}>
          {lead && index === 0 && items.length > 2 && <div className="gazette-article-art" aria-hidden="true"><GazetteLandscape className="gazette-art" /></div>}
          <div className="gazette-article-text">
            <h3>{item.title}</h3>
            {item.summary !== '' && <div className="gazette-article-summary"><Markdown source={item.summary} /></div>}
            {item.security !== null && (
              <dl className={`gazette-security gazette-security-${item.security.verification}`}>
                <dt>{t('gazette.securityId')}</dt><dd>{item.security.advisoryUrl ? <a href={item.security.advisoryUrl} rel="noopener noreferrer" target="_blank">{item.security.identifier}</a> : item.security.identifier}</dd>
                {item.security.package !== '' && <><dt>{t('gazette.securityPackage')}</dt><dd>{item.security.package}</dd></>}
                <dt>{t('gazette.securitySeverity')}</dt><dd>{t(`gazette.severity.${item.security.severity}`)}</dd>
                <dt>VMN</dt><dd className="gazette-security-verdict"><UiIcon name={item.security.verification === 'affected' ? 'warning' : 'gazetteShield'} size="1em" />{t(`gazette.verification.${item.security.verification}`)}</dd>
                {item.security.relevance !== '' && <dd className="gazette-security-note">{item.security.relevance}</dd>}
              </dl>
            )}
            <p className="gazette-byline">
              <span>{item.source}</span><span aria-hidden="true">·</span><time dateTime={item.publishedAt}>{formatShortTime(item.publishedAt)}</time>
              <a className="icon-button gazette-open" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={t('gazette.openOriginal', { source: item.source })} title={t('gazette.openOriginalShort')}><UiIcon name="openOriginal" /></a>
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

const rainOf = (day: GazetteForecastDay): string => day.precipitationMm === null ? '' : typeof day.precipitationMm === 'number' ? `${formatNumber(day.precipitationMm, 1)} mm` : `${formatNumber(day.precipitationMm.min, 1)}–${formatNumber(day.precipitationMm.max, 1)} mm`;

/** High and low as two line graphs (owner: line graphs only), scaled to the week. */
function TemperatureLines({ days }: { days: readonly GazetteForecastDay[] }) {
  const values = days.flatMap(day => [day.high, day.low]).filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const x = (index: number) => ((index + 0.5) / days.length) * 700;
  const y = (value: number) => 10 + (1 - (value - min) / span) * 50;
  const line = (pick: (day: GazetteForecastDay) => number | null) => days.flatMap((day, index) => { const value = pick(day); return value === null ? [] : [`${x(index).toFixed(1)},${y(value).toFixed(1)}`]; }).join(' ');
  return (
    <svg className="gazette-lines" viewBox="0 0 700 70" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <polyline className="gazette-line-high" points={line(day => day.high)} />
      <polyline className="gazette-line-low" points={line(day => day.low)} />
    </svg>
  );
}

const range = (value: { min: number; max: number }, unit: string) => `${formatNumber(value.min)}–${formatNumber(value.max)}${unit}`;
const timeSpan = (onset: string | null | undefined, expires: string | null | undefined) =>
  [onset ? formatDateTime(onset) : '', expires ? formatDateTime(expires) : ''].filter(Boolean).join(' – ');

/** Official warnings first and loud; a confirmed "no alert" is a quiet line, never hidden. */
function Warnings({ warnings }: { warnings: GazetteLocationForecast['warnings'] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="plain-list gazette-warnings" aria-label={t('gazette.warnings')}>
      {warnings.map((warning, index) => (
        <li key={index} className={`gazette-warning gazette-warning-${warning.level}`}>
          <UiIcon name={warning.level === 'info' ? 'info' : 'warning'} size="1.1em" />
          <span>
            <b>{warning.level === 'info' ? '' : `${t(`gazette.warningLevel.${warning.level}`)} · `}{warning.date !== null && `${formatWeekdayShort(warning.date)}: `}{warning.text}</b>
            <small className="muted">{warning.url ? <a href={warning.url} target="_blank" rel="noopener noreferrer">{warning.source}</a> : warning.source}{timeSpan(warning.onset, warning.expires) !== '' && ` · ${timeSpan(warning.onset, warning.expires)}`}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Every source's own days, side by side: nothing merged out of sight. */
function SourceTable({ location }: { location: GazetteLocationForecast }) {
  const models = location.models ?? [];
  if (models.length < 2) return null;
  return (
    <details className="gazette-compare">
      <summary><UiIcon name="grid" size="1em" />{t('gazette.compareSources', { count: models.length })}</summary>
      <div className="gazette-compare-scroll">
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

function Forecast({ location, today }: { location: GazetteLocationForecast; today: string }) {
  const notes = location.days.filter(day => day.note);
  const lowConfidence = location.days.some(day => day.confidence === 'low');
  const forecastSources = location.sources.filter(source => source.role === undefined || source.role === 'forecast');
  const otherSources = location.sources.filter(source => source.role === 'warnings' || source.role === 'observations');
  const references = location.sources.filter(source => source.role === 'reference');
  return (
    <section className="card gazette-place" aria-label={location.name}>
      <header className="gazette-place-head">
        <h3>{location.name}</h3>
        {(location.region !== '' || location.place?.elevation != null) && <small className="muted">{[location.region, location.place?.elevation != null ? `${formatNumber(location.place.elevation)} m` : ''].filter(Boolean).join(' · ')}</small>}
        {location.models === undefined && location.warnings.map((warning, index) => (
          <span key={index} className={`gazette-chip gazette-chip-${warning.level === 'info' ? 'plain' : 'warn'} gazette-warning-${warning.level}`} title={warning.source}>
            <UiIcon name="warning" size="1em" />{warning.date !== null && `${formatWeekdayShort(warning.date)}: `}{warning.text}
          </span>
        ))}
      </header>
      {location.models !== undefined && <Warnings warnings={location.warnings} />}
      <TemperatureLines days={location.days} />
      <ol className="plain-list gazette-week" style={{ gridTemplateColumns: `repeat(${location.days.length}, minmax(0, 1fr))` }}>
        {location.days.map(day => (
          <li key={day.date} className={[day.disagreement ? 'gazette-disagree' : '', day.date === today ? 'gazette-today' : '', day.confidence === 'low' ? 'gazette-low-confidence' : ''].filter(Boolean).join(' ') || undefined} title={[day.disagreement ? t('gazette.disagree') : '', day.confidence ? t(`gazette.confidence.${day.confidence}`) : ''].filter(Boolean).join(' · ') || undefined}>
            <span className="gazette-week-day">{formatWeekdayShort(day.date)}</span>
            <UiIcon name={conditionIcon(day.condition)} size="1.3em" />
            <span className="visually-hidden">{t(`weather.condition.${day.condition}`)}{day.confidence ? `, ${t(`gazette.confidence.${day.confidence}`)}` : ''}</span>
            <b>{day.high === null ? '–' : `${formatNumber(day.high)}°`}</b>
            <span className="muted">{day.low === null ? '' : `${formatNumber(day.low)}°`}</span>
            {day.highRange && <small className="gazette-range" title={t('gazette.highRange')}>{range(day.highRange, '°')}</small>}
            {rainOf(day) !== '' && <small className="gazette-rain">{rainOf(day)}</small>}
            {day.precipitationProbability != null && day.precipitationProbability >= 20 && <small className="gazette-chance">{t('gazette.chance', { value: formatNumber(day.precipitationProbability) })}</small>}
            {day.gustKmh !== null && day.gustKmh >= 60 && <small className="gazette-gust"><UiIcon name="wind" size="1em" />{formatNumber(day.gustKmh)}</small>}
          </li>
        ))}
      </ol>
      {(notes.length > 0 || lowConfidence) && (
        <ul className="plain-list gazette-day-notes">
          {notes.map(day => <li key={day.date}><b>{formatWeekdayShort(day.date)}:</b> {day.note}</li>)}
          {lowConfidence && <li className="muted"><UiIcon name="info" size="1em" />{t('gazette.lowConfidenceNote')}</li>}
        </ul>
      )}
      {location.comparison !== null && (
        <div className="gazette-compare">
          <table>
            <caption className="visually-hidden">{t(`gazette.compare.${location.comparison.metric}`)}</caption>
            <thead><tr><th scope="col">{t(`gazette.compare.${location.comparison.metric}`)}</th>{location.days.map(day => <th key={day.date} scope="col">{formatWeekdayShort(day.date)}</th>)}</tr></thead>
            <tbody>
              {location.comparison.rows.map(row => (
                <tr key={row.source}><th scope="row">{row.source}</th>{row.values.map((value, index) => <td key={index} className={location.days[index]?.disagreement ? 'gazette-disagree' : undefined}>{value === null ? '–' : formatNumber(value, 1)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceTable location={location} />
      <p className="gazette-sources"><UiIcon name="info" size="1em" />
        <span>{forecastSources.map((source, index) => <span key={source.name}>{index > 0 && ', '}{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</span>)}
          {otherSources.length > 0 && <> · {t('gazette.warningSources')} {otherSources.map((source, index) => <span key={source.name}>{index > 0 && ', '}{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</span>)}</>}
          {location.fetchedAt !== null && ` · ${t('gazette.fetched', { time: formatDateTime(location.fetchedAt) })}`}{location.note !== '' && ` · ${location.note}`}
          {references.length > 0 && <> · {t('gazette.alsoRead')} {references.map((source, index) => <span key={source.name}>{index > 0 && ', '}{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</span>)}</>}</span>
      </p>
    </section>
  );
}

/** A weather section VMN could not fill: says why, never shows an empty week. */
function WeatherMissing({ status, workspaceId, canManage }: { status: 'no_location' | 'unavailable'; workspaceId: string; canManage: boolean }) {
  return (
    <div className="card gazette-empty gazette-weather-missing">
      <UiIcon name={status === 'no_location' ? 'place' : 'weatherUnknown'} size="2em" />
      <p>{t(status === 'no_location' ? 'gazette.weatherNoLocation' : 'gazette.weatherUnavailable')}</p>
      {status === 'no_location' && canManage && <Link className="button" href={paths.members(workspaceId)}><UiIcon name="place" /><span>{t('gazette.setLocation')}</span></Link>}
    </div>
  );
}

const money = (value: number | null, currency: string) => value === null ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);

const watchColumns = ['gazette.watchProduct', 'gazette.watchTypical', 'gazette.currentPrice', 'gazette.priceChange', 'gazette.seller'] as const;

function Watchlist({ items, threshold }: { items: readonly GazetteWatchItem[]; threshold: number | undefined }) {
  return (
    <table className="gazette-edition-watch" role="table">
      <caption className="visually-hidden">{t('gazette.watchlist')}</caption>
      <thead role="rowgroup"><tr role="row">{watchColumns.map(column => <th key={column} scope="col" role="columnheader">{t(column)}</th>)}</tr></thead>
      <tbody role="rowgroup">
        {items.map(item => {
          const change = gazettePriceChange(item);
          const significant = gazetteSignificantDiscount(item, threshold);
          const details = [item.variant, t(`gazette.condition.${item.condition}`), item.market].filter(Boolean).join(' · ');
          return (
            <tr key={item.id} role="row">
              <th scope="row" role="rowheader">
                {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}
                <small className="muted">{details}</small>
              </th>
              {[
                money(item.typical, item.currency),
                item.verified && item.price !== null ? money(item.price, item.currency) : <>{t('gazette.notChecked')}{item.price !== null && item.checkedAt !== null && <small className="muted">{t('gazette.previousOffer', { price: money(item.price, item.currency), date: formatCalendarDate(item.checkedAt.slice(0, 10)) })}</small>}</>,
                change === null ? '–' : Math.abs(change) < 2 ? t('gazette.change.same') : significant ? <span className="gazette-chip gazette-chip-good">{t('gazette.significantDiscount', { change: formatNumber(-change, 1) })}</span> : `${change > 0 ? '+' : '−'}${formatNumber(Math.abs(change), 1)}%`,
                item.shop || '–',
              ].map((cell, index) => <td key={watchColumns[index + 1]} role="cell"><span aria-hidden="true" className="gazette-watch-label">{t(watchColumns[index + 1] ?? 'gazette.watchProduct')}</span><span>{cell}</span></td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Table({ table }: { table: GazetteTable }) {
  return (
    <div className="gazette-table">
      <table>
        {table.caption !== '' && <caption>{table.caption}</caption>}
        <thead><tr>{table.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
        <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

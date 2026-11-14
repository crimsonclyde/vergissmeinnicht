import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GazetteArticle, GazetteForecastDay, GazetteIcon, GazetteLocationForecast, GazetteSectionDefinition, GazetteTable, GazetteWatchItem } from '@vergissmeinnicht/domain';
import { api, messageFor, type GazetteEditionSummaryView, type GazetteEditionView, type GazetteSectionContent, type GazetteSettings } from '../../api.ts';
import { formatCalendarDate, formatDateTime, formatNumber, formatShortTime, formatWeekdayShort, t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { Link, paths } from '../../router.tsx';
import { addDays } from '../../schedule-dates.ts';
import { UiIcon, type UiIconName } from '../../ui-icons.tsx';
import { conditionIcon } from '../../weather-view.ts';
import { GazetteLandscape, GazetteOrnament } from './GazetteArt.tsx';
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
      <div className="gazette-cover"><GazetteLandscape className="gazette-art" /></div>
      <header className="gazette-masthead">
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
                  {folded ? <Folded content={content} onOpen={() => toggle(definition.id, true)} /> : <SectionBody definition={definition} content={content} today={settings.today} images={settings.settings.images} />}
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

function countOf(content: GazetteSectionContent): string {
  switch (content.type) {
    case 'articles': return String(content.items.length);
    case 'watchlist': return String(content.items.length);
    case 'weather': return t('gazette.places', { count: content.locations.length });
    default: return '';
  }
}

function Folded({ content, onOpen }: { content: GazetteSectionContent; onOpen: () => void }) {
  const first = content.type === 'articles' ? content.items[0]?.title : content.type === 'watchlist' ? content.items[0]?.name : content.type === 'weather' ? content.locations.map(l => l.name).join(' · ') : content.summary;
  const more = content.type === 'articles' || content.type === 'watchlist' ? content.items.length - 1 : 0;
  return (
    <button type="button" className="gazette-folded" onClick={onOpen}>
      <span className="gazette-folded-title">{first || t('gazette.emptySection')}</span>
      {more > 0 && <span className="muted">{t('gazette.more', { count: more })}</span>}
    </button>
  );
}

/** Renderer registry: one component per section type; anything else gets a quiet note. */
function SectionBody({ definition, content, today, images }: { definition: GazetteSectionDefinition; content: GazetteSectionContent; today: string; images: boolean }): ReactNode {
  const summary = content.summary !== '' ? <div className="gazette-summary"><Markdown source={content.summary} /></div> : null;
  switch (content.type) {
    case 'articles': return <>{summary}<Articles items={content.items} lead={images && definition.dashboard} /></>;
    case 'weather': return <>{summary}<div className="gazette-weather">{content.locations.map(location => <Forecast key={location.name} location={location} today={today} />)}</div></>;
    case 'watchlist': return <>{summary}<Watchlist items={content.items} /></>;
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

function Forecast({ location, today }: { location: GazetteLocationForecast; today: string }) {
  return (
    <section className="card gazette-place" aria-label={location.name}>
      <header className="gazette-place-head">
        <h3>{location.name}</h3>{location.region !== '' && <small className="muted">{location.region}</small>}
        {location.warnings.map((warning, index) => (
          <span key={index} className={`gazette-chip gazette-chip-${warning.level === 'info' ? 'plain' : 'warn'} gazette-warning-${warning.level}`} title={warning.source}>
            <UiIcon name="warning" size="1em" />{warning.date !== null && `${formatWeekdayShort(warning.date)}: `}{warning.text}
          </span>
        ))}
      </header>
      <TemperatureLines days={location.days} />
      <ol className="plain-list gazette-week" style={{ gridTemplateColumns: `repeat(${location.days.length}, minmax(0, 1fr))` }}>
        {location.days.map(day => (
          <li key={day.date} className={[day.disagreement ? 'gazette-disagree' : '', day.date === today ? 'gazette-today' : ''].filter(Boolean).join(' ') || undefined} title={day.disagreement ? t('gazette.disagree') : undefined}>
            <span className="gazette-week-day">{formatWeekdayShort(day.date)}</span>
            <UiIcon name={conditionIcon(day.condition)} size="1.3em" />
            <span className="visually-hidden">{t(`weather.condition.${day.condition}`)}</span>
            <b>{day.high === null ? '–' : `${formatNumber(day.high)}°`}</b>
            <span className="muted">{day.low === null ? '' : `${formatNumber(day.low)}°`}</span>
            {rainOf(day) !== '' && <small className="gazette-rain">{rainOf(day)}</small>}
          </li>
        ))}
      </ol>
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
      <p className="gazette-sources"><UiIcon name="info" size="1em" />
        <span>{location.sources.map((source, index) => <span key={source.name}>{index > 0 && ', '}{source.url ? <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</span>)}
          {location.fetchedAt !== null && ` · ${t('gazette.fetched', { time: formatShortTime(location.fetchedAt) })}`}{location.note !== '' && ` · ${location.note}`}</span>
      </p>
    </section>
  );
}

const money = (value: number | null, currency: string) => value === null ? '–' : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: value % 1 === 0 ? 0 : 2 }).format(value);

function Spark({ values, change }: { values: readonly number[]; change: GazetteWatchItem['change'] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 90).toFixed(1)},${(4 + (1 - (value - min) / span) * 18).toFixed(1)}`).join(' ');
  return <svg className={`gazette-spark gazette-spark-${change}`} viewBox="0 0 90 26" aria-hidden="true" focusable="false"><polyline points={points} /></svg>;
}

function Watchlist({ items }: { items: readonly GazetteWatchItem[] }) {
  if (items.length === 0) return <p className="muted">{t('gazette.emptySection')}</p>;
  return (
    <ul className="plain-list gazette-watch">
      {items.map(item => (
        <li key={item.id} className="card gazette-watch-item">
          <span className="gazette-watch-thumb" aria-hidden="true"><UiIcon name="tag" /></span>
          <span className="gazette-watch-name">
            <b>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a> : item.name}</b>
            <small className="muted">{[item.variant, t(`gazette.condition.${item.condition}`), item.market, item.shop].filter(Boolean).join(' · ')}</small>
          </span>
          <Spark values={item.history} change={item.change} />
          <span className="gazette-watch-price">
            <b className={item.verified ? undefined : 'muted'}>{money(item.price, item.currency)}</b>
            <small className="muted">{t('gazette.usual', { price: money(item.typical, item.currency) })}{item.target !== null && ` · ${t('gazette.target', { price: money(item.target, item.currency) })}`}</small>
          </span>
          <span className="gazette-watch-state">
            {!item.verified ? <span className="gazette-chip gazette-chip-warn">{item.checkedAt === null ? t('gazette.unverified') : t('gazette.lastVerified', { date: formatCalendarDate(item.checkedAt.slice(0, 10)) })}</span>
              : item.target !== null && item.price !== null && item.price <= item.target ? <span className="gazette-chip gazette-chip-good"><UiIcon name="moveDown" size="1em" />{t('gazette.belowTarget')}</span>
              : <span className={`gazette-chip gazette-change-${item.change}`}>{t(`gazette.change.${item.change}`)}</span>}
          </span>
        </li>
      ))}
    </ul>
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

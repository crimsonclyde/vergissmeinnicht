import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { gazettePriceChange, gazetteSignificantDiscount } from '@vergissmeinnicht/domain';
import type { GazetteArticle, GazetteIcon, GazetteTable, GazetteWatchItem } from '@vergissmeinnicht/domain';
import { api, messageFor, type GazetteEditionSummaryView, type GazetteEditionView, type GazetteSectionContent, type GazetteSettings } from '../../api.ts';
import { formatCalendarDate, formatDateTime, formatNumber, formatShortTime, formatWeekdayShort, t } from '../../i18n/index.ts';
import { Markdown } from '../../markdown/Markdown.tsx';
import { Link, paths, useFragment } from '../../router.tsx';
import { addDays } from '../../schedule-dates.ts';
import { UiIcon, type UiIconName } from '../../ui-icons.tsx';
import { GazetteOrnament } from './GazetteArt.tsx';
import { GazetteMastheadArtwork } from './GazetteMastheadArtwork.tsx';
import { GazetteNewsflash } from './GazetteNewsflash.tsx';
import { GazetteForecast, WeatherNotice } from './GazetteForecast.tsx';
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

  // `#weather` (the weather in the top bar or on the Dashboard): open the edition at its weather section,
  // unfolded for this visit (the person's saved fold stays as it was), once the edition has loaded.
  const fragment = useFragment();
  const [refolded, setRefolded] = useState<number | null>(null);
  const loadedEdition = edition !== null && edition !== 'missing' ? edition : null;
  const weatherSection = fragment.hash === '#weather' && settings !== null && loadedEdition !== null
    ? settings.settings.sections.find(definition => definition.enabled && loadedEdition.content.sections.some(section => section.sectionId === definition.id && section.type === 'weather'))?.id ?? null
    : null;
  const opened = refolded === fragment.visit ? null : weatherSection;
  useEffect(() => {
    if (weatherSection === null) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`gazette-${weatherSection}`);
      if (target === null) return;
      target.scrollIntoView({ block: 'start' });
      target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [weatherSection, fragment.visit]);

  const toggle = (id: string, folded: boolean) => { if (opened === id) setRefolded(fragment.visit); setFolds(current => { const next = { ...current, [id]: !folded }; writeFolds(workspaceId, next); return next; }); };

  if (error !== null) return <section className="gazette-page"><p role="alert">{error}</p></section>;
  if (settings === null || editions === null) return <section className="gazette-page" aria-busy="true"><p className="muted">{t('common.loading')}</p></section>;

  const definitions = settings.settings.sections;
  const view = edition !== null && edition !== 'missing' ? edition : null;
  const sections = view === null ? [] : definitions.flatMap(definition => {
    const content = view.content.sections.find(section => section.sectionId === definition.id);
    return definition.enabled && content ? [{ definition, content }] : [];
  });
  const weatherWarnings = sections.flatMap(({ content }) => content.type === 'weather'
    ? content.locations.flatMap(location => location.warnings
      .filter(notice => notice.level !== 'info')
      .map(notice => ({ notice, place: location.name })))
    : []);
  const localNotices = view?.content.localNotices ?? [];
  const alertCount = weatherWarnings.length + localNotices.length;
  const isToday = view?.date === settings.today;
  const coverDate = view?.date ?? wanted ?? settings.today;
  const masthead = settings.settings.title;

  return (
    <article className="gazette-page" aria-labelledby="gazette-title">
      <header className="gazette-masthead">
        <GazetteMastheadArtwork workspaceId={workspaceId} header={view?.header ?? null} date={coverDate} />
        <span className="gazette-tools">
          <Link href={paths.gazetteWatchlist(workspaceId)} className="icon-button" aria-label={t('gazette.openWatchlist')} title={t('gazette.watchlist')}><UiIcon name="tag" /></Link>
          {canManage && <Link href={paths.gazetteSettings(workspaceId)} className="icon-button" aria-label={t('gazette.settings')} title={t('gazette.settings')}><UiIcon name="settings" /></Link>}
        </span>
        <div className="gazette-meta">
          <span>{view === null ? '' : isToday ? t('gazette.today') : t('gazette.olderEdition')}</span>
          <time dateTime={coverDate}>{formatCalendarDate(coverDate)}</time>
        </div>
        <div className="gazette-rule" />
        <h1 id="gazette-title">{masthead}</h1>
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
            <GazetteNewsflash masthead={masthead} title={view.content.title} intro={view.content.intro} />
            {sections.length + Number(alertCount > 0) > 1 && (
              <nav className="gazette-contents" aria-label={t('gazette.contents')}>
                {alertCount > 0 && (
                  <a href="#edition-local-alerts">
                    <UiIcon name="warning" /><span>{t('gazette.localAlerts')}</span><small>{alertCount}</small>
                  </a>
                )}
                {sections.map(({ definition, content }) => (
                  <a key={definition.id} href={`#gazette-${definition.id}`}>
                    <UiIcon name={gazetteIcon(definition.icon)} /><span>{definition.title}</span><small>{countOf(content)}</small>
                  </a>
                ))}
              </nav>
            )}
          </div>
          {alertCount > 0 && (
            <section id="edition-local-alerts" className="gazette-section" aria-labelledby="gazette-local-alerts-heading">
              <GazetteOrnament />
              <header className="gazette-section-head">
                <span className="gazette-section-icon"><UiIcon name="warning" /></span>
                <div>
                  <h2 id="gazette-local-alerts-heading">{t('gazette.localAlerts')}</h2>
                  <p className="muted">{t('gazette.localAlertsEdition')}</p>
                </div>
              </header>
              <ul className="plain-list gazette-notices">
                {weatherWarnings.map(({ notice, place }, index) => <WeatherNotice key={`weather-${index}`} notice={notice} place={place} />)}
                {localNotices.map(({ kind, place, text, source, url, checkedAt }, index) => (
                  <li key={`local-${index}`} className="gazette-notice">
                    <UiIcon name={kind === 'road_closure' ? 'gazetteMap' : 'warning'} size="1.15em" />
                    <div>
                      <strong className="gazette-notice-level">{kind === 'road_closure' ? t('gazette.roadClosure') : t('gazette.civilAlert')} · {place}</strong>
                      <p>{text}</p>
                      <div className="gazette-notice-meta">
                        <a href={url} target="_blank" rel="noopener noreferrer">{source}</a>
                        <time dateTime={checkedAt}>{t('gazette.noticeChecked', { time: formatDateTime(checkedAt) })}</time>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sections.map(({ definition, content }) => {
            const folded = opened === definition.id ? false : folds[definition.id] ?? definition.collapsed;
            return (
              <section key={definition.id} id={`gazette-${definition.id}`} className="gazette-section" aria-labelledby={`gazette-h-${definition.id}`} lang={definition.language}>
                <GazetteOrnament />
                <header className="gazette-section-head">
                  <span className="gazette-section-icon"><UiIcon name={gazetteIcon(definition.icon)} /></span>
                  <div>
                    <h2 id={`gazette-h-${definition.id}`} tabIndex={-1}>{definition.title}</h2>
                    {definition.subtitle !== '' && <p className="muted">{definition.subtitle}</p>}
                  </div>
                  {content.type === 'watchlist' && <Link href={paths.gazetteWatchlist(workspaceId)} className="icon-button" aria-label={t('gazette.openWatchlist')} title={t('gazette.watchlist')}><UiIcon name="tag" /></Link>}
                  <button type="button" className="icon-button gazette-fold" aria-expanded={!folded} aria-controls={`gazette-b-${definition.id}`} aria-label={folded ? t('gazette.unfold', { title: definition.title }) : t('gazette.fold', { title: definition.title })} title={folded ? t('gazette.unfoldShort') : t('gazette.foldShort')} onClick={() => toggle(definition.id, folded)}>
                    <UiIcon name={folded ? 'chevron' : 'expand'} />
                  </button>
                </header>
                <div id={`gazette-b-${definition.id}`}>
                  {folded ? <Folded content={content} onOpen={() => toggle(definition.id, true)} /> : <SectionBody content={content} today={isToday ? settings.today : null} discountThreshold={settings.settings.watchlist?.discountThreshold} workspaceId={workspaceId} canManage={canManage} />}
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
function SectionBody({ content, today, discountThreshold, workspaceId, canManage }: { content: GazetteSectionContent; today: string | null; discountThreshold: number | undefined; workspaceId: string; canManage: boolean }): ReactNode {
  const summary = content.summary !== '' ? <div className="gazette-summary"><Markdown source={content.summary} /></div> : null;
  switch (content.type) {
    case 'articles': return <>{summary}<Articles items={content.items} /></>;
    case 'weather': return <>{summary}{content.status === 'no_location' || content.status === 'unavailable' ? <WeatherMissing status={content.status} workspaceId={workspaceId} canManage={canManage} /> : <div className="gazette-weather">{content.locations.map(location => <GazetteForecast key={location.name} location={location} today={today} />)}</div>}</>;
    case 'watchlist': return <>{content.summary !== '' && <div className="gazette-summary gazette-watch-summary"><Markdown source={content.summary} /></div>}{content.items.length > 0 ? <Watchlist items={content.items} threshold={discountThreshold} /> : summary === null && <p className="muted">{t('gazette.emptySection')}</p>}</>;
    case 'rich': return <>{summary}<div className="gazette-rich"><Markdown source={content.body} />{content.tables.map((table, index) => <Table key={index} table={table} />)}</div></>;
    default: return <p className="muted">{t('gazette.unsupported')}</p>;
  }
}

function Articles({ items }: { items: readonly GazetteArticle[] }) {
  if (items.length === 0) return <p className="muted">{t('gazette.emptySection')}</p>;
  return (
    <div className="gazette-articles">
      {items.map(item => (
        <article key={item.id} className="gazette-article" lang={item.language ?? undefined}>
          <div className="gazette-article-text">
            <h3><a className="gazette-story-link" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a></h3>
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
              <span className="gazette-story-icon"><UiIcon name="openOriginal" /></span>
            </p>
          </div>
        </article>
      ))}
    </div>
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

import type { CSSProperties, ReactNode } from 'react';
import { attachmentUrl, type JournalOverview, type JournalView } from '../../api.ts';
import { formatCalendarDate, formatMonthParts, formatWeekdayShort, t, weekdayNames } from '../../i18n/index.ts';
import { MoreMenu } from '../../MoreMenu.tsx';
import { Link, paths } from '../../router.tsx';
import { UiIcon } from '../../ui-icons.tsx';
import { localDate, monthGrid, notebookTone, onThisDay, summaryOf, writingStreak } from './journal-view.ts';

export type JournalLayout = 'timeline' | 'cards' | 'list';
export type JournalSort = 'updated' | 'date' | 'title';
export interface JournalFilters {
  readonly search: string;
  readonly collection: string | undefined;
  readonly tag: string | undefined;
  readonly sort: JournalSort;
  readonly archived: boolean;
  readonly month: string;
}

const tone = (name: string) => ({ '--nb-tone': notebookTone(name) }) as CSSProperties;
const ATTACHMENT = /^attachments\/([0-9a-f-]{36})\.(?:jpg|png)$/;

/** The Notes library and the Journal's month timeline: header, filter bar, cards or timeline. */
export function JournalHome(props: {
  workspaceId: string | undefined;
  canWrite: boolean;
  busy: boolean;
  entries: JournalView[] | null;
  overview: JournalOverview | null;
  more: boolean;
  offset: number;
  layout: JournalLayout;
  filters: JournalFilters;
  notice: ReactNode;
  onLayout: (layout: JournalLayout) => void;
  onFilters: (change: Partial<JournalFilters>) => void;
  onPage: (offset: number) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onToday: () => void;
  onImport: () => void;
}) {
  const { workspaceId, filters, overview, entries, layout } = props;
  const personal = workspaceId === undefined;
  const timeline = personal && layout === 'timeline';
  const today = localDate();
  const exportBase = `/api${workspaceId ? '/workspaces/' + encodeURIComponent(workspaceId) + '/journal' : '/account/journal'}/export`;
  const download = (href: string) => { const link = document.createElement('a'); link.href = href; link.download = ''; document.body.append(link); link.click(); link.remove(); };
  const month = formatMonthParts(filters.month);
  const filtering = filters.search !== '' || filters.collection !== undefined || filters.tag !== undefined || filters.archived;

  const views: JournalLayout[] = personal ? ['timeline', 'cards', 'list'] : ['cards', 'list'];
  const viewIcon = { timeline: 'calendar', cards: 'grid', list: 'listView' } as const;
  const viewLabel = { timeline: 'journal.viewTimeline', cards: 'journal.viewCards', list: 'journal.viewList' } as const;
  const actions = <div className="nb-head-actions">
    <div className="nb-segmented" role="group" aria-label={t('journal.view')}>
      {views.map(view => <button key={view} type="button" aria-pressed={layout === view} aria-label={t(viewLabel[view])} title={t(viewLabel[view])} onClick={() => props.onLayout(view)}><UiIcon name={viewIcon[view]} /></button>)}
    </div>
    {!personal && <Link className="button nb-round" href={paths.account('journal')} aria-label={t('journal.privateLink')} title={t('journal.privateLink')}><UiIcon name="lock" /></Link>}
    <MoreMenu label={t('journal.moreActions')} items={[
      ...(props.canWrite ? [{ label: t('journal.import'), onSelect: props.onImport }] : []),
      { label: t('journal.exportAll'), onSelect: () => download(`${exportBase}?${new URLSearchParams({ q: filters.search, archived: String(filters.archived) })}`) },
      { label: t('journal.exportArchive'), onSelect: () => download(`${exportBase}?all=true`) },
    ]} />
    {props.canWrite && personal && <button type="button" className="nb-round" disabled={props.busy} aria-label={t('journal.new')} title={t('journal.new')} onClick={props.onNew}><UiIcon name="add" /></button>}
    {props.canWrite && (personal
      ? <button type="button" className="primary" disabled={props.busy} onClick={props.onToday}><UiIcon name="edit" /><span className="nb-primary-label">{t('journal.todayPage')}</span></button>
      : <button type="button" className="primary" disabled={props.busy} aria-label={t('journal.new')} onClick={props.onNew}><UiIcon name="add" /><span className="nb-primary-label">{t('journal.newNote')}</span></button>)}
  </div>;

  return <>
    <header className="nb-head">
      <div className="nb-title">
        <p className="nb-eyebrow">{personal ? <><UiIcon name="lock" />{t('journal.eyebrowPrivate')}</> : t('journal.eyebrowShared')}</p>
        {timeline
          ? <h1 className="nb-heading" aria-live="polite">{month.month} <span className="nb-heading-muted">{month.year}</span></h1>
          : <h1 className="nb-heading">{t(personal ? 'journal.privateHeading' : 'journal.heading')} {overview !== null && <span className="nb-heading-muted">{overview.total}</span>}</h1>}
      </div>
      {timeline && <div className="nb-paging">
        <button type="button" className="nb-round" aria-label={t('journal.previousMonth')} title={t('journal.previousMonth')} onClick={() => props.onFilters({ month: shiftMonth(filters.month, -1) })}><UiIcon name="previous" /></button>
        <button type="button" className="nb-round" aria-label={t('journal.nextMonth')} title={t('journal.nextMonth')} onClick={() => props.onFilters({ month: shiftMonth(filters.month, 1) })}><UiIcon name="chevron" /></button>
        <button type="button" className="nb-round" disabled={filters.month === today.slice(0, 7)} onClick={() => props.onFilters({ month: today.slice(0, 7) })}><UiIcon name="todayDot" />{t('calendar.today')}</button>
      </div>}
      {actions}
    </header>
    <p className="nb-hint">{t(personal ? 'journal.privateHint' : 'journal.sharedHint')}</p>
    {props.notice}
    {timeline
      ? <JournalTimeline {...props} today={today} />
      : <>
        <FilterBar filters={filters} overview={overview} onFilters={props.onFilters} />
        {entries === null ? <p role="status">{t('journal.loading')}</p>
          : entries.length === 0 ? <div className="nb-empty"><UiIcon name="notebook" /><p>{t(filtering ? 'journal.emptyFiltered' : 'journal.empty')}</p>{filtering && <button type="button" onClick={() => props.onFilters({ search: '', collection: undefined, tag: undefined, archived: false })}>{t('journal.clearFilters')}</button>}</div>
          : <EntryGroups entries={entries} layout={layout === 'list' ? 'list' : 'cards'} grouped={filters.sort === 'updated' && !filters.archived} workspaceId={workspaceId} busy={props.busy} onOpen={props.onOpen} />}
        {(props.offset > 0 || props.more) && <div className="nb-pages">
          <button type="button" className="nb-round" disabled={props.offset === 0} aria-label={t('journal.previous')} title={t('journal.previous')} onClick={() => props.onPage(Math.max(0, props.offset - 30))}><UiIcon name="previous" /></button>
          <button type="button" className="nb-round" disabled={!props.more} aria-label={t('journal.more')} title={t('journal.more')} onClick={() => props.onPage(props.offset + 30)}><UiIcon name="chevron" /></button>
        </div>}
      </>}
  </>;
}

export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, index - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}

function FilterBar({ filters, overview, onFilters }: { filters: JournalFilters; overview: JournalOverview | null; onFilters: (change: Partial<JournalFilters>) => void }) {
  const collections = overview?.collections ?? [];
  const tags = (overview?.tags ?? []).slice(0, 12);
  return <section className="nb-filters" aria-label={t('journal.filters')}>
    <div className="nb-filter-row">
      <label className="nb-search"><UiIcon name="search" /><span className="visually-hidden">{t('journal.search')}</span>
        <input type="search" maxLength={120} value={filters.search} placeholder={t('journal.searchPlaceholder')} onChange={event => onFilters({ search: event.target.value })} />
      </label>
      <label className="nb-sort"><UiIcon name="sort" /><span className="visually-hidden">{t('journal.sort')}</span>
        <select value={filters.sort} onChange={event => onFilters({ sort: event.target.value as JournalSort })}>
          <option value="updated">{t('journal.sort.updated')}</option>
          <option value="date">{t('journal.sort.date')}</option>
          <option value="title">{t('journal.sort.title')}</option>
        </select>
      </label>
      <button type="button" className="icon-button nb-tool" aria-pressed={filters.archived} aria-label={t('journal.archived')} title={t('journal.archived')} onClick={() => onFilters({ archived: !filters.archived })}><UiIcon name="archive" /></button>
    </div>
    {(collections.length > 0 || tags.length > 0) && <div className="nb-chips" role="group" aria-label={t('journal.notebooks')}>
      <button type="button" className="nb-chip" aria-pressed={filters.collection === undefined && filters.tag === undefined} onClick={() => onFilters({ collection: undefined, tag: undefined })}>{t('journal.allNotebooks')}</button>
      {collections.map(item => <button key={'c' + item.name} type="button" className="nb-chip" style={tone(item.name)} aria-pressed={filters.collection === item.name} onClick={() => onFilters({ collection: filters.collection === item.name ? undefined : item.name })}>
        <span className="nb-swatch" aria-hidden="true" />{item.name === '' ? t('journal.noNotebook') : item.name}<span className="nb-chip-count">{item.count}</span>
      </button>)}
      {tags.length > 0 && <span className="nb-divider" aria-hidden="true" />}
      {tags.map(item => <button key={'t' + item.name} type="button" className="nb-chip nb-chip-tag" aria-pressed={filters.tag === item.name} aria-label={t('journal.tagFilter', { tag: item.name })} onClick={() => onFilters({ tag: filters.tag === item.name ? undefined : item.name })}>#{item.name}</button>)}
    </div>}
  </section>;
}

function EntryGroups({ entries, layout, grouped, workspaceId, busy, onOpen }: { entries: JournalView[]; layout: 'cards' | 'list'; grouped: boolean; workspaceId: string | undefined; busy: boolean; onOpen: (id: string) => void }) {
  const pinned = grouped ? entries.filter(entry => entry.pinned) : [];
  const rest = grouped ? entries.filter(entry => !entry.pinned) : entries;
  const list = (items: JournalView[]) => <ul className={layout === 'list' ? 'nb-list' : 'nb-grid'}>{items.map(entry => <li key={entry.id}><EntryCard entry={entry} workspaceId={workspaceId} busy={busy} onOpen={onOpen} /></li>)}</ul>;
  return <>
    {pinned.length > 0 && <><h2 className="nb-group"><UiIcon name="pinned" />{t('journal.pinnedGroup')}</h2>{list(pinned)}</>}
    {pinned.length > 0 && rest.length > 0 && <h2 className="nb-group">{t('journal.otherGroup')}</h2>}
    {rest.length > 0 && list(rest)}
  </>;
}

export function EntryCard({ entry, workspaceId, busy, onOpen, hideDate = false }: { entry: JournalView; workspaceId: string | undefined; busy: boolean; onOpen: (id: string) => void; hideDate?: boolean }) {
  const summary = summaryOf(entry);
  const cover = summary.cover === null ? null : ATTACHMENT.exec(summary.cover)?.[1] ?? null;
  const notebook = entry.collection ?? '';
  return <button type="button" className="nb-card" style={tone(notebook)} data-cover={cover !== null} disabled={busy} onClick={() => onOpen(entry.id)}>
    {cover !== null && <span className="nb-cover"><img src={attachmentUrl(workspaceId, cover)} alt="" loading="lazy" /></span>}
    {entry.pinned && <span className="nb-pin-mark" title={t('journal.pinnedGroup')}><UiIcon name="pinned" /><span className="visually-hidden">{t('journal.pinnedGroup')}</span></span>}
    <span className="nb-card-body">
      {notebook !== '' && <span className="nb-label"><span className="nb-swatch" aria-hidden="true" />{notebook}</span>}
      <span className="nb-card-title">{entry.title}</span>
      {summary.excerpt !== '' && <span className="nb-excerpt">{summary.excerpt}</span>}
      {summary.tasks.total > 0 && <span className="nb-progress" aria-hidden="true"><span style={{ width: `${Math.round(100 * summary.tasks.done / summary.tasks.total)}%` }} /></span>}
      <span className="nb-meta">
        {summary.tasks.total > 0 && <span className="nb-tasks" data-complete={summary.tasks.done === summary.tasks.total}><UiIcon name="checklist" />{t('journal.tasks', { done: summary.tasks.done, total: summary.tasks.total })}</span>}
        {!hideDate && entry.date && <time dateTime={entry.date}>{formatCalendarDate(entry.date)}</time>}
        {(entry.tags ?? []).slice(0, 3).map(tag => <span key={tag} className="nb-tag">#{tag}</span>)}
      </span>
    </span>
  </button>;
}

function JournalTimeline(props: Parameters<typeof JournalHome>[0] & { today: string }) {
  const { filters, overview, entries, today } = props;
  const dated = overview?.dated ?? [];
  const byDay = new Map<string, { id: string }[]>();
  for (const entry of dated) byDay.set(entry.date, [...(byDay.get(entry.date) ?? []), entry]);
  const memories = onThisDay(dated, today).slice(0, 3);
  const streak = writingStreak(dated.map(entry => entry.date), today);
  const thisMonth = dated.filter(entry => entry.date.startsWith(filters.month)).length;
  const names = weekdayNames('short');
  const showToday = props.canWrite && filters.month === today.slice(0, 7) && !byDay.has(today);
  return <div className="nb-journal">
    <aside className="nb-aside" aria-label={t('journal.monthOverview')}>
      <section className="nb-panel">
        <table className="nb-month" aria-label={formatMonthParts(filters.month).month}>
          <thead><tr>{names.map((name, index) => <th key={name} scope="col" {...(index >= 5 ? { 'data-weekend': '' } : {})}>{name.slice(0, 2)}</th>)}</tr></thead>
          <tbody>{monthGrid(filters.month).map((week, row) => <tr key={row}>{week.map((day, column) => {
            if (day === null) return <td key={column} />;
            const pages = byDay.get(day);
            const number = Number(day.slice(8));
            const current = day === today ? { 'aria-current': 'date' as const } : {};
            return <td key={column}>{pages
              ? <button type="button" className="nb-month-day" data-written="true" {...current} aria-label={t('journal.openDay', { date: formatCalendarDate(day), count: pages.length })} onClick={() => props.onOpen(pages[0]?.id ?? '')}>{number}</button>
              : <span className="nb-month-day" {...current}>{number}</span>}</td>;
          })}</tr>)}</tbody>
        </table>
        <p className="nb-streak"><span>{t('journal.pagesThisMonth', { count: thisMonth })}</span>{streak > 1 && <span>{t('journal.streak', { count: streak })}</span>}</p>
      </section>
      {memories.length > 0 && <section className="nb-memory">
        <h2 className="nb-panel-title">{t('journal.onThisDay')}</h2>
        {memories.map(memory => <button key={memory.id} type="button" onClick={() => props.onOpen(memory.id)}><span>{memory.title}<small className="muted"> · {memory.date.slice(0, 4)}</small></span></button>)}
      </section>}
    </aside>
    <section aria-label={t('journal.timeline')}>
      {entries === null ? <p role="status">{t('journal.loading')}</p> : <ol className="nb-timeline">
        {showToday && <li className="nb-entry" data-today="true">
          <span className="nb-entry-day"><b>{Number(today.slice(8))}</b><small>{formatWeekdayShort(today)}</small></span>
          <button type="button" className="nb-write-today" disabled={props.busy} onClick={props.onToday}><UiIcon name="edit" /><span className="nb-write-words">{t('journal.writeToday')}<small>{t('journal.writeTodayHint')}</small></span></button>
        </li>}
        {entries.map(entry => <li key={entry.id} className="nb-entry" data-today={entry.date === today}>
          {entry.date ? <span className="nb-entry-day"><b>{Number(entry.date.slice(8))}</b><small>{formatWeekdayShort(entry.date)}</small></span> : <span className="nb-entry-day" />}
          <EntryCard entry={entry} workspaceId={props.workspaceId} busy={props.busy} onOpen={props.onOpen} hideDate />
        </li>)}
        {entries.length === 0 && !showToday && <li className="nb-empty"><UiIcon name="notebook" /><p>{t('journal.emptyMonth')}</p></li>}
      </ol>}
      {props.more && <div className="nb-pages"><button type="button" className="nb-round" aria-label={t('journal.more')} title={t('journal.more')} onClick={() => props.onPage(props.offset + 30)}><UiIcon name="chevron" /></button></div>}
    </section>
  </div>;
}

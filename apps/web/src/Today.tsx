import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClockCard } from './TodayClock.tsx';
import { WeatherCard, useMyForecast } from './TodayWeather.tsx';
import { ProgressCard, RecentCard } from './TodayProgress.tsx';
import { AddChooser, type CanAdd } from './AddChooser.tsx';
import { api, isNetworkError, messageFor, type HomeOverview, type ListSummary, type MaintenanceDueSoonItem, type Occurrence, type PersonRef, type RunSummary } from './api.ts';
import { formatCalendarDate, formatRelativeDay, t } from './i18n/index.ts';
import { ActiveRunItem, OccurrenceItem, groupOverdue, when } from './Occurrences.tsx';
import { useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { Link, paths } from './router.tsx';
import { summaryOf } from './Runs.tsx';
import { browserTimeZone, todayIn } from './schedule-dates.ts';
import { ATTENTION_ROWS, agenda, nextUp, recentSince, todayCards, type TodayCardId, type TodayCardSetting } from './today-cards.ts';
import { useTodaySettings } from './today-settings.ts';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

/** Other members' changes appear without reloading: Today refreshes this often while it is visible. */
const REFRESH_MS = 30_000;
const FILTER_KEY = 'vmn.homeFilter';
type Filter = 'ALL' | 'MINE' | 'SHARED';

function storedFilter(): Filter {
  try {
    const value = window.localStorage.getItem(FILTER_KEY);
    return value === 'MINE' || value === 'SHARED' ? value : 'ALL';
  } catch {
    return 'ALL';
  }
}

/** What Today puts in front of the person, in this order — everything else has its own tool. */
export interface TodayView {
  /** Unfinished Runs: Occurrences in progress and active Runs that belong to no Occurrence. */
  readonly continueOccurrences: readonly Occurrence[];
  readonly continueRuns: readonly RunSummary[];
  readonly overdue: readonly Occurrence[];
  readonly today: readonly Occurrence[];
  /** Open future Occurrences (not shown here; the count links to the Calendar). */
  readonly upcomingCount: number;
}

/** Pure selection of what Today shows from the Workspace overview (kept apart for tests). */
export function todayView(home: Pick<HomeOverview, 'overdue' | 'today' | 'upcoming' | 'later' | 'active'>, shown: (item: Occurrence) => boolean = () => true): TodayView {
  const inProgress = (item: Occurrence) => item.state === 'IN_PROGRESS';
  const due = [...home.overdue, ...home.today];
  const upcomingOpen = home.upcoming.filter((item) => !inProgress(item));
  return {
    // Also one that was started early: an unfinished Run comes first, whenever it is due.
    continueOccurrences: [...due, ...home.upcoming].filter(inProgress).filter(shown),
    continueRuns: home.active,
    overdue: home.overdue.filter((item) => !inProgress(item)).filter(shown),
    today: home.today.filter((item) => !inProgress(item)).filter(shown),
    upcomingCount: upcomingOpen.length + home.later,
  };
}

/**
 * One Today card (19.1): a title of a word or two with an icon, a count where it has one, a few rows
 * and at most one way on. A card with nothing to show is never rendered — callers check first.
 */
function TodayCard(props: { id: TodayCardId; icon: UiIconName; title: string; count?: number; attention?: boolean; footer?: ReactNode; children: ReactNode }) {
  const heading = `today-card-${props.id}`;
  return (
    <section aria-labelledby={heading} className={props.attention === true ? 'card today-card today-card-attention' : 'card today-card'} data-card={props.id}>
      <h3 id={heading} className="today-card-title">
        <UiIcon name={props.icon} />
        <span>{props.title}</span>
        {props.count !== undefined && (
          <span className={props.attention === true ? 'badge badge-overdue' : 'badge'}>
            <span aria-hidden="true">{props.count}</span>
            <span className="visually-hidden">{t('today.count', { count: props.count })}</span>
          </span>
        )}
      </h3>
      <ul className="plain-list today-rows" aria-labelledby={heading}>
        {props.children}
      </ul>
      {props.footer !== undefined && <div className="today-card-footer">{props.footer}</div>}
    </section>
  );
}

/** A quiet row that is one link: title, and one line of context. */
function LinkRow(props: { href: string; title: string; context: ReactNode; label?: string }) {
  return (
    <li>
      <Link href={props.href} className="today-row" aria-label={props.label}>
        <span className="today-row-title">{props.title}</span>
        <small className="muted">{props.context}</small>
        <UiIcon name="forward" />
      </Link>
    </li>
  );
}

/**
 * Today (15.1, as cards since 19.1): what needs the person now, as a few compact cards — Needs attention,
 * Continue, Next up, To buy, Maintenance due soon, Recently completed. A card appears only when it is on,
 * its tool is on in the Workspace and it has something to show; on a quiet day Today is one calm line.
 * The Add button creates a Procedure, a Reminder or a grocery list.
 */
export function Today(props: {
  workspaceId: string;
  userId: string;
  canStart: boolean;
  canSchedule: boolean;
  canExecute: boolean;
  canAdd: CanAdd;
  tools: readonly string[];
  canChooseTools: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const { workspaceId } = props;
  const { userId, reportReachable, reportUnreachable } = useOffline();
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [lists, setLists] = useState<readonly ListSummary[]>([]);
  const [maintenance, setMaintenance] = useState<{ items: readonly MaintenanceDueSoonItem[]; total: number } | null>(null);
  const [offlineActive, setOfflineActive] = useState<readonly RunSummary[] | null>(null);
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(storedFilter);
  const [notice, setNotice] = useState<Undoable | null>(null);
  const { settings, loaded } = useTodaySettings(userId);
  const cards = todayCards(props.tools, settings);
  // Plain values for the loader: which cards need data, and the Recently completed window.
  const shownIds = useMemo(() => todayCards(props.tools, settings).map((setting) => setting.card.id).join(' '), [props.tools, settings]);
  const retention = useMemo(() => settings.cards.find((setting) => setting.card.id === 'recent')?.retention ?? 'DAYS_3', [settings]);

  const weather = useMyForecast(userId, loaded && shownIds.split(' ').includes('weather'));

  const load = useCallback(() => {
    // Until the person's layout is known nothing is asked for twice.
    if (!loaded) return;
    api.home(workspaceId, filter, recentSince(retention) ?? undefined).then(
      (loaded) => {
        setHome(loaded);
        setOfflineActive(null);
        setMessage(null);
        reportReachable();
      },
      async (caught: unknown) => {
        if (!isNetworkError(caught)) {
          setMessage(messageFor(caught));
          return;
        }
        // Offline: the active executions saved on this device (8.5).
        reportUnreachable();
        const saved = await offlineStore.listRuns(userId, workspaceId);
        setOfflineActive(saved.map((entry) => summaryOf(entry.run)));
      },
    );
    // The other cards are extras: without them (offline, error) the rest still shows. A card that is not
    // shown — its tool off, or switched off by the person — is never asked for (and never rendered).
    const shown = shownIds.split(' ');
    if (shown.includes('toBuy')) api.lists(workspaceId).then(setLists, () => undefined);
    if (shown.includes('maintenance')) api.maintenanceDueSoon(workspaceId, todayIn(browserTimeZone())).then(setMaintenance, () => undefined);
  }, [workspaceId, userId, reportReachable, reportUnreachable, shownIds, retention, loaded, filter]);
  useEffect(load, [load]);
  // Changes by other members arrive without a reload: refresh while visible, and when coming back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!props.canSchedule) return;
    api.members(workspaceId).then(
      (list) => setMembers(list.map((member) => ({ id: member.userId, name: member.displayName }))),
      () => setMembers(null),
    );
  }, [workspaceId, props.canSchedule]);

  const chooseFilter = (next: Filter) => {
    setFilter(next);
    try {
      window.localStorage.setItem(FILTER_KEY, next);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const can = { canStart: props.canStart, canSchedule: props.canSchedule, canExecute: props.canExecute };
  const assigned = props.tools.includes('PROCEDURES') || props.tools.includes('REMINDERS');
  const shown = (item: Occurrence) => filter === 'ALL' || (filter === 'MINE' ? item.responsible?.id === props.userId : item.responsible === null);
  const view = home === null ? null : todayView(home, shown);
  const continueRuns = view?.continueRuns ?? offlineActive ?? [];
  const attention = [...groupOverdue(view?.overdue ?? []), ...(view?.today ?? []).map((item) => ({ item, older: [] as Occurrence[] }))];
  const upcoming = home === null ? [] : nextUp(home.upcoming.filter(shown));
  const listsToBuy = lists.filter((list) => list.open > 0);
  const recent = home?.progress?.recentlyCompleted ?? [];
  const continuing = (view?.continueOccurrences.length ?? 0) + continueRuns.length;
  const calm = view !== null && continuing + attention.length === 0;
  const localToday = todayIn(browserTimeZone());
  const allDue = props.tools.includes('REMINDERS') ? paths.reminders(workspaceId) : props.tools.includes('CALENDAR') ? paths.calendar(workspaceId) : null;

  const undoComplete = (item: Occurrence) =>
    setNotice({
      message: t('home.completedNotice', { title: item.schedule.title }),
      undo: () =>
        void api.reopenOccurrence(workspaceId, item.id).then(load, (caught: unknown) => {
          setMessage(messageFor(caught));
          load();
        }),
    });
  const row = (item: Occurrence, older: readonly Occurrence[] = []) => (
    <OccurrenceItem key={item.id} workspaceId={workspaceId} item={item} older={older} can={can} members={members} onOpenRun={props.onOpenRun} onChanged={load} onCompleted={undoComplete} />
  );
  const more = (hidden: number, href: string | null) =>
    hidden > 0 && href !== null ? (
      <Link href={href} className="today-more">
        {t('today.more', { count: hidden })} <UiIcon name="forward" />
      </Link>
    ) : undefined;

  const render = (setting: TodayCardSetting): ReactNode => {
    const { card } = setting;
    switch (card.id) {
      case 'attention':
        if (calm)
          return (
            <p key="calm" className="card calm today-calm">
              <UiIcon name="check" size="1.4em" /> {t('home.nothingNeedsAttention')}
            </p>
          );
        if (attention.length === 0) return null;
        return (
          <TodayCard key={card.id} id={card.id} icon="warning" title={t('today.needsAttention')} count={attention.length} attention footer={more(attention.length - ATTENTION_ROWS, allDue)}>
            {attention.slice(0, ATTENTION_ROWS).map(({ item, older }) => row(item, older))}
          </TodayCard>
        );
      case 'continue':
        if (continuing === 0) return null;
        return (
          <TodayCard key={card.id} id={card.id} icon="procedures" title={t('today.continue')} count={continuing}>
            {view?.continueOccurrences.map((item) => row(item))}
            {continueRuns.map((run) => (
              <ActiveRunItem key={run.id} workspaceId={workspaceId} run={run} />
            ))}
          </TodayCard>
        );
      case 'next':
        if (upcoming.length === 0) return null;
        return (
          <TodayCard
            key={card.id}
            id={card.id}
            icon="calendar"
            title={t('today.nextUp')}
            footer={props.tools.includes('CALENDAR') ? <Link href={paths.calendar(workspaceId)} className="today-more">{t('today.calendarLink')} <UiIcon name="forward" /></Link> : undefined}
          >
            {upcoming.map((item) => (
              <li key={item.id} className="today-row today-row-static">
                <span className="today-row-title">{item.schedule.title}</span>
                <small className="muted">
                  <time dateTime={item.dueDate} title={when(item)}>
                    {formatRelativeDay(item.dueDate, todayIn(item.schedule.timeZone))}
                    {item.time !== null && `, ${item.time}`}
                  </time>
                </small>
              </li>
            ))}
          </TodayCard>
        );
      case 'toBuy':
        if (listsToBuy.length === 0) return null;
        return (
          <TodayCard key={card.id} id={card.id} icon="grocery" title={t('today.lists')} footer={more(listsToBuy.length - setting.lists, paths.lists(workspaceId))}>
            {listsToBuy.slice(0, setting.lists).map((list) => (
              <LinkRow key={list.id} href={paths.list(workspaceId, list.id)} title={list.title} context={t('lists.toBuy', { count: list.open })} label={t('lists.openNamed', { title: list.title })} />
            ))}
          </TodayCard>
        );
      case 'maintenance':
        if (maintenance === null || maintenance.items.length === 0) return null;
        return (
          <TodayCard key={card.id} id={card.id} icon="maintenance" title={t('today.maintenance')} count={maintenance.total} footer={more(maintenance.total - maintenance.items.length, paths.maintenance(workspaceId))}>
            {maintenance.items.map((item) => (
              <LinkRow
                key={item.id}
                href={paths.maintenanceRecord(workspaceId, item.id)}
                title={item.title}
                context={[
                  item.date < localToday ? t('home.wasDue', { date: formatCalendarDate(item.date) }) : formatRelativeDay(item.date, localToday),
                  ...(item.status === 'IN_PROGRESS' ? [t('maintenance.status.IN_PROGRESS')] : []),
                  ...(item.equipment === null ? [] : [item.equipment]),
                ].join(' · ')}
              />
            ))}
          </TodayCard>
        );
      case 'recent':
        return recent.length === 0 || setting.retention === 'OFF' ? null : <RecentCard key={card.id} workspaceId={workspaceId} items={recent} />;
      case 'progress':
        return home?.progress === undefined ? null : <ProgressCard key={card.id} progress={home.progress} />;
      case 'clock':
        return <ClockCard key={card.id} hour24={setting.hour24} />;
      case 'weather':
        return weather === null ? null : <WeatherCard key={card.id} data={weather} />;
      case 'calendar': {
        const dates = home === null ? [] : agenda(home.upcoming.filter(shown));
        if (dates.length === 0) return null;
        return (
          <TodayCard key={card.id} id={card.id} icon="calendar" title={t('today.calendar')} footer={<Link href={paths.calendar(workspaceId)} className="today-more">{t('today.calendarLink')} <UiIcon name="forward" /></Link>}>
            {dates.map((item) => (
              <li key={item.id} className="today-row today-row-static">
                <span className="today-row-title">{item.schedule.title}</span>
                <small className="muted">
                  <time dateTime={item.dueDate}>{when(item)}</time>
                </small>
              </li>
            ))}
          </TodayCard>
        );
      }
    }
  };
  // Wide cards (desktop) span both columns and split the page into blocks; within a block the main column
  // holds what to act on and the side column the rest, each in the person's order.
  const blocks: ({ kind: 'columns'; main: ReactNode[]; side: ReactNode[] } | { kind: 'wide'; node: ReactNode } | { kind: 'glance'; nodes: ReactNode[] })[] = [];
  for (const setting of cards) {
    const node = render(setting);
    if (node === null) continue;
    const last = blocks.at(-1);
    // Clock & date and Weather form the glance row (19.1, 19.3, 19.4): full width, together when next to each other.
    if (setting.card.id === 'clock' || setting.card.id === 'weather') {
      if (last?.kind === 'glance') last.nodes.push(node);
      else blocks.push({ kind: 'glance', nodes: [node] });
      continue;
    }
    if (setting.size === 'WIDE') {
      blocks.push({ kind: 'wide', node });
      continue;
    }
    const block = last?.kind === 'columns' ? last : { kind: 'columns' as const, main: [], side: [] };
    if (block !== last) blocks.push(block);
    (setting.card.column === 'main' ? block.main : block.side).push(node);
  }
  const twoColumns = blocks.some((block) => block.kind !== 'columns' || (block.main.length > 0 && block.side.length > 0));

  if (props.tools.length === 0 && offlineActive === null) return <section className="card stack"><h2>{t('shell.today')}</h2><p>{t('tools.empty')}</p>{props.canChooseTools && <Link className="button" href={paths.settings(workspaceId)}>{t('tools.choose')}</Link>}</section>;
  return (
    <section aria-labelledby="today-heading" className={['today', twoColumns ? 'today-two' : '', settings.density === 'COMFORTABLE' ? 'today-comfortable' : ''].filter(Boolean).join(' ')}>
      <div className="page-header page-header-tool">
        <h2 id="today-heading">{t('shell.today')}</h2>
        <AddChooser workspaceId={workspaceId} can={props.canAdd} />
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {home === null && offlineActive === null && message === null && <p>{t('common.loading')}</p>}
      {offlineActive !== null && <p className="muted">{t('offline.savedList')}</p>}
      {assigned && (
        <div className="row home-filter today-filter" role="group" aria-label={t('home.filter')}>
          {(['ALL', 'MINE', 'SHARED'] as const).map((value) => (
            <button key={value} type="button" className="quiet" aria-pressed={filter === value} onClick={() => chooseFilter(value)}>
              {filter === value && <span aria-hidden="true">✓ </span>}
              {t(`home.filter.${value}`)}
            </button>
          ))}
        </div>
      )}
      {blocks.map((block, index) =>
        block.kind === 'glance' ? (
          <div key={index} className="today-glance">
            {block.nodes}
          </div>
        ) : block.kind === 'wide' ? (
          <div key={index} className="today-wide">
            {block.node}
          </div>
        ) : (
          <div key={index} className={block.main.length > 0 && block.side.length > 0 ? 'today-grid' : 'today-grid today-grid-one'}>
            {block.main.length > 0 && <div className="today-column">{block.main}</div>}
            {block.side.length > 0 && <div className="today-column today-side">{block.side}</div>}
          </div>
        ),
      )}
      <p className="today-customize">
        <Link href={paths.account('today')}>
          <UiIcon name="settings" /> {t('today.customize')}
        </Link>
      </p>
      <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
    </section>
  );
}

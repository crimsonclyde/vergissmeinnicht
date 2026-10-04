import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RecentCompletions, TodayProgressCard } from './TodayProgress.tsx';
import { AddChooser, type CanAdd } from './AddChooser.tsx';
import { api, isNetworkError, messageFor, type HomeOverview, type ListSummary, type Occurrence, type PersonRef, type RunSummary } from './api.ts';
import { t } from './i18n/index.ts';
import { ActiveRunItem, OccurrenceItem, groupOverdue } from './Occurrences.tsx';
import { useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { Link, paths } from './router.tsx';
import { summaryOf } from './Runs.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

/** Other members' changes appear without reloading: Today refreshes this often while it is visible. */
const REFRESH_MS = 30_000;
const FILTER_KEY = 'vmn.homeFilter';
type Filter = 'ALL' | 'MINE' | 'SHARED';
/** Lists with something to buy shown on Today; the Lists tool has all of them. */
const LISTS_ON_TODAY = 3;

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
 * Today (15.1; the former Workspace Home): unfinished Runs with Continue, what is overdue, and what is due
 * today — one clear next action per card. Upcoming dates, completed activity and the Procedures themselves
 * stay out of the way: each has its own tool, linked at the bottom. The Add button creates a Procedure,
 * a Reminder or a grocery list.
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
  const [offlineActive, setOfflineActive] = useState<readonly RunSummary[] | null>(null);
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(storedFilter);
  const [notice, setNotice] = useState<Undoable | null>(null);

  const load = useCallback(() => {
    api.home(workspaceId, filter).then(
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
    // Lists are an extra on Today: without them (offline, error) the rest still shows.
    if (props.tools.includes('LISTS')) api.lists(workspaceId).then(setLists, () => undefined);
    else setLists([]);
  }, [workspaceId, userId, reportReachable, reportUnreachable, props.tools, filter]);
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
  // Offer the same scope choices for the summary and next actions, including empty results.
  const assigned = props.tools.includes('PROCEDURES') || props.tools.includes('REMINDERS');
  const applied: Filter = filter;
  const view =
    home === null ? null : todayView(home, (item) => applied === 'ALL' || (applied === 'MINE' ? item.responsible?.id === props.userId : item.responsible === null));
  const continueRuns = view?.continueRuns ?? offlineActive ?? [];
  const overdue = groupOverdue(view?.overdue ?? []);
  const listsToBuy = lists.filter((list) => list.open > 0).slice(0, LISTS_ON_TODAY);
  const calm = view !== null && view.continueOccurrences.length + continueRuns.length + overdue.length + view.today.length === 0;

  const undoComplete = (item: Occurrence) =>
    setNotice({
      message: t('home.completedNotice', { title: item.schedule.title }),
      undo: () =>
        void api.reopenOccurrence(workspaceId, item.id).then(load, (caught: unknown) => {
          setMessage(messageFor(caught));
          load();
        }),
    });
  const section = (id: string, label: string, children: ReactNode, tone?: 'attention') => (
    <section aria-labelledby={id} className="home-section">
      <h3 id={id} className={tone === 'attention' ? 'section-label section-attention' : 'section-label'}>
        {label}
      </h3>
      <ul className="plain-list" aria-labelledby={id}>
        {children}
      </ul>
    </section>
  );
  const row = (item: Occurrence, older: readonly Occurrence[] = []) => (
    <OccurrenceItem key={item.id} workspaceId={workspaceId} item={item} older={older} can={can} members={members} onOpenRun={props.onOpenRun} onChanged={load} onCompleted={undoComplete} />
  );
  const elsewhere: { href: string; icon: UiIconName; label: string }[] = [
    ...(props.tools.includes('CALENDAR') ? [{ href: paths.calendar(workspaceId), icon: 'calendar' as const, label: view !== null && view.upcomingCount > 0 ? t('today.upcomingLink', { count: view.upcomingCount }) : t('today.calendarLink') }] : []),
    ...(props.tools.includes('REMINDERS') ? [{ href: paths.reminders(workspaceId), icon: 'reminders' as const, label: t('shell.reminders') }] : []),
    ...(props.tools.includes('PROCEDURES') ? [{ href: paths.procedures(workspaceId), icon: 'procedures' as const, label: t('today.proceduresLink') }] : []),
    ...(props.tools.includes('PROCEDURES') ? [{ href: paths.history(workspaceId), icon: 'history' as const, label: t('shell.history') }] : []),
  ];

  if (props.tools.length === 0 && offlineActive === null) return <section className="card stack"><h2>{t('shell.today')}</h2><p>{t('tools.empty')}</p>{props.canChooseTools && <Link className="button" href={paths.settings(workspaceId)}>{t('tools.choose')}</Link>}</section>;
  return (
    <section aria-labelledby="today-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="today-heading">{t('shell.today')}</h2>
          <p className="muted page-lead">{t('today.lead')}</p>
        </div>
        <AddChooser workspaceId={workspaceId} can={props.canAdd} />
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {home === null && offlineActive === null && message === null && <p>{t('common.loading')}</p>}
      {offlineActive !== null && <p className="muted">{t('offline.savedList')}</p>}
      {assigned && (
        <div className="row home-filter" role="group" aria-label={t('home.filter')}>
          {(['ALL', 'MINE', 'SHARED'] as const).map((value) => (
            <button key={value} type="button" className="quiet" aria-pressed={filter === value} onClick={() => chooseFilter(value)}>
              {filter === value && <span aria-hidden="true">✓ </span>}
              {t(`home.filter.${value}`)}
            </button>
          ))}
        </div>
      )}
      {home?.progress !== undefined && <TodayProgressCard progress={home.progress} />}
      {(continueRuns.length > 0 || (view !== null && view.continueOccurrences.length > 0)) &&
        section(
          'today-continue',
          t('today.continue'),
          <>
            {view?.continueOccurrences.map((item) => row(item))}
            {continueRuns.map((run) => (
              <ActiveRunItem key={run.id} workspaceId={workspaceId} run={run} />
            ))}
          </>,
        )}
      {overdue.length > 0 && section('today-attention', t('today.needsAttention'), overdue.map(({ item, older }) => row(item, older)), 'attention')}
      {view !== null && view.today.length > 0 && section('today-today', t('today.dueToday'), view.today.map((item) => row(item)))}
      {home?.progress !== undefined && <RecentCompletions workspaceId={workspaceId} progress={home.progress} />}
      {calm && (
        <p className="card calm">
          <UiIcon name="check" size="1.4em" /> {t('home.nothingNeedsAttention')}
        </p>
      )}
      {listsToBuy.length > 0 &&
        section(
          'today-lists',
          t('today.lists'),
          listsToBuy.map((list) => (
            <li key={list.id} className="card item-card">
              <div className="item-main">
                <span className="item-icon">
                  <UiIcon name="grocery" size="1.4em" />
                </span>
                <div className="item-body">
                  <span className="item-title">
                    <strong>{list.title}</strong>
                  </span>
                  <small className="muted">{t('lists.toBuy', { count: list.open })}</small>
                </div>
                <div className="item-actions">
                  <Link href={paths.list(workspaceId, list.id)} className="button" aria-label={t('lists.openNamed', { title: list.title })}>
                    {t('lists.open')} <UiIcon name="forward" />
                  </Link>
                </div>
              </div>
            </li>
          )),
        )}
      {/* Everything that is not for now has its own place. */}
      <nav aria-label={t('today.elsewhere')} className="quiet-links">
        {elsewhere.map((link) => (
          <Link key={link.href} href={link.href}>
            <UiIcon name={link.icon} /> {link.label}
          </Link>
        ))}
      </nav>
      <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
    </section>
  );
}

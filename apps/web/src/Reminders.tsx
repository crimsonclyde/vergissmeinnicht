import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, isNetworkError, messageFor, type HomeOverview, type Occurrence, type PersonRef } from './api.ts';
import { t } from './i18n/index.ts';
import { DoneItem, OccurrenceItem, groupOverdue } from './Occurrences.tsx';
import { useOffline } from './offline/OfflineProvider.tsx';
import { Link, navigate, paths } from './router.tsx';
import { ScheduleDialog } from './ScheduleDialog.tsx';
import { UiIcon } from './ui-icons.tsx';
import { UndoNotice, type Undoable } from './UndoNotice.tsx';

const REFRESH_MS = 30_000;
const isReminder = (item: Occurrence) => item.schedule.kind === 'REMINDER';

/** The Reminders of a Workspace overview, by section (kept apart for tests). */
export function remindersView(home: Pick<HomeOverview, 'overdue' | 'today' | 'upcoming' | 'recentlyDone'>) {
  return {
    overdue: home.overdue.filter(isReminder),
    today: home.today.filter(isReminder),
    upcoming: home.upcoming.filter(isReminder),
    done: home.recentlyDone.filter(isReminder),
  };
}

/**
 * Reminders (15.3): the place for standalone obligations without steps — overdue, today and the next
 * 90 days, with Done as the one action. Creating and changing them uses the same Schedules, Occurrences
 * and notifications as before (14.1); only the way in is new. Scheduled Procedures are not listed here:
 * they are on Today when due, on their Procedure, and in the Calendar.
 */
export function Reminders(props: {
  workspaceId: string;
  userId: string;
  /** `/reminders/new`: the New reminder dialog is open. */
  creating: boolean;
  canStart: boolean;
  canSchedule: boolean;
  canExecute: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const { workspaceId } = props;
  const { reportReachable, reportUnreachable } = useOffline();
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<Undoable | null>(null);

  const load = useCallback(() => {
    api.home(workspaceId).then(
      (loaded) => {
        setHome(loaded);
        setMessage(null);
        reportReachable();
      },
      (caught: unknown) => {
        if (isNetworkError(caught)) reportUnreachable();
        setMessage(messageFor(caught));
      },
    );
  }, [workspaceId, reportReachable, reportUnreachable]);
  useEffect(load, [load]);
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

  const can = { canStart: props.canStart, canSchedule: props.canSchedule, canExecute: props.canExecute };
  const view = home === null ? null : remindersView(home);
  const empty = view !== null && view.overdue.length + view.today.length + view.upcoming.length + view.done.length === 0;
  const undoComplete = (item: Occurrence) =>
    setNotice({
      message: t('home.completedNotice', { title: item.schedule.title }),
      undo: () =>
        void api.reopenOccurrence(workspaceId, item.id).then(load, (caught: unknown) => {
          setMessage(messageFor(caught));
          load();
        }),
    });
  const section = (id: string, label: string, children: ReactNode) => (
    <section aria-labelledby={id} className="home-section">
      <h3 id={id} className="section-label">
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

  return (
    <section aria-labelledby="reminders-heading">
      <div className="page-header page-header-tool">
        <div>
          <h2 id="reminders-heading">{t('shell.reminders')}</h2>
          <p className="muted page-lead">{t('reminders.lead')}</p>
        </div>
        {props.canSchedule && (
          <button type="button" className="primary" onClick={() => navigate(paths.newReminder(workspaceId))}>
            <UiIcon name="add" /> {t('home.newReminder')}
          </button>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {home === null && message === null && <p>{t('common.loading')}</p>}
      {empty && <p className="card calm">{t(props.canSchedule ? 'reminders.emptyHint' : 'reminders.empty')}</p>}
      {view !== null && view.overdue.length > 0 && section('reminders-overdue', t('home.overdueSection'), groupOverdue(view.overdue).map(({ item, older }) => row(item, older)))}
      {view !== null && view.today.length > 0 && section('reminders-today', t('home.todaySection'), view.today.map((item) => row(item)))}
      {view !== null && view.upcoming.length > 0 && section('reminders-upcoming', t('home.upcoming'), view.upcoming.map((item) => row(item)))}
      {home !== null && home.later > 0 && (
        <p className="muted">
          {t('home.later', { count: home.later })} <Link href={paths.calendar(workspaceId)}>{t('reminders.toCalendar')}</Link>
        </p>
      )}
      {view !== null && view.done.length > 0 && (
        <details className="more-actions">
          <summary>{t('reminders.recentlyDone', { count: view.done.length })}</summary>
          <ul className="plain-list" aria-label={t('home.recentlyDone')}>
            {view.done.map((item) => (
              <DoneItem key={item.id} workspaceId={workspaceId} item={item} can={can} onChanged={load} />
            ))}
          </ul>
        </details>
      )}
      <UndoNotice notice={notice} onDismiss={() => setNotice(null)} />
      {props.creating && props.canSchedule && (
        <ScheduleDialog
          kind="REMINDER"
          members={members}
          onClose={() => navigate(paths.reminders(workspaceId), { replace: true })}
          onSubmit={async (input) => {
            await api.createSchedule(workspaceId, input);
            load();
          }}
        />
      )}
    </section>
  );
}

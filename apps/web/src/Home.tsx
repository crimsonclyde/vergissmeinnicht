import { addInterval, type LocalDate } from '@vergissmeinnicht/domain';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, isNetworkError, messageFor, type HomeOverview, type Occurrence, type PersonRef, type ProcedureCard, type RunSummary, type ScheduleInput } from './api.ts';
import { formatCalendarDate, formatDateTime, formatRelative, t } from './i18n/index.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { AppIcon } from './procedure-icons.tsx';
import { Link, paths } from './router.tsx';
import { summaryOf } from './Runs.tsx';
import { ScheduleDialog, recurrenceLabel, reminderLabel } from './ScheduleDialog.tsx';
import { todayIn } from './schedule-dates.ts';
import { StartControl, useStartFlow } from './StartProcedure.tsx';

export interface Capabilities {
  readonly canStart: boolean;
  readonly canSchedule: boolean;
  readonly canExecute: boolean;
}

/** Other members' changes appear without reloading: Home refreshes this often while it is visible. */
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

/** "Thu, Oct 15, 2026, 18:00". */
function when(item: Pick<Occurrence, 'dueDate' | 'time'>): string {
  return item.time === null ? formatCalendarDate(item.dueDate) : t('home.dateTime', { date: formatCalendarDate(item.dueDate), time: item.time });
}

/** The input the Schedule dialog starts from when editing. */
function scheduleInputOf(item: Occurrence): ScheduleInput {
  const { schedule } = item;
  return {
    ...(schedule.kind === 'REMINDER' ? { title: schedule.title, description: schedule.description } : {}),
    recurrence: schedule.recurrence,
    date: schedule.date,
    time: schedule.time,
    timeZone: schedule.timeZone,
    reminders: schedule.reminders,
    assigneeUserId: schedule.assignee?.id ?? null,
  };
}

/** A small modal form (skip, move, assign, link, resume): the native dialog handles focus and Escape. */
function FormDialog(props: { title: string; submitLabel: string; danger?: boolean; onSubmit: () => Promise<void>; onClose: () => void; children?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await props.onSubmit();
      ref.current?.close();
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <form onSubmit={(event) => void submit(event)} className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {props.title}
        </h2>
        {message !== null && <p role="alert">{message}</p>}
        {props.children}
        <div className="row">
          <button type="submit" className={props.danger === true ? 'danger' : 'primary'} disabled={busy}>
            {props.submitLabel}
          </button>
          <button type="button" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

type OpenDialog = 'edit' | 'skip' | 'move' | 'assign' | 'link' | 'resume' | null;

/**
 * One Occurrence (Overdue, Today or Upcoming): type, title, due date, who is responsible and the one
 * next action — Complete (Reminder), Start or Continue (Procedure). Everything else is under ⋯.
 */
export function OccurrenceItem(props: {
  workspaceId: string;
  item: Occurrence;
  /** Several open Occurrences of this Schedule are overdue: this is the newest, `older` the rest. */
  older: readonly Occurrence[];
  can: Capabilities;
  members: readonly PersonRef[] | null;
  onOpenRun: (runId: string) => void;
  onChanged: () => void;
}) {
  const { item } = props;
  const { schedule } = item;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [moveDate, setMoveDate] = useState(item.dueDate);
  const [moveTime, setMoveTime] = useState(item.time ?? '');
  const [assignee, setAssignee] = useState(item.assignee?.id ?? '');
  const [linkable, setLinkable] = useState<readonly RunSummary[] | null>(null);
  const [runId, setRunId] = useState('');
  const [skipElapsed, setSkipElapsed] = useState(true);
  const today = todayIn(schedule.timeZone);
  const overdue = item.dueDate < today;
  const isProcedure = schedule.kind === 'PROCEDURE';
  const deleted = schedule.procedure?.deleted === true;
  const flow = useStartFlow({
    workspaceId: props.workspaceId,
    procedureId: schedule.procedureId ?? '',
    title: schedule.title,
    start: () => api.startOccurrence(props.workspaceId, item.id),
    onOpenRun: props.onOpenRun,
    onError: setMessage,
  });
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      props.onChanged();
    } catch (caught) {
      setMessage(messageFor(caught));
      props.onChanged();
    } finally {
      setBusy(false);
    }
  };
  const nextAfterSkip =
    schedule.recurrence.kind === 'AFTER_COMPLETION' ? formatCalendarDate(addInterval(today as LocalDate, schedule.recurrence.unit, schedule.recurrence.interval)) : null;

  const status = overdue
    ? t('home.overdue', { date: when(item) })
    : item.dueDate === today
      ? t('home.today', { when: item.time ?? '' })
      : when(item);
  const menu = [
    ...(props.can.canExecute && item.state === 'OPEN' ? [{ label: t('occurrence.skip'), onSelect: () => setDialog('skip') }] : []),
    ...(props.can.canSchedule && item.state === 'OPEN' ? [{ label: t('occurrence.move'), onSelect: () => setDialog('move') }] : []),
    ...(props.can.canSchedule && props.members !== null ? [{ label: t('occurrence.assign'), onSelect: () => setDialog('assign') }] : []),
    ...(props.can.canExecute && isProcedure && item.state === 'OPEN' && !deleted
      ? [
          {
            label: t('occurrence.linkRun'),
            onSelect: () => {
              setDialog('link');
              setLinkable(null);
              api.linkableRuns(props.workspaceId, item.id).then(setLinkable, (caught: unknown) => setMessage(messageFor(caught)));
            },
          },
        ]
      : []),
    ...(props.can.canSchedule && props.older.length > 0
      ? [
          {
            label: t('occurrence.skipOlder', { count: props.older.length }),
            onSelect: () => {
              if (window.confirm(t('occurrence.skipOlderConfirm', { count: props.older.length, title: schedule.title }))) {
                void act(() => api.skipOlderOccurrences(props.workspaceId, schedule.id, item.dueDate));
              }
            },
          },
        ]
      : []),
    ...(props.can.canSchedule && schedule.state !== 'ENDED' && !deleted ? [{ label: t('occurrence.editSchedule'), onSelect: () => setDialog('edit') }] : []),
    ...(props.can.canSchedule && schedule.state === 'ACTIVE' && schedule.recurrence.kind !== 'ONCE'
      ? [{ label: t('occurrence.pause'), onSelect: () => void act(() => api.pauseSchedule(props.workspaceId, schedule.id, schedule.revision)) }]
      : []),
    ...(props.can.canSchedule && schedule.state === 'PAUSED' ? [{ label: t('occurrence.resume'), onSelect: () => setDialog('resume') }] : []),
    ...(props.can.canSchedule
      ? [
          {
            label: t('occurrence.end'),
            danger: true,
            onSelect: () => {
              if (window.confirm(t('occurrence.endConfirm', { title: schedule.title }))) void act(() => api.endSchedule(props.workspaceId, schedule.id, schedule.revision));
            },
          },
        ]
      : []),
  ];

  return (
    <li className={`card home-item${overdue || item.dueDate === today ? ' home-due' : ''}`} data-timeliness={overdue ? 'OVERDUE' : item.dueDate === today ? 'TODAY' : 'UPCOMING'}>
      <div className="home-item-main">
        <div>
          <strong>
            <AppIcon name={schedule.procedure?.icon ?? 'reminder'} /> {schedule.title}
          </strong>
          {props.older.length > 0 && (
            <>
              {' '}
              <span className="badge">{t('home.overdueCount', { count: props.older.length + 1 })}</span>
            </>
          )}
          <br />
          <small className={overdue ? 'state-text-PENDING' : 'muted'}>
            {overdue && <span aria-hidden="true">! </span>}
            {status}
            {' · '}
            {t(isProcedure ? 'home.kindProcedure' : 'home.kindReminder')}
            {schedule.recurrence.kind !== 'ONCE' && ` · ${recurrenceLabel(schedule.recurrence)}`}
          </small>
          <br />
          <small className="muted">
            {item.responsible === null ? t('home.shared') : t('home.assignedTo', { name: item.responsible.name })}
            {item.state === 'IN_PROGRESS' && item.run !== null && ` · ${t('home.inProgressBy', { name: item.run.startedBy, ago: formatRelative(item.run.startedAt) })}`}
            {schedule.state === 'PAUSED' && ` · ${t('home.paused')}`}
          </small>
          {!overdue && item.dueDate !== today && schedule.reminders.length > 0 && (
            <>
              <br />
              <small className="muted">{t('home.reminders', { list: schedule.reminders.map((reminder) => reminderLabel(reminder, true)).join(', ') })}</small>
            </>
          )}
          {deleted && (
            <>
              <br />
              <small role="note">{t('home.procedureDeleted')}</small>
            </>
          )}
        </div>
        <div className="row">
          {item.state === 'IN_PROGRESS' && item.run !== null ? (
            <Link href={paths.run(props.workspaceId, item.run.id)} className="button primary" aria-label={t('home.continueNamed', { title: schedule.title })}>
              {t('home.continue')}
            </Link>
          ) : isProcedure ? (
            props.can.canStart &&
            !deleted && (
              <button
                type="button"
                className={overdue || item.dueDate === today ? 'primary' : undefined}
                disabled={flow.busy}
                aria-label={t(overdue || item.dueDate === today ? 'home.startNamed' : 'home.startEarlyNamed', { title: schedule.title })}
                onClick={() => {
                  setMessage(null);
                  void flow.begin();
                }}
              >
                {t(overdue || item.dueDate === today ? 'start.button' : 'home.startEarly')}
              </button>
            )
          ) : (
            props.can.canExecute && (
              <button
                type="button"
                className={overdue || item.dueDate === today ? 'primary' : undefined}
                disabled={busy}
                aria-label={t('home.completeNamed', { title: schedule.title })}
                onClick={() => void act(() => api.completeOccurrence(props.workspaceId, item.id))}
              >
                <span aria-hidden="true">✓ </span>
                {t('home.complete')}
              </button>
            )
          )}
          {menu.length > 0 && <MoreMenu label={t('home.moreFor', { title: schedule.title })} items={menu} />}
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {flow.dialog}
      {dialog === 'edit' && (
        <ScheduleDialog
          kind={schedule.kind}
          title={schedule.title}
          initial={scheduleInputOf(item)}
          members={props.members}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            await api.updateSchedule(props.workspaceId, schedule.id, schedule.revision, input);
            props.onChanged();
          }}
        />
      )}
      {dialog === 'skip' && (
        <FormDialog
          title={t('occurrence.skipHeading', { title: schedule.title, date: when(item) })}
          submitLabel={t('occurrence.skipSubmit')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await api.skipOccurrence(props.workspaceId, item.id, reason);
            props.onChanged();
          }}
        >
          <p style={{ margin: 0 }}>{nextAfterSkip === null ? t('occurrence.skipExplain') : t('occurrence.skipNext', { date: nextAfterSkip })}</p>
          <label>
            {t('occurrence.reason')} {t('common.optional')}
            <br />
            <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </FormDialog>
      )}
      {dialog === 'move' && (
        <FormDialog
          title={t('occurrence.moveHeading', { title: schedule.title })}
          submitLabel={t('schedule.submitMove')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await api.moveOccurrence(props.workspaceId, item.id, moveDate, moveTime === '' ? null : moveTime);
            props.onChanged();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t('occurrence.moveExplain')}
          </p>
          <div className="row">
            <label>
              {t('schedule.date')}
              <br />
              <input type="date" required min={today} value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
            </label>
            <label>
              {t('schedule.time')} {t('common.optional')}
              <br />
              <input type="time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} />
            </label>
          </div>
        </FormDialog>
      )}
      {dialog === 'assign' && props.members !== null && (
        <FormDialog
          title={t('occurrence.assignHeading', { title: schedule.title, date: when(item) })}
          submitLabel={t('schedule.submitMove')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await api.assignOccurrence(props.workspaceId, item.id, assignee === '' ? null : assignee);
            props.onChanged();
          }}
        >
          <label htmlFor={`assign-${item.id}`}>{t('schedule.responsible')}</label>
          <div>
            <select id={`assign-${item.id}`} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{schedule.assignee === null ? t('schedule.shared') : t('occurrence.likeSchedule', { name: schedule.assignee.name })}</option>
              {props.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
          <small className="muted">{t('schedule.responsibleHint')}</small>
        </FormDialog>
      )}
      {dialog === 'link' && (
        <FormDialog
          title={t('occurrence.linkHeading', { title: schedule.title, date: when(item) })}
          submitLabel={t('occurrence.linkSubmit')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            if (runId === '') throw new Error(t('occurrence.linkChoose'));
            await api.linkRun(props.workspaceId, item.id, runId);
            props.onChanged();
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            {t('occurrence.linkExplain')}
          </p>
          {linkable === null ? (
            <p>{t('common.loading')}</p>
          ) : linkable.length === 0 ? (
            <p>{t('occurrence.linkNone')}</p>
          ) : (
            <fieldset>
              <legend>{t('occurrence.linkChoose')}</legend>
              {linkable.map((summary) => (
                <label key={summary.id} className="row" style={{ fontWeight: 400 }}>
                  <input type="radio" name={`link-${item.id}`} value={summary.id} checked={runId === summary.id} onChange={() => setRunId(summary.id)} />
                  {t(summary.state === 'ACTIVE' ? 'occurrence.linkActive' : 'occurrence.linkCompleted', {
                    name: summary.startedBy,
                    time: formatDateTime(summary.startedAt),
                  })}
                </label>
              ))}
            </fieldset>
          )}
        </FormDialog>
      )}
      {dialog === 'resume' && (
        <FormDialog
          title={t('occurrence.resumeHeading', { title: schedule.title })}
          submitLabel={t('occurrence.resume')}
          onClose={() => setDialog(null)}
          onSubmit={async () => {
            await api.resumeSchedule(props.workspaceId, schedule.id, schedule.revision, skipElapsed);
            props.onChanged();
          }}
        >
          {schedule.recurrence.kind === 'FIXED' ? (
            <label className="row" style={{ fontWeight: 400 }}>
              <input type="checkbox" checked={skipElapsed} onChange={(e) => setSkipElapsed(e.target.checked)} />
              {t('occurrence.resumeSkip')}
            </label>
          ) : (
            <p style={{ margin: 0 }}>{t('occurrence.resumeKeep')}</p>
          )}
        </FormDialog>
      )}
    </li>
  );
}

/** Completed or skipped, with who and when (`exact`: date and time instead of "2 hours ago") — and Undo for Reminders. */
export function DoneItem(props: { workspaceId: string; item: Occurrence; can: Capabilities; onChanged: () => void; exact?: boolean }) {
  const { item } = props;
  const [message, setMessage] = useState<string | null>(null);
  const undo = async () => {
    try {
      await api.reopenOccurrence(props.workspaceId, item.id);
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    props.onChanged();
  };
  return (
    <li className="card home-item">
      <div className="home-item-main">
        <div>
          <span aria-hidden="true">{item.state === 'COMPLETED' ? '✓ ' : '↷ '}</span>
          <AppIcon name={item.schedule.procedure?.icon ?? 'reminder'} /> {item.schedule.title}
          <br />
          <small className="muted">
            {t(item.state === 'COMPLETED' ? 'home.completedBy' : 'home.skippedBy', {
              name: item.closed?.by ?? '',
              ago: props.exact === true && item.closed !== null ? t('home.closedOn', { when: formatDateTime(item.closed.at) }) : formatRelative(item.closed?.at ?? new Date().toISOString()),
            })}
            {item.skipReason !== null && item.skipReason !== '' && ` · ${t('home.skipReason', { reason: item.skipReason })}`}
            {item.responsible !== null && ` · ${t('home.assignedTo', { name: item.responsible.name })}`}
          </small>
        </div>
        {props.can.canExecute && (item.schedule.kind === 'REMINDER' || item.state === 'SKIPPED') && (
          <button type="button" className="quiet" aria-label={t('home.undoNamed', { title: item.schedule.title })} onClick={() => void undo()}>
            {t('home.undo')}
          </button>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
    </li>
  );
}

function ActiveItem({ workspaceId, run }: { workspaceId: string; run: RunSummary }) {
  const total = Object.values(run.stepCounts).reduce((sum, n) => sum + n, 0);
  const resolved = total - run.stepCounts.PENDING;
  return (
    <li className="card home-item">
      <div className="home-item-main">
        <div>
          <strong>
            <AppIcon name={run.icon} /> {run.title}
          </strong>
          <br />
          <small className="muted">
            {t('home.startedBy', { name: run.startedBy, ago: formatRelative(run.startedAt) })} · {t('home.progress', { resolved, total })}
          </small>
        </div>
        <Link href={paths.run(workspaceId, run.id)} className="button primary" aria-label={t('home.continueNamed', { title: run.title })}>
          {t('home.continue')}
        </Link>
      </div>
    </li>
  );
}

function ProcedureItem(props: { workspaceId: string; card: ProcedureCard; can: Capabilities; onOpenRun: (runId: string) => void; onChanged: () => void }) {
  const { card } = props;
  return (
    <li className="card home-item">
      <div className="home-item-main">
        <div>
          <Link href={paths.procedure(props.workspaceId, card.id)} className="procedure-link">
            <AppIcon name={card.icon} /> {card.title}
          </Link>
          {card.lastCompletedAt !== null && (
            <>
              <br />
              <small className="muted">{t('procedures.lastCompleted', { ago: formatRelative(card.lastCompletedAt) })}</small>
            </>
          )}
        </div>
        <StartControl
          workspaceId={props.workspaceId}
          procedure={card}
          canStart={props.can.canStart}
          canSchedule={props.can.canSchedule}
          onOpenRun={props.onOpenRun}
          onScheduled={props.onChanged}
        />
      </div>
    </li>
  );
}

/** Overdue Occurrences of one Schedule shown once: the newest, with the older ones counted. */
function groupOverdue(items: readonly Occurrence[]): { item: Occurrence; older: Occurrence[] }[] {
  const bySchedule = new Map<string, Occurrence[]>();
  for (const item of items) bySchedule.set(item.schedule.id, [...(bySchedule.get(item.schedule.id) ?? []), item]);
  return [...bySchedule.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const newest = sorted[sorted.length - 1] as Occurrence;
    return { item: newest, older: sorted.slice(0, -1) };
  });
}

/**
 * Workspace Home (13.9, 14.2): what needs attention now (Overdue, Today), what is coming (Upcoming, 90
 * days), what was just done, what is going on (Active), what one uses (Pinned, Recent). Calm on purpose:
 * one clear next action per row, no statistics, no charts.
 */
export function Home(props: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  canStart: boolean;
  canSchedule: boolean;
  canExecute: boolean;
  onOpenRun: (runId: string) => void;
}) {
  const { workspaceId } = props;
  const { userId, reportReachable, reportUnreachable } = useOffline();
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [offlineActive, setOfflineActive] = useState<readonly RunSummary[] | null>(null);
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(storedFilter);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.home(workspaceId).then(
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
  }, [workspaceId, userId, reportReachable, reportUnreachable]);
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
  const shown = (item: Occurrence) => filter === 'ALL' || (filter === 'MINE' ? item.responsible?.id === props.userId : item.responsible === null);
  const can = { canStart: props.canStart, canSchedule: props.canSchedule, canExecute: props.canExecute };
  const active = home?.active ?? offlineActive ?? [];
  const overdue = groupOverdue((home?.overdue ?? []).filter(shown));
  const today = (home?.today ?? []).filter(shown);
  const upcoming = (home?.upcoming ?? []).filter(shown);
  const done = home?.recentlyDone ?? [];
  const nothingToDo = home !== null && overdue.length + today.length === 0;
  const empty = home !== null && home.overdue.length + home.today.length + home.upcoming.length + home.active.length + home.pinned.length + home.recent.length + done.length === 0;

  const section = (id: string, label: ReactNode, children: ReactNode) => (
    <section aria-labelledby={id} className="home-section">
      <h3 id={id}>{label}</h3>
      <ul className="plain-list" aria-labelledby={id}>
        {children}
      </ul>
    </section>
  );
  const row = (item: Occurrence, older: readonly Occurrence[] = []) => (
    <OccurrenceItem key={item.id} workspaceId={workspaceId} item={item} older={older} can={can} members={members} onOpenRun={props.onOpenRun} onChanged={load} />
  );

  return (
    <section aria-labelledby="home-heading">
      <div className="page-header">
        <h2 id="home-heading">{t('home.heading', { name: props.workspaceName })}</h2>
        {props.canSchedule && (
          <button type="button" onClick={() => setCreating(true)}>
            {t('home.newReminder')}
          </button>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {home === null && offlineActive === null && message === null && <p>{t('common.loading')}</p>}
      {offlineActive !== null && <p className="muted">{t('offline.savedList')}</p>}
      {home !== null && !empty && (
        <div className="row home-filter" role="group" aria-label={t('home.filter')}>
          {(['ALL', 'MINE', 'SHARED'] as const).map((value) => (
            <button key={value} type="button" className="quiet" aria-pressed={filter === value} onClick={() => chooseFilter(value)}>
              {filter === value && <span aria-hidden="true">✓ </span>}
              {t(`home.filter.${value}`)}
            </button>
          ))}
        </div>
      )}
      {empty && (
        <p className="card">
          {t('home.empty')} <Link href={paths.procedures(workspaceId)}>{t('home.toProcedures')}</Link>
        </p>
      )}
      {home !== null && !empty && nothingToDo && <p className="card">{t('home.nothingNeedsAttention')}</p>}
      {overdue.length > 0 && section('home-overdue', t('home.overdueSection'), overdue.map(({ item, older }) => row(item, older)))}
      {today.length > 0 && section('home-today', t('home.todaySection'), today.map((item) => row(item)))}
      {upcoming.length > 0 && section('home-upcoming', t('home.upcoming'), upcoming.map((item) => row(item)))}
      {home !== null && home.later > 0 && <p className="muted">{t('home.later', { count: home.later })}</p>}
      {done.length > 0 &&
        section(
          'home-done',
          t('home.recentlyDone'),
          done.map((item) => <DoneItem key={item.id} workspaceId={workspaceId} item={item} can={can} onChanged={load} />),
        )}
      {active.length > 0 && section('home-active', t('home.active'), active.map((run) => <ActiveItem key={run.id} workspaceId={workspaceId} run={run} />))}
      {home !== null &&
        home.pinned.length > 0 &&
        section(
          'home-pinned',
          <>
            <span aria-hidden="true">★ </span>
            {t('home.pinned')}
          </>,
          home.pinned.map((card) => <ProcedureItem key={card.id} workspaceId={workspaceId} card={card} can={can} onOpenRun={props.onOpenRun} onChanged={load} />),
        )}
      {home !== null &&
        home.recent.length > 0 &&
        section(
          'home-recent',
          t('home.recent'),
          home.recent.map((card) => <ProcedureItem key={card.id} workspaceId={workspaceId} card={card} can={can} onOpenRun={props.onOpenRun} onChanged={load} />),
        )}
      {creating && (
        <ScheduleDialog
          kind="REMINDER"
          members={members}
          onClose={() => setCreating(false)}
          onSubmit={async (input) => {
            await api.createSchedule(workspaceId, input);
            load();
          }}
        />
      )}
    </section>
  );
}


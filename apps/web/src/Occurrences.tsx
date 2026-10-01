import { addInterval, type LocalDate } from '@vergissmeinnicht/domain';
import { useState } from 'react';
import { api, messageFor, type Occurrence, type PersonRef, type RunSummary, type ScheduleInput } from './api.ts';
import { FormDialog } from './FormDialog.tsx';
import { formatCalendarDate, formatDateTime, formatRelative, t } from './i18n/index.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { AppIcon } from './procedure-icons.tsx';
import { Link, paths } from './router.tsx';
import { ScheduleDialog, recurrenceLabel, reminderLabel } from './ScheduleDialog.tsx';
import { todayIn } from './schedule-dates.ts';
import { useStartFlow } from './StartProcedure.tsx';
import { UiIcon } from './ui-icons.tsx';

export interface Capabilities {
  readonly canStart: boolean;
  readonly canSchedule: boolean;
  readonly canExecute: boolean;
}

/** "Thu, Oct 15, 2026, 18:00". */
export function when(item: Pick<Occurrence, 'dueDate' | 'time'>): string {
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

type OpenDialog = 'edit' | 'skip' | 'move' | 'assign' | 'link' | 'resume' | null;

/**
 * One Occurrence (Overdue, Today or Upcoming), kept concise (15.1): the title, one line of context (when
 * and who is responsible) and the one next action — Done (Reminder), Start or Continue (Procedure).
 * Type, repetition, reminders and every management action are under ⋯.
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
  /** A Reminder was just completed here (so the page can offer Undo). */
  onCompleted?: (item: Occurrence) => void;
}) {
  const { item } = props;
  const { schedule } = item;
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [details, setDetails] = useState(false);
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
    ? t('home.wasDue', { date: when(item) })
    : item.dueDate === today
      ? t('home.today', { when: item.time ?? '' })
      : when(item);
  const dueNow = overdue || item.dueDate === today;
  const responsible = item.responsible === null ? t('home.shared') : t('home.assignedTo', { name: item.responsible.name });
  const menu = [
    // Secondary facts (type, repetition, reminders) are one tap away instead of on every card.
    { label: t(details ? 'occurrence.hideDetails' : 'occurrence.details'), onSelect: () => setDetails((value) => !value) },
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
    <li className="card item-card" data-timeliness={overdue ? 'OVERDUE' : item.dueDate === today ? 'TODAY' : 'UPCOMING'}>
      <div className="item-main">
        <span className="item-icon">
          <AppIcon name={schedule.procedure?.icon ?? 'reminder'} decorative />
        </span>
        <div className="item-body">
          <span className="item-title">
            <strong>{schedule.title}</strong>
            {overdue && (
              <span className="badge badge-overdue">
                <span aria-hidden="true">! </span>
                {props.older.length > 0 ? t('home.overdueCount', { count: props.older.length + 1 }) : t('home.overdueBadge')}
              </span>
            )}
          </span>
          {/* One line of context: when, and who is responsible. */}
          <small className="muted">
            {item.state === 'IN_PROGRESS' && item.run !== null ? t('home.inProgressBy', { name: item.run.startedBy, ago: formatRelative(item.run.startedAt) }) : `${status} · ${responsible}`}
            {schedule.state === 'PAUSED' && ` · ${t('home.paused')}`}
          </small>
          {deleted && <small role="note">{t('home.procedureDeleted')}</small>}
          {details && (
            <small className="muted item-details">
              {t(isProcedure ? 'home.kindProcedure' : 'home.kindReminder')} · {recurrenceLabel(schedule.recurrence)}
              {item.state === 'IN_PROGRESS' && ` · ${status} · ${responsible}`}
              <br />
              {schedule.reminders.length > 0 ? t('home.reminders', { list: schedule.reminders.map((reminder) => reminderLabel(reminder, true)).join(', ') }) : t('home.noReminders')}
              {schedule.description !== '' && (
                <>
                  <br />
                  {schedule.description}
                </>
              )}
            </small>
          )}
        </div>
        <div className="item-actions">
          {item.state === 'IN_PROGRESS' && item.run !== null ? (
            <Link href={paths.run(props.workspaceId, item.run.id)} className="button primary" aria-label={t('home.continueNamed', { title: schedule.title })}>
              {t('home.continue')} <UiIcon name="forward" />
            </Link>
          ) : isProcedure ? (
            props.can.canStart &&
            !deleted && (
              <button
                type="button"
                className={dueNow ? 'primary' : undefined}
                disabled={flow.busy}
                aria-label={t(dueNow ? 'home.startNamed' : 'home.startEarlyNamed', { title: schedule.title })}
                onClick={() => {
                  setMessage(null);
                  void flow.begin();
                }}
              >
                {t(dueNow ? 'start.button' : 'home.startEarly')}
              </button>
            )
          ) : (
            props.can.canExecute && (
              <button
                type="button"
                className={dueNow ? 'done-action' : undefined}
                disabled={busy}
                aria-label={t('home.completeNamed', { title: schedule.title })}
                onClick={() =>
                  void act(async () => {
                    await api.completeOccurrence(props.workspaceId, item.id);
                    props.onCompleted?.(item);
                  })
                }
              >
                {t('home.done')} <UiIcon name="check" />
              </button>
            )
          )}
          <MoreMenu label={t('home.moreFor', { title: schedule.title })} items={menu} />
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
    <li className="card item-card">
      <div className="item-main">
        <span className="item-icon item-icon-quiet">
          <AppIcon name={item.schedule.procedure?.icon ?? 'reminder'} decorative />
        </span>
        <div className="item-body">
          <span className="item-title">
            <span aria-hidden="true">{item.state === 'COMPLETED' ? '✓ ' : '↷ '}</span>
            {item.schedule.title}
          </span>
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
          <div className="item-actions">
            <button type="button" className="quiet" aria-label={t('home.undoNamed', { title: item.schedule.title })} onClick={() => void undo()}>
              {t('home.undo')}
            </button>
          </div>
        )}
      </div>
      {message !== null && <p role="alert">{message}</p>}
    </li>
  );
}

/** A Run in progress: title, how far it is, and Continue. */
export function ActiveRunItem({ workspaceId, run }: { workspaceId: string; run: RunSummary }) {
  const total = Object.values(run.stepCounts).reduce((sum, n) => sum + n, 0);
  const resolved = total - run.stepCounts.PENDING;
  return (
    <li className="card item-card">
      <div className="item-main">
        <span className="item-icon">
          <AppIcon name={run.icon} decorative />
        </span>
        <div className="item-body">
          <span className="item-title">
            <strong>{run.title}</strong>
          </span>
          <small className="muted">{t('home.progress', { resolved, total })}</small>
          <span className="progress item-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={resolved} aria-label={t('run.progressLabel')}>
            <span style={{ width: `${total === 0 ? 0 : Math.round((resolved / total) * 100)}%` }} />
          </span>
        </div>
        <div className="item-actions">
          <Link href={paths.run(workspaceId, run.id)} className="button primary" aria-label={t('home.continueNamed', { title: run.title })}>
            {t('home.continue')} <UiIcon name="forward" />
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Overdue Occurrences of one Schedule shown once: the newest, with the older ones counted. */
export function groupOverdue(items: readonly Occurrence[]): { item: Occurrence; older: Occurrence[] }[] {
  const bySchedule = new Map<string, Occurrence[]>();
  for (const item of items) bySchedule.set(item.schedule.id, [...(bySchedule.get(item.schedule.id) ?? []), item]);
  return [...bySchedule.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const newest = sorted[sorted.length - 1] as Occurrence;
    return { item: newest, older: sorted.slice(0, -1) };
  });
}

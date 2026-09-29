import { useCallback, useEffect, useState } from 'react';
import { api, isNetworkError, messageFor, type HomeOverview, type ProcedureCard, type RunSummary, type ScheduledProcedure } from './api.ts';
import { formatCalendarDate, formatRelative, t } from './i18n/index.ts';
import { MoreMenu } from './MoreMenu.tsx';
import { useOffline } from './offline/OfflineProvider.tsx';
import { offlineStore } from './offline/store.ts';
import { Icon } from './procedure-icons.tsx';
import { Link, paths } from './router.tsx';
import { summaryOf } from './Runs.tsx';
import { ScheduleDialog, reminderLabel } from './ScheduleDialog.tsx';
import { StartControl, useStartFlow } from './StartProcedure.tsx';

interface Capabilities {
  readonly canStart: boolean;
  readonly canSchedule: boolean;
}

/** "Thu, Oct 15, 2026, 18:00" — with the zone only when it is not the one the viewer is in. */
function scheduledWhen(item: Pick<ScheduledProcedure, 'date' | 'time'>): string {
  return item.time === null ? formatCalendarDate(item.date) : t('home.dateTime', { date: formatCalendarDate(item.date), time: item.time });
}

/** One scheduled item (Due or Upcoming): Start as the main action, move and cancel under ⋯. */
function ScheduledItem(props: {
  workspaceId: string;
  item: ScheduledProcedure & { readonly timeliness?: 'OVERDUE' | 'TODAY' };
  due: boolean;
  can: Capabilities;
  onOpenRun: (runId: string) => void;
  onChanged: () => void;
}) {
  const { item } = props;
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const flow = useStartFlow({
    workspaceId: props.workspaceId,
    procedureId: item.procedureId,
    title: item.procedure.title,
    start: () => api.startScheduled(props.workspaceId, item.id),
    onOpenRun: props.onOpenRun,
    onError: setMessage,
  });
  const cancel = async () => {
    if (!window.confirm(t('home.cancelConfirm', { title: item.procedure.title }))) return;
    try {
      await api.cancelSchedule(props.workspaceId, item.id, item.revision);
      props.onChanged();
    } catch (caught) {
      setMessage(messageFor(caught));
      props.onChanged();
    }
  };
  const status = item.timeliness === 'OVERDUE' ? t('home.overdue', { date: scheduledWhen(item) }) : item.timeliness === 'TODAY' ? t('home.today', { when: item.time ?? '' }) : scheduledWhen(item);
  return (
    <li className={`card home-item${props.due ? ' home-due' : ''}`} data-timeliness={item.timeliness ?? 'UPCOMING'}>
      <div className="home-item-main">
        <div>
          <strong>
            <Icon icon={item.procedure.icon} /> {item.procedure.title}
          </strong>
          <br />
          <small className={item.timeliness === 'OVERDUE' ? 'state-text-PENDING' : 'muted'}>
            {item.timeliness === 'OVERDUE' && <span aria-hidden="true">! </span>}
            {status}
          </small>
          {!props.due && item.reminders.length > 0 && (
            <>
              <br />
              <small className="muted">{t('home.reminders', { list: item.reminders.map((reminder) => reminderLabel(reminder, true)).join(', ') })}</small>
            </>
          )}
          {item.procedure.deleted && (
            <>
              <br />
              <small role="note">{t('home.procedureDeleted')}</small>
            </>
          )}
        </div>
        <div className="row">
          {props.can.canStart && !item.procedure.deleted && (
            <button
              type="button"
              className={props.due ? 'primary' : undefined}
              disabled={flow.busy}
              aria-label={t(props.due ? 'home.startNamed' : 'home.startEarlyNamed', { title: item.procedure.title })}
              onClick={() => {
                setMessage(null);
                void flow.begin();
              }}
            >
              {t(props.due ? 'start.button' : 'home.startEarly')}
            </button>
          )}
          {props.can.canSchedule && (
            <MoreMenu
              label={t('home.moreFor', { title: item.procedure.title })}
              items={[
                ...(item.procedure.deleted ? [] : [{ label: t('home.reschedule'), onSelect: () => setMoving(true) }]),
                { label: t('home.cancelSchedule'), onSelect: () => void cancel(), danger: true },
              ]}
            />
          )}
        </div>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {flow.dialog}
      {moving && (
        <ScheduleDialog
          procedureTitle={item.procedure.title}
          initial={{ date: item.date, time: item.time, timeZone: item.timeZone, reminders: item.reminders }}
          onClose={() => setMoving(false)}
          onSubmit={async (input) => {
            await api.reschedule(props.workspaceId, item.id, item.revision, input);
            props.onChanged();
          }}
        />
      )}
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
            <Icon icon={run.icon} /> {run.title}
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
            <Icon icon={card.icon} /> {card.title}
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

/**
 * Workspace Home (13.9, 13.11): what to do now (Due), what is coming (Upcoming), what is going on
 * (Active), what one uses (Pinned, Recent). Calm on purpose: no statistics, no charts.
 */
export function Home(props: { workspaceId: string; workspaceName: string; canStart: boolean; canSchedule: boolean; onOpenRun: (runId: string) => void }) {
  const { workspaceId } = props;
  const { userId, reportReachable, reportUnreachable } = useOffline();
  const [home, setHome] = useState<HomeOverview | null>(null);
  const [offlineActive, setOfflineActive] = useState<readonly RunSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api.home(workspaceId).then(
      (loaded) => {
        setHome(loaded);
        setOfflineActive(null);
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

  const can = { canStart: props.canStart, canSchedule: props.canSchedule };
  const active = home?.active ?? offlineActive ?? [];
  const empty = home !== null && home.due.length + home.upcoming.length + home.active.length + home.pinned.length + home.recent.length === 0;

  return (
    <section aria-labelledby="home-heading">
      <div className="page-header">
        <h2 id="home-heading">{t('home.heading', { name: props.workspaceName })}</h2>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {home === null && offlineActive === null && message === null && <p>{t('common.loading')}</p>}
      {offlineActive !== null && <p className="muted">{t('offline.savedList')}</p>}
      {empty && (
        <p className="card">
          {t('home.empty')} <Link href={paths.procedures(workspaceId)}>{t('home.toProcedures')}</Link>
        </p>
      )}
      {home !== null && home.due.length > 0 && (
        <section aria-labelledby="home-due" className="home-section">
          <h3 id="home-due">{t('home.due')}</h3>
          <ul className="plain-list" aria-labelledby="home-due">
            {home.due.map((item) => (
              <ScheduledItem key={item.id} workspaceId={workspaceId} item={item} due can={can} onOpenRun={props.onOpenRun} onChanged={load} />
            ))}
          </ul>
        </section>
      )}
      {home !== null && home.upcoming.length > 0 && (
        <section aria-labelledby="home-upcoming" className="home-section">
          <h3 id="home-upcoming">{t('home.upcoming')}</h3>
          <ul className="plain-list" aria-labelledby="home-upcoming">
            {home.upcoming.map((item) => (
              <ScheduledItem key={item.id} workspaceId={workspaceId} item={item} due={false} can={can} onOpenRun={props.onOpenRun} onChanged={load} />
            ))}
          </ul>
        </section>
      )}
      {active.length > 0 && (
        <section aria-labelledby="home-active" className="home-section">
          <h3 id="home-active">{t('home.active')}</h3>
          <ul className="plain-list" aria-labelledby="home-active">
            {active.map((run) => (
              <ActiveItem key={run.id} workspaceId={workspaceId} run={run} />
            ))}
          </ul>
        </section>
      )}
      {home !== null && home.pinned.length > 0 && (
        <section aria-labelledby="home-pinned" className="home-section">
          <h3 id="home-pinned">
            <span aria-hidden="true">★ </span>
            {t('home.pinned')}
          </h3>
          <ul className="plain-list" aria-labelledby="home-pinned">
            {home.pinned.map((card) => (
              <ProcedureItem key={card.id} workspaceId={workspaceId} card={card} can={can} onOpenRun={props.onOpenRun} onChanged={load} />
            ))}
          </ul>
        </section>
      )}
      {home !== null && home.recent.length > 0 && (
        <section aria-labelledby="home-recent" className="home-section">
          <h3 id="home-recent">{t('home.recent')}</h3>
          <ul className="plain-list" aria-labelledby="home-recent">
            {home.recent.map((card) => (
              <ProcedureItem key={card.id} workspaceId={workspaceId} card={card} can={can} onOpenRun={props.onOpenRun} onChanged={load} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

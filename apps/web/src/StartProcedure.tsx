import { useEffect, useId, useRef, useState } from 'react';
import { api, messageFor, type RunDetail, type RunSummary, type ScheduledProcedure } from './api.ts';
import { formatCalendarDate, formatRelative, t } from './i18n/index.ts';
import { ScheduleDialog } from './ScheduleDialog.tsx';

/**
 * Warns before starting a Procedure that already has an active execution (13.18). Several active
 * executions stay allowed — this is guidance, not a rule: the server starts another one if asked.
 */
function ActiveWarning(props: { title: string; active: readonly RunSummary[]; onContinue: (runId: string) => void; onStartAnother: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (ref.current !== null && !ref.current.open) ref.current.showModal();
  }, []);
  const newest = props.active[0];
  if (newest === undefined) return null;
  const close = (then: () => void) => {
    ref.current?.close();
    then();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={headingId} onClose={props.onClose}>
      <div className="stack">
        <h2 id={headingId} style={{ margin: 0 }}>
          {t('start.alreadyActiveHeading')}
        </h2>
        <p>
          {t('start.alreadyActive', { count: props.active.length, title: props.title, name: newest.startedBy, ago: formatRelative(newest.startedAt) })}
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={() => close(() => props.onContinue(newest.id))}>
            {t('start.continueExisting')}
          </button>
          <button type="button" onClick={() => close(props.onStartAnother)}>
            {t('start.startAnother')}
          </button>
          <button type="button" className="quiet" onClick={() => ref.current?.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Starting with a look at what is already running: fetches the Procedure's active executions first
 * and asks when there are any (13.18). `start` creates the Run (from the Procedure or a scheduled item).
 */
export function useStartFlow(props: {
  workspaceId: string;
  procedureId: string;
  title: string;
  start: () => Promise<RunDetail>;
  onOpenRun: (runId: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<readonly RunSummary[] | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      props.onOpenRun((await props.start()).id);
    } catch (caught) {
      props.onError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    setBusy(true);
    let running: readonly RunSummary[] = [];
    try {
      running = (await api.runs(props.workspaceId, { state: 'ACTIVE', procedureId: props.procedureId })).runs;
    } catch {
      // The warning is a convenience; without it the server still decides.
    }
    setBusy(false);
    if (running.length > 0) setActive(running);
    else await run();
  };

  const dialog =
    active === null ? null : (
      <ActiveWarning
        title={props.title}
        active={active}
        onContinue={props.onOpenRun}
        onStartAnother={() => void run()}
        onClose={() => setActive(null)}
      />
    );
  return { busy, begin, dialog };
}

/**
 * The primary action of a Procedure (13.10): **Start** opens "Start now" and "Schedule…". Shown only
 * with the matching capabilities (UI only — the server authorizes every request).
 */
export function StartControl(props: {
  workspaceId: string;
  procedure: { readonly id: string; readonly title: string };
  canStart: boolean;
  canSchedule: boolean;
  onOpenRun: (runId: string) => void;
  onScheduled?: (schedule: ScheduledProcedure) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flow = useStartFlow({
    workspaceId: props.workspaceId,
    procedureId: props.procedure.id,
    title: props.procedure.title,
    start: () => api.startRun(props.workspaceId, props.procedure.id),
    onOpenRun: props.onOpenRun,
    onError: setMessage,
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!props.canStart && !props.canSchedule) return null;
  return (
    <div className="start-control" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="primary"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('start.openFor', { title: props.procedure.title })}
        disabled={flow.busy}
        onClick={() => setOpen((value) => !value)}
      >
        {t('start.button')} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={panelId} className="more-menu-panel">
          {props.canStart && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setMessage(null);
                void flow.begin();
              }}
            >
              {t('start.now')}
            </button>
          )}
          {props.canSchedule && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setMessage(null);
                setScheduling(true);
              }}
            >
              {t('start.schedule')}
            </button>
          )}
        </div>
      )}
      {message !== null && <p role="alert">{message}</p>}
      {status !== null && <p role="status">{status}</p>}
      {flow.dialog}
      {scheduling && (
        <ScheduleDialog
          procedureTitle={props.procedure.title}
          onClose={() => {
            setScheduling(false);
            buttonRef.current?.focus();
          }}
          onSubmit={async (input) => {
            const schedule = await api.scheduleProcedure(props.workspaceId, props.procedure.id, input);
            setStatus(t('start.scheduled', { title: props.procedure.title, date: formatCalendarDate(schedule.date) }));
            props.onScheduled?.(schedule);
          }}
        />
      )}
    </div>
  );
}

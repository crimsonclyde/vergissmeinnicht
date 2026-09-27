import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  messageFor,
  type HistoryEvent,
  type ReasonPolicy,
  type RunDetail,
  type RunState,
  type RunStep,
  type RunSummary,
  type StepState,
} from './api.ts';
import { History } from './History.tsx';
import { HoldToConfirm } from './HoldToConfirm.tsx';
import { Icon } from './procedure-icons.tsx';
import { applyStepResult, isNewer, withPendingChanges, type PendingStepChange } from './run-updates.ts';
import { useRunLiveUpdates, type AnnouncedChange, type LiveStatus } from './useRunLiveUpdates.ts';

/** Text (and a glyph) for every state: color is never the only indicator. */
const STEP_STATE_LABELS: Record<StepState, { glyph: string; label: string }> = {
  PENDING: { glyph: '○', label: 'Pending' },
  DONE: { glyph: '✔', label: 'Done' },
  SKIPPED: { glyph: '↷', label: 'Skipped' },
  NOT_APPLICABLE: { glyph: '–', label: 'Not applicable' },
};
const RUN_STATE_LABELS: Record<RunState, string> = { ACTIVE: 'Active', COMPLETED: 'Completed', ABORTED: 'Aborted' };
const RUN_STATE_BADGE: Record<RunState, StepState> = { ACTIVE: 'PENDING', COMPLETED: 'DONE', ABORTED: 'NOT_APPLICABLE' };

function StateBadge({ state }: { state: StepState }) {
  return (
    <span className={`state-badge state-${state}`}>
      <span aria-hidden="true">{STEP_STATE_LABELS[state].glyph}</span> {STEP_STATE_LABELS[state].label}
    </span>
  );
}

function RunStateBadge({ state }: { state: RunState }) {
  return <span className={`state-badge state-${RUN_STATE_BADGE[state]}`}>{RUN_STATE_LABELS[state]}</span>;
}

function Progress({ resolved, total }: { resolved: number; total: number }) {
  return (
    <div className="stack">
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={resolved}
        aria-label="Resolved Steps"
      >
        <span style={{ width: `${total === 0 ? 0 : Math.round((resolved / total) * 100)}%` }} />
      </div>
      <small className="muted">
        {resolved} of {total} Steps resolved
      </small>
    </div>
  );
}

type StepAction = { readonly to: StepState; readonly reason?: string };

function policyFor(step: RunStep, to: StepState): ReasonPolicy {
  if (to === 'SKIPPED') return step.skipReasonPolicy;
  if (to === 'NOT_APPLICABLE') return step.notApplicableReasonPolicy;
  return 'DISABLED';
}

/** Asks for a reason when the Step's policy allows or requires one (the server enforces the policy). */
function ReasonForm(props: { step: RunStep; to: StepState; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const required = policyFor(props.step, props.to) === 'REQUIRED';
  function submit(event: FormEvent) {
    event.preventDefault();
    props.onSubmit(reason);
  }
  return (
    <form onSubmit={submit} className="stack step-actions">
      <label>
        {props.to === 'SKIPPED' ? 'Why is it skipped?' : 'Why does it not apply?'} {required ? '(required)' : '(optional)'}
        <br />
        <textarea rows={2} maxLength={500} required={required} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="primary">
          {props.to === 'SKIPPED' ? 'Skip' : 'Mark not applicable'}
        </button>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function StepItem(props: {
  step: RunStep;
  canExecute: boolean;
  busy: boolean;
  /** Our change is on its way to the server; the shown state is not confirmed yet. */
  saving: boolean;
  /** Someone else changed this Step a moment ago. */
  remote: boolean;
  onChange: (action: StepAction) => void;
}) {
  const { step } = props;
  const busy = props.busy || props.saving;
  const [asking, setAsking] = useState<StepState | null>(null);
  const choose = (to: StepState) => {
    if (policyFor(step, to) === 'DISABLED') props.onChange({ to });
    else setAsking(to);
  };
  return (
    <li className="step" data-state={step.state} data-saving={props.saving} data-remote={props.remote}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="step-title">
          {step.icon !== null && (
            <>
              <Icon icon={step.icon} />{' '}
            </>
          )}
          {step.title}
        </span>
        <StateBadge state={step.state} />
      </div>
      <small className="muted">
        {step.required ? 'Required' : 'Optional'}
        {step.critical && ' · critical'}
      </small>
      {props.saving && (
        <div>
          <small>Saving…</small>
        </div>
      )}
      {!props.saving && step.stateChange !== null && (
        <div>
          <small>
            {step.state === 'PENDING' ? 'Reset' : STEP_STATE_LABELS[step.state].label} by {step.stateChange.by} at{' '}
            {new Date(step.stateChange.at).toLocaleString()}
            {step.stateChange.reason !== null && <> — reason: {step.stateChange.reason}</>}
          </small>
        </div>
      )}
      {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0 0' }}>{step.description}</p>}
      {props.canExecute && asking === null && (
        <div className="row step-actions">
          {step.state === 'PENDING' ? (
            <>
              {step.critical ? (
                <HoldToConfirm label={step.title} disabled={busy} onConfirm={() => props.onChange({ to: 'DONE' })} />
              ) : (
                <button type="button" className="done-action" disabled={busy} onClick={() => props.onChange({ to: 'DONE' })}>
                  ✔ Done: {step.title}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => choose('SKIPPED')}>
                Skip
              </button>
              <button type="button" disabled={busy} onClick={() => choose('NOT_APPLICABLE')}>
                Not applicable
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => props.onChange({ to: 'PENDING' })}>
              Undo: {step.title}
            </button>
          )}
        </div>
      )}
      {asking !== null && (
        <ReasonForm
          step={step}
          to={asking}
          onCancel={() => setAsking(null)}
          onSubmit={(reason) => {
            setAsking(null);
            props.onChange({ to: asking, reason });
          }}
        />
      )}
    </li>
  );
}

/** Required Steps that block completion (mirrors the server rule; the server decides). */
function openRequired(run: RunDetail): RunStep[] {
  return run.sections
    .flatMap((section) => section.steps)
    .filter((step) => step.required && step.state !== 'DONE' && step.state !== 'NOT_APPLICABLE');
}

function RunEndControls(props: {
  run: RunDetail;
  canExecute: boolean;
  canAbort: boolean;
  busy: boolean;
  onComplete: () => void;
  onAbort: (reason: string) => void;
}) {
  const [aborting, setAborting] = useState(false);
  const [reason, setReason] = useState('');
  const open = openRequired(props.run);
  return (
    <section aria-label="Finish this Run" className="card stack">
      <h3 style={{ marginTop: 0 }}>Finish this Run</h3>
      {props.canExecute && (
        <div className="stack">
          <button type="button" className="primary" disabled={props.busy || open.length > 0} onClick={props.onComplete}>
            Complete Run
          </button>
          {open.length > 0 && (
            <p className="muted">
              {open.length} required {open.length === 1 ? 'Step is' : 'Steps are'} still pending or skipped:{' '}
              {open.map((step) => step.title).join(', ')}
            </p>
          )}
        </div>
      )}
      {props.canAbort &&
        (aborting ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              props.onAbort(reason);
            }}
          >
            <label>
              Why is this Run aborted? (optional)
              <br />
              <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="row">
              <button type="submit" disabled={props.busy}>
                Abort Run
              </button>
              <button type="button" onClick={() => setAborting(false)}>
                Keep running
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="quiet" disabled={props.busy} onClick={() => setAborting(true)}>
            Abort Run…
          </button>
        ))}
    </section>
  );
}

const LIVE_STATUS_TEXT: Record<LiveStatus, string> = {
  connecting: 'Connecting live updates…',
  live: '● Live: changes by others appear automatically.',
  reconnecting: 'Connection lost — reconnecting. Changes will be loaded when it is back.',
  off: 'Live updates are off. Reload the page to see changes by others.',
};

function describeChange(run: RunDetail, change: AnnouncedChange): string {
  const time = new Date(change.at).toLocaleTimeString();
  if (change.kind === 'RUN_COMPLETED') return `${change.by} completed this Run at ${time}.`;
  if (change.kind === 'RUN_ABORTED') return `${change.by} aborted this Run at ${time}.`;
  const step = run.sections.flatMap((section) => section.steps).find((s) => s.id === change.stepId);
  return `${change.by} changed “${step?.title ?? 'a Step'}” at ${time}.`;
}

function RunView(props: {
  run: RunDetail;
  canExecute: boolean;
  canAbort: boolean;
  busy: boolean;
  saving: ReadonlySet<string>;
  live: LiveStatus;
  remoteChange: AnnouncedChange | null;
  onStep: (step: RunStep, action: StepAction) => void;
  onComplete: () => void;
  onAbort: (reason: string) => void;
  loadHistory: () => Promise<HistoryEvent[]>;
}) {
  const { run } = props;
  const canExecute = props.canExecute && run.state === 'ACTIVE';
  const steps = run.sections.flatMap((section) => section.steps);
  return (
    <article aria-labelledby="run-title">
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="run-title" style={{ margin: 0 }}>
            <Icon icon={run.icon} /> {run.title}
          </h2>
          <RunStateBadge state={run.state} />
        </div>
        <Progress resolved={steps.filter((step) => step.state !== 'PENDING').length} total={steps.length} />
        <p className="muted" style={{ margin: 0 }}>
          {RUN_STATE_LABELS[run.state]} · started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()} (Procedure revision{' '}
          {run.procedureRevision})
        </p>
        {run.ended !== null && (
          <p role="status">
            {RUN_STATE_LABELS[run.state]} by {run.ended.by} on {new Date(run.ended.at).toLocaleString()}
            {run.ended.reason !== null && <> — reason: {run.ended.reason}</>}. This Run is history and can no longer change.
          </p>
        )}
        {run.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.description}</p>}
        {run.state === 'ACTIVE' && <p className="live-status" style={{ margin: 0 }}>{LIVE_STATUS_TEXT[props.live]}</p>}
        <p role="status" className="live-status" style={{ margin: 0 }}>
          {props.remoteChange !== null && describeChange(run, props.remoteChange)}
        </p>
      </div>
      {run.sections.map((section) => (
        <section key={section.id} aria-label={`Run section: ${section.title}`}>
          <h3>{section.title}</h3>
          {section.description !== '' && <p className="muted">{section.description}</p>}
          <ol className="plain-list">
            {section.steps.map((step) => (
              <StepItem
                key={`${step.id}-${step.state}`}
                step={step}
                canExecute={canExecute}
                busy={props.busy}
                saving={props.saving.has(step.id)}
                remote={props.remoteChange?.stepId === step.id}
                onChange={(action) => props.onStep(step, action)}
              />
            ))}
          </ol>
        </section>
      ))}
      {run.state === 'ACTIVE' && (props.canExecute || props.canAbort) && (
        <div style={{ marginTop: '1.5rem' }}>
          <RunEndControls
            run={run}
            canExecute={props.canExecute}
            canAbort={props.canAbort}
            busy={props.busy || props.saving.size > 0}
            onComplete={props.onComplete}
            onAbort={props.onAbort}
          />
        </div>
      )}
      <div className="card">
        <History key={`${run.id}-${run.state}`} label="Run history" load={props.loadHistory} />
      </div>
    </article>
  );
}

function RunList({ title, runs, onOpen }: { title: string; runs: RunSummary[]; onOpen: (runId: string) => void }) {
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul aria-label={title} className="plain-list">
        {runs.map((run) => {
          const total = Object.values(run.stepCounts).reduce((sum, n) => sum + n, 0);
          return (
            <li key={run.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="link-like" onClick={() => onOpen(run.id)} style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                  <Icon icon={run.icon} /> {run.title}
                </button>
                <RunStateBadge state={run.state} />
              </div>
              <Progress resolved={total - run.stepCounts.PENDING} total={total} />
              <small className="muted">
                {RUN_STATE_LABELS[run.state]}, started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()}
              </small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Runs of a Workspace. `openRunId` comes from the URL. */
export function Runs(props: {
  workspaceId: string;
  canExecute: boolean;
  canAbort: boolean;
  canStart: boolean;
  openRunId: string | null;
  onOpen: (runId: string | null) => void;
}) {
  const { workspaceId, openRunId, onOpen } = props;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.runs(workspaceId).then(setRuns, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(refresh, [refresh, openRunId]);

  /** Canonical Run as last received from the server (never contains unconfirmed changes). */
  const detailRef = useRef<RunDetail | null>(null);
  const keepDetail = useCallback((next: RunDetail | null) => {
    detailRef.current = next;
    setDetail(next);
  }, []);
  // Keyed by Step id (UUIDs are unique across Runs), so switching Runs needs no reset.
  const [pending, setPending] = useState<ReadonlyMap<string, PendingStepChange>>(new Map());
  const [remote, setRemote] = useState<{ runId: string; change: AnnouncedChange } | null>(null);
  const remoteChange = remote !== null && remote.runId === openRunId ? remote.change : null;

  /** Takes over a fetched canonical Run; an older answer never replaces a newer state. */
  const accept = useCallback(
    (loaded: RunDetail) => {
      const current = detailRef.current;
      if (current === null || current.id !== loaded.id || loaded.revision >= current.revision) keepDetail(loaded);
    },
    [keepDetail],
  );
  const reload = useCallback(
    (runId: string) => api.run(workspaceId, runId).then(accept, (caught: unknown) => setMessage(messageFor(caught))),
    [workspaceId, accept],
  );

  useEffect(() => {
    if (openRunId === null) return;
    let active = true;
    api.run(workspaceId, openRunId).then(
      (loaded) => active && accept(loaded),
      (caught: unknown) => active && setMessage(messageFor(caught)),
    );
    return () => {
      active = false;
    };
  }, [workspaceId, openRunId, accept]);

  const canonical = detail !== null && detail.id === openRunId ? detail : null;
  const shown = canonical === null ? null : withPendingChanges(canonical, pending);
  const [busy, setBusy] = useState(false);

  const live = useRunLiveUpdates(
    canonical?.state === 'ACTIVE' ? `/api/workspaces/${encodeURIComponent(workspaceId)}/runs/${encodeURIComponent(canonical.id)}/events` : null,
    {
      onRevision: (revision, change) => {
        const current = detailRef.current;
        if (current === null || !isNewer(current, revision)) return;
        // Not yet contained in what we show: someone else changed the Run (or our own answer is still on its way).
        if (change !== null && !pending.has(change.stepId ?? '')) setRemote({ runId: current.id, change });
        void reload(current.id);
      },
      onClosed: () => {
        if (detailRef.current !== null) void reload(detailRef.current.id);
      },
    },
  );

  async function finish(run: RunDetail, action: () => Promise<RunDetail>) {
    setBusy(true);
    setMessage(null);
    try {
      keepDetail(await action());
    } catch (caught) {
      setMessage(messageFor(caught));
      if (caught instanceof ApiError) await reload(run.id);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Optimistic Step change (Step 6.2): the target state is shown immediately and marked as saving;
   * the server's answer replaces it, a rejection restores the canonical state and explains why.
   */
  async function changeStep(runId: string, stepId: string, action: StepAction) {
    const step = detailRef.current?.sections.flatMap((section) => section.steps).find((s) => s.id === stepId);
    if (step === undefined || pending.has(stepId)) return;
    const change: PendingStepChange = { from: step.state, to: action.to };
    setPending((current) => new Map(current).set(stepId, change));
    setMessage(null);
    setRemote(null);
    try {
      const result = await api.changeStepState(workspaceId, runId, stepId, {
        expectedState: change.from,
        state: change.to,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      });
      const current = detailRef.current;
      if (current !== null && current.id === runId) {
        const merged = applyStepResult(current, result.step, result.runRevision);
        keepDetail(merged.run);
        if (merged.stale) void reload(runId);
      }
    } catch (caught) {
      setMessage(`“${step.title}” was not changed: ${messageFor(caught)}`);
      // Show the canonical server state again (e.g. after someone else's change).
      await reload(runId);
    } finally {
      setPending((current) => {
        const next = new Map(current);
        next.delete(stepId);
        return next;
      });
    }
  }

  const active = runs?.filter((run) => run.state === 'ACTIVE') ?? [];
  const finished = runs?.filter((run) => run.state !== 'ACTIVE') ?? [];

  return (
    <section aria-label="Runs">
      {openRunId !== null ? (
        <>
          <p>
            <button type="button" className="link-like" onClick={() => onOpen(null)}>
              ← Back to all Runs
            </button>
          </p>
          {message !== null && <p role="alert">{message}</p>}
          {shown === null ? (
            <p>Loading…</p>
          ) : (
            <RunView
              run={shown}
              canExecute={props.canExecute}
              canAbort={props.canAbort}
              busy={busy}
              saving={new Set(pending.keys())}
              live={live}
              remoteChange={remoteChange}
              onStep={(step, action) => void changeStep(shown.id, step.id, action)}
              onComplete={() => void finish(shown, () => api.completeRun(workspaceId, shown.id))}
              onAbort={(reason) => void finish(shown, () => api.abortRun(workspaceId, shown.id, reason))}
              loadHistory={() => api.runHistory(workspaceId, shown.id)}
            />
          )}
        </>
      ) : (
        <>
          <div className="page-header">
            <h2>Runs</h2>
            {props.canStart && <span className="muted">Start a Run from a Procedure.</span>}
          </div>
          {message !== null && <p role="alert">{message}</p>}
          {runs === null ? (
            <p>Loading…</p>
          ) : runs.length === 0 ? (
            <p className="card">No Runs yet.</p>
          ) : (
            <>
              {active.length > 0 ? <RunList title="Active Runs" runs={active} onOpen={onOpen} /> : <p className="muted">No active Runs.</p>}
              {finished.length > 0 && <RunList title="Finished Runs" runs={finished} onOpen={onOpen} />}
            </>
          )}
        </>
      )}
    </section>
  );
}

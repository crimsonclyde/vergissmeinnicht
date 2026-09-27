import { useCallback, useEffect, useState, type FormEvent } from 'react';
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

/** Text (and a glyph) for every state: color is never the only indicator. */
const STEP_STATE_LABELS: Record<StepState, { glyph: string; label: string }> = {
  PENDING: { glyph: '○', label: 'Pending' },
  DONE: { glyph: '✔', label: 'Done' },
  SKIPPED: { glyph: '↷', label: 'Skipped' },
  NOT_APPLICABLE: { glyph: '–', label: 'Not applicable' },
};
const RUN_STATE_LABELS: Record<RunState, string> = { ACTIVE: 'Active', COMPLETED: 'Completed', ABORTED: 'Aborted' };

function progress(summary: RunSummary): string {
  const total = Object.values(summary.stepCounts).reduce((sum, n) => sum + n, 0);
  return `${total - summary.stepCounts.PENDING} of ${total} Steps resolved`;
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
    <form onSubmit={submit}>
      <label>
        {props.to === 'SKIPPED' ? 'Why is it skipped?' : 'Why does it not apply?'} {required ? '(required)' : '(optional)'}
        <br />
        <textarea rows={2} maxLength={500} required={required} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <br />
      <button type="submit">{props.to === 'SKIPPED' ? 'Skip' : 'Mark not applicable'}</button>{' '}
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

function StepItem(props: { step: RunStep; canExecute: boolean; busy: boolean; onChange: (action: StepAction) => void }) {
  const { step } = props;
  const [asking, setAsking] = useState<StepState | null>(null);
  const choose = (to: StepState) => {
    if (policyFor(step, to) === 'DISABLED') props.onChange({ to });
    else setAsking(to);
  };
  return (
    <li>
      <span aria-hidden="true">{STEP_STATE_LABELS[step.state].glyph}</span> <strong>{step.title}</strong> —{' '}
      {STEP_STATE_LABELS[step.state].label}
      {step.required ? '' : ' (optional)'}
      {step.critical && ', critical'}
      {step.stateChange !== null && (
        <>
          <br />
          <small>
            {step.state === 'PENDING' ? 'Reset' : STEP_STATE_LABELS[step.state].label} by {step.stateChange.by} at{' '}
            {new Date(step.stateChange.at).toLocaleString()}
            {step.stateChange.reason !== null && <> — reason: {step.stateChange.reason}</>}
          </small>
        </>
      )}
      {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{step.description}</p>}
      {props.canExecute && asking === null && (
        <p>
          {step.state === 'PENDING' ? (
            <>
              {step.critical ? (
                <HoldToConfirm label={`Done: ${step.title}`} disabled={props.busy} onConfirm={() => props.onChange({ to: 'DONE' })} />
              ) : (
                <button type="button" disabled={props.busy} onClick={() => props.onChange({ to: 'DONE' })}>
                  Done: {step.title}
                </button>
              )}{' '}
              <button type="button" disabled={props.busy} onClick={() => choose('SKIPPED')}>
                Skip
              </button>{' '}
              <button type="button" disabled={props.busy} onClick={() => choose('NOT_APPLICABLE')}>
                Not applicable
              </button>
            </>
          ) : (
            <button type="button" disabled={props.busy} onClick={() => props.onChange({ to: 'PENDING' })}>
              Undo: {step.title}
            </button>
          )}
        </p>
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

function RunEndControls(props: { run: RunDetail; canExecute: boolean; canAbort: boolean; busy: boolean; onComplete: () => void; onAbort: (reason: string) => void }) {
  const [aborting, setAborting] = useState(false);
  const [reason, setReason] = useState('');
  const open = openRequired(props.run);
  return (
    <section aria-label="Finish this Run">
      {props.canExecute && (
        <p>
          <button type="button" disabled={props.busy || open.length > 0} onClick={props.onComplete}>
            Complete Run
          </button>{' '}
          {open.length > 0 && (
            <small>
              {open.length} required {open.length === 1 ? 'Step is' : 'Steps are'} still pending or skipped:{' '}
              {open.map((step) => step.title).join(', ')}
            </small>
          )}
        </p>
      )}
      {props.canAbort &&
        (aborting ? (
          <form
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
            <br />
            <button type="submit" disabled={props.busy}>
              Abort Run
            </button>{' '}
            <button type="button" onClick={() => setAborting(false)}>
              Keep running
            </button>
          </form>
        ) : (
          <button type="button" disabled={props.busy} onClick={() => setAborting(true)}>
            Abort Run…
          </button>
        ))}
    </section>
  );
}

function RunView(props: {
  run: RunDetail;
  canExecute: boolean;
  canAbort: boolean;
  busy: boolean;
  onStep: (step: RunStep, action: StepAction) => void;
  onComplete: () => void;
  onAbort: (reason: string) => void;
  loadHistory: () => Promise<HistoryEvent[]>;
}) {
  const { run } = props;
  const canExecute = props.canExecute && run.state === 'ACTIVE';
  return (
    <article aria-labelledby="run-title">
      <h5 id="run-title">
        <Icon icon={run.icon} /> {run.title}
      </h5>
      <p>
        {RUN_STATE_LABELS[run.state]} · started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()} (Procedure
        revision {run.procedureRevision})
      </p>
      {run.ended !== null && (
        <p role="status">
          {RUN_STATE_LABELS[run.state]} by {run.ended.by} on {new Date(run.ended.at).toLocaleString()}
          {run.ended.reason !== null && <> — reason: {run.ended.reason}</>}. This Run is history and can no longer change.
        </p>
      )}
      {run.description !== '' && <p style={{ whiteSpace: 'pre-wrap' }}>{run.description}</p>}
      {run.sections.map((section) => (
        <section key={section.id} aria-label={`Run section: ${section.title}`}>
          <h6>{section.title}</h6>
          <ol>
            {section.steps.map((step) => (
              <StepItem
                key={`${step.id}-${step.state}`}
                step={step}
                canExecute={canExecute}
                busy={props.busy}
                onChange={(action) => props.onStep(step, action)}
              />
            ))}
          </ol>
        </section>
      ))}
      <History key={`${run.id}-${run.state}`} label="Run history" load={props.loadHistory} />
      {run.state === 'ACTIVE' && (props.canExecute || props.canAbort) && (
        <RunEndControls
          run={run}
          canExecute={props.canExecute}
          canAbort={props.canAbort}
          busy={props.busy}
          onComplete={props.onComplete}
          onAbort={props.onAbort}
        />
      )}
    </article>
  );
}

/** Runs of a Workspace. `openRunId` is controlled by the parent so other sections can open a Run. */
export function Runs(props: {
  workspaceId: string;
  canExecute: boolean;
  canAbort: boolean;
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

  useEffect(() => {
    if (openRunId === null) return;
    let active = true;
    api.run(workspaceId, openRunId).then(
      (loaded) => active && setDetail(loaded),
      (caught: unknown) => active && setMessage(messageFor(caught)),
    );
    return () => {
      active = false;
    };
  }, [workspaceId, openRunId]);

  const shown = detail !== null && detail.id === openRunId ? detail : null;
  const [busy, setBusy] = useState(false);

  async function finish(run: RunDetail, action: () => Promise<RunDetail>) {
    setBusy(true);
    setMessage(null);
    try {
      setDetail(await action());
    } catch (caught) {
      setMessage(messageFor(caught));
      if (caught instanceof ApiError) setDetail(await api.run(workspaceId, run.id));
    } finally {
      setBusy(false);
    }
  }

  async function changeStep(run: RunDetail, step: RunStep, action: StepAction) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.changeStepState(workspaceId, run.id, step.id, {
        expectedState: step.state,
        state: action.to,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      });
      setDetail({
        ...run,
        sections: run.sections.map((section) => ({
          ...section,
          steps: section.steps.map((s) => (s.id === result.step.id ? result.step : s)),
        })),
      });
    } catch (caught) {
      setMessage(messageFor(caught));
      // After a conflict (or any failure) show the canonical server state.
      if (caught instanceof ApiError) setDetail(await api.run(workspaceId, run.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="runs-heading">
      <h4 id="runs-heading">Runs</h4>
      {message !== null && <p role="alert">{message}</p>}
      {openRunId !== null ? (
        <>
          {shown === null ? (
            <p>Loading…</p>
          ) : (
            <RunView
              run={shown}
              canExecute={props.canExecute}
              canAbort={props.canAbort}
              busy={busy}
              onStep={(step, action) => void changeStep(shown, step, action)}
              onComplete={() => void finish(shown, () => api.completeRun(workspaceId, shown.id))}
              onAbort={(reason) => void finish(shown, () => api.abortRun(workspaceId, shown.id, reason))}
              loadHistory={() => api.runHistory(workspaceId, shown.id)}
            />
          )}
          <button type="button" onClick={() => onOpen(null)}>
            Back to all Runs
          </button>
        </>
      ) : runs === null ? (
        <p>Loading…</p>
      ) : runs.length === 0 ? (
        <p>No Runs yet.</p>
      ) : (
        <ul aria-label="Runs">
          {runs.map((run) => (
            <li key={run.id}>
              <button type="button" onClick={() => onOpen(run.id)}>
                <Icon icon={run.icon} /> {run.title}
              </button>{' '}
              — {RUN_STATE_LABELS[run.state]}, {progress(run)}, started by {run.startedBy} on {new Date(run.startedAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

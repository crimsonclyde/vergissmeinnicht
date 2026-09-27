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
import { KnotShare } from './Knots.tsx';
import { formatDateTime, formatTime, t } from './i18n/index.ts';
import { Icon } from './procedure-icons.tsx';
import { applyStepResult, isNewer, withPendingChanges, type PendingStepChange } from './run-updates.ts';
import { useRunLiveUpdates, type AnnouncedChange, type LiveStatus } from './useRunLiveUpdates.ts';

/** A glyph for every state, always next to its text: color is never the only indicator. */
const STATE_GLYPHS: Record<StepState, string> = { PENDING: '○', DONE: '✔', SKIPPED: '↷', NOT_APPLICABLE: '–' };
const RUN_STATE_BADGE: Record<RunState, StepState> = { ACTIVE: 'PENDING', COMPLETED: 'DONE', ABORTED: 'NOT_APPLICABLE' };

function StateBadge({ state }: { state: StepState }) {
  return (
    <span className={`state-badge state-${state}`}>
      <span aria-hidden="true">{STATE_GLYPHS[state]}</span> {t(`state.${state}`)}
    </span>
  );
}

function RunStateBadge({ state }: { state: RunState }) {
  return <span className={`state-badge state-${RUN_STATE_BADGE[state]}`}>{t(`runState.${state}`)}</span>;
}

const SUMMARY_ORDER: readonly StepState[] = ['DONE', 'SKIPPED', 'NOT_APPLICABLE', 'PENDING'];

/** "✔ 2 done · ↷ 1 skipped · ○ 3 pending": resolved states stay distinguishable at a glance (8.2). */
function StateSummary({ counts }: { counts: Readonly<Record<StepState, number>> }) {
  const parts = SUMMARY_ORDER.filter((state) => counts[state] > 0);
  return (
    <small className="state-summary">
      {parts.map((state, index) => (
        <span key={state} className={`state-text-${state}`}>
          {index > 0 && ' · '}
          <span aria-hidden="true">{STATE_GLYPHS[state]}</span> {t(`stateCount.${state}`, { count: counts[state] })}
        </span>
      ))}
    </small>
  );
}

function countStates(steps: readonly RunStep[]): Record<StepState, number> {
  const counts: Record<StepState, number> = { PENDING: 0, DONE: 0, SKIPPED: 0, NOT_APPLICABLE: 0 };
  for (const step of steps) counts[step.state] += 1;
  return counts;
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
        aria-label={t('run.progressLabel')}
      >
        <span style={{ width: `${total === 0 ? 0 : Math.round((resolved / total) * 100)}%` }} />
      </div>
      <small className="muted">{t('run.progress', { resolved, count: total })}</small>
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
        {t(props.to === 'SKIPPED' ? 'step.whySkipped' : 'step.whyNotApplicable')} {t(required ? 'common.required' : 'common.optional')}
        <br />
        <textarea rows={2} maxLength={500} required={required} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="primary">
          {t(props.to === 'SKIPPED' ? 'step.confirmSkip' : 'step.confirmNotApplicable')}
        </button>
        <button type="button" onClick={props.onCancel}>
          {t('common.cancel')}
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
  /** The first pending Step: what to do next. */
  next: boolean;
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
    <li
      id={stepElementId(step.id)}
      tabIndex={-1}
      className="step"
      data-state={step.state}
      data-saving={props.saving}
      data-remote={props.remote}
      data-next={props.next}
      aria-current={props.next ? 'step' : undefined}
    >
      {props.next && <span className="next-chip">{t('step.next')}</span>}
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
        {t(step.required ? 'step.required' : 'step.optional')}
        {step.critical && t('step.critical')}
      </small>
      {props.saving && (
        <div>
          <small>{t('step.saving')}</small>
        </div>
      )}
      {!props.saving && step.stateChange !== null && (
        <div>
          <small>
            {step.state === 'PENDING'
              ? t('step.resetBy', { name: step.stateChange.by, time: formatDateTime(step.stateChange.at) })
              : t('step.changedBy', { state: t(`state.${step.state}`), name: step.stateChange.by, time: formatDateTime(step.stateChange.at) })}
            {step.stateChange.reason !== null && t('step.reason', { reason: step.stateChange.reason })}
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
                  {t('step.done', { title: step.title })}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => choose('SKIPPED')}>
                {t('step.skip')}
              </button>
              <button type="button" disabled={busy} onClick={() => choose('NOT_APPLICABLE')}>
                {t('step.notApplicable')}
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => props.onChange({ to: 'PENDING' })}>
              {t('step.undo', { title: step.title })}
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

const stepElementId = (stepId: string) => `step-${stepId}`;

/** Brings a Step into view and moves keyboard focus to it (no smooth scrolling if the user prefers less motion). */
function goToStep(stepId: string) {
  const element = document.getElementById(stepElementId(stepId));
  if (element === null) return;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  element.focus({ preventScroll: true });
}

/**
 * Stays at the bottom of the screen while working through an active Run (thumb reach on phones):
 * progress and the next pending Step are always visible, so nothing has to be remembered.
 */
function RunDock({ steps, next }: { steps: readonly RunStep[]; next: RunStep | undefined }) {
  const resolved = steps.filter((step) => step.state !== 'PENDING').length;
  return (
    <div className="run-dock" role="region" aria-label={t('run.dockLabel')}>
      <strong>
        {next !== undefined
          ? t('run.dockNext', { resolved, total: steps.length, title: next.title })
          : t('run.dockNone', { resolved, total: steps.length })}
      </strong>
      {next !== undefined && (
        <button type="button" onClick={() => goToStep(next.id)}>
          {t('run.goToNext')}
        </button>
      )}
    </div>
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
    <section aria-label={t('finish.heading')} className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('finish.heading')}</h3>
      {props.canExecute && (
        <div className="stack">
          <button type="button" className="primary" disabled={props.busy || open.length > 0} onClick={props.onComplete}>
            {t('finish.complete')}
          </button>
          {open.length > 0 && (
            <p className="muted">{t('finish.openRequired', { count: open.length, titles: open.map((step) => step.title).join(', ') })}</p>
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
              {t('finish.abortReason')}
              <br />
              <textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="row">
              <button type="submit" disabled={props.busy}>
                {t('finish.abort')}
              </button>
              <button type="button" onClick={() => setAborting(false)}>
                {t('finish.keepRunning')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="quiet" disabled={props.busy} onClick={() => setAborting(true)}>
            {t('finish.abortStart')}
          </button>
        ))}
    </section>
  );
}

function describeChange(run: RunDetail, change: AnnouncedChange): string {
  const time = formatTime(change.at);
  if (change.kind === 'RUN_COMPLETED') return t('live.completed', { name: change.by, time });
  if (change.kind === 'RUN_ABORTED') return t('live.aborted', { name: change.by, time });
  const step = run.sections.flatMap((section) => section.steps).find((s) => s.id === change.stepId);
  return t('live.changed', { name: change.by, title: step?.title ?? t('live.aStep'), time });
}

function RunView(props: {
  run: RunDetail;
  canExecute: boolean;
  canAbort: boolean;
  canManageKnots: boolean;
  workspaceId: string;
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
  const next = run.state === 'ACTIVE' ? steps.find((step) => step.state === 'PENDING') : undefined;
  // Less clutter on demand; resolved Steps stay one click away (and undo stays possible).
  const [hideResolved, setHideResolved] = useState(false);
  const hiding = hideResolved && run.state === 'ACTIVE';
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
        <StateSummary counts={countStates(steps)} />
        <p className="muted" style={{ margin: 0 }}>
          {t('run.meta', {
            state: t(`runState.${run.state}`),
            name: run.startedBy,
            time: formatDateTime(run.startedAt),
            revision: run.procedureRevision,
          })}
        </p>
        {run.ended !== null && (
          <p role="status">
            {run.ended.reason === null
              ? t('run.ended', { state: t(`runState.${run.state}`), name: run.ended.by, time: formatDateTime(run.ended.at) })
              : t('run.endedWithReason', {
                  state: t(`runState.${run.state}`),
                  name: run.ended.by,
                  time: formatDateTime(run.ended.at),
                  reason: run.ended.reason,
                })}{' '}
            {t('run.history')}
          </p>
        )}
        {run.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{run.description}</p>}
        {run.state === 'ACTIVE' && <p className="live-status" style={{ margin: 0 }}>{t(`live.${props.live}`)}</p>}
        <p role="status" className="live-status" style={{ margin: 0 }}>
          {props.remoteChange !== null && describeChange(run, props.remoteChange)}
        </p>
      </div>
      {run.state === 'ACTIVE' && (
        <label className="row" style={{ fontWeight: 400 }}>
          <input type="checkbox" checked={hideResolved} onChange={(e) => setHideResolved(e.target.checked)} />
          {t('run.hideResolved')}
        </label>
      )}
      {run.sections.map((section) => {
        const visible = hiding ? section.steps.filter((step) => step.state === 'PENDING' || props.saving.has(step.id)) : section.steps;
        return (
        <section key={section.id} aria-label={t('run.sectionLabel', { title: section.title })}>
          <h3>{section.title}</h3>
          {section.description !== '' && <p className="muted">{section.description}</p>}
          {visible.length === 0 && <p className="muted">{t('run.sectionResolved')}</p>}
          <ol className="plain-list">
            {visible.map((step) => (
              <StepItem
                key={`${step.id}-${step.state}`}
                step={step}
                canExecute={canExecute}
                busy={props.busy}
                saving={props.saving.has(step.id)}
                remote={props.remoteChange?.stepId === step.id}
                next={next?.id === step.id}
                onChange={(action) => props.onStep(step, action)}
              />
            ))}
          </ol>
        </section>
        );
      })}
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
        <History key={`${run.id}-${run.state}`} label={t('run.historyLabel')} load={props.loadHistory} />
      </div>
      {run.state === 'ACTIVE' && <RunDock steps={steps} next={next} />}
      {props.canManageKnots && (
        <div style={{ marginBottom: '1rem' }}>
          <KnotShare key={run.id} workspaceId={props.workspaceId} target={{ type: 'RUN', id: run.id }} defaultLabel={run.title} />
        </div>
      )}
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
              <StateSummary counts={run.stepCounts} />
              <small className="muted">
                {t('runs.startedBy', { state: t(`runState.${run.state}`), name: run.startedBy, time: formatDateTime(run.startedAt) })}
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
  canManageKnots: boolean;
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
      setMessage(t('run.notChanged', { title: step.title, reason: messageFor(caught) }));
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
    <section aria-label={t('runs.heading')}>
      {openRunId !== null ? (
        <>
          <p>
            <button type="button" className="link-like" onClick={() => onOpen(null)}>
              {t('runs.back')}
            </button>
          </p>
          {message !== null && <p role="alert">{message}</p>}
          {shown === null ? (
            <p>{t('common.loading')}</p>
          ) : (
            <RunView
              run={shown}
              canExecute={props.canExecute}
              canAbort={props.canAbort}
              canManageKnots={props.canManageKnots}
              workspaceId={workspaceId}
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
            <h2>{t('runs.heading')}</h2>
            {props.canStart && <span className="muted">{t('runs.startHint')}</span>}
          </div>
          {message !== null && <p role="alert">{message}</p>}
          {runs === null ? (
            <p>{t('common.loading')}</p>
          ) : runs.length === 0 ? (
            <p className="card">{t('runs.none')}</p>
          ) : (
            <>
              {active.length > 0 ? (
                <RunList title={t('runs.active')} runs={active} onOpen={onOpen} />
              ) : (
                <p className="muted">{t('runs.noneActive')}</p>
              )}
              {finished.length > 0 && <RunList title={t('runs.finished')} runs={finished} onOpen={onOpen} />}
            </>
          )}
        </>
      )}
    </section>
  );
}

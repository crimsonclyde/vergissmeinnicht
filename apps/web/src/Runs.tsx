import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  ApiError,
  isNetworkError,
  messageFor,
  type HistoryPage,
  type ReasonPolicy,
  type RunDetail,
  type RunState,
  type RunStep,
  type RunSummary,
  type StepState,
} from './api.ts';
import { History } from './History.tsx';
import { HoldToConfirm } from './HoldToConfirm.tsx';
import { usePreferences } from './preferences.tsx';
import { TapToConfirm } from './TapToConfirm.tsx';
import { KnotShare } from './Knots.tsx';
import { formatDateTime, formatTime, formatWhen, t } from './i18n/index.ts';
import { AppIcon } from './procedure-icons.tsx';
import { StepImage } from './StepImage.tsx';
import { StepMarks } from './StepMarks.tsx';
import { applyStepResult, isNewer, withPendingChanges, type PendingStepChange } from './run-updates.ts';
import { useOffline } from './offline/OfflineProvider.tsx';
import { expectedStateFor, withQueuedChanges } from './offline/queue.ts';
import { offlineStore } from './offline/store.ts';
import { useRunLiveUpdates, type AnnouncedChange, type LiveStatus } from './useRunLiveUpdates.ts';

/** How long "Uma changed … at …" stays visible. */
const REMOTE_NOTICE_MS = 10_000;

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
        aria-valuetext={t('run.progress', { resolved, count: total })}
      >
        <span style={{ width: `${total === 0 ? 0 : Math.round((resolved / total) * 100)}%` }} />
      </div>
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
  workspaceId: string;
  /** Keeps the Step's photo on this device for offline use (active Runs, which are saved there too). */
  offlineUserId: string | undefined;
  canExecute: boolean;
  busy: boolean;
  /** Our change is on its way to the server; the shown state is not confirmed yet. */
  saving: boolean;
  /** Changed offline: saved on this device, not sent yet (8.5). */
  queued: boolean;
  /** Someone else changed this Step a moment ago. */
  remote: boolean;
  /** The first pending Step: what to do next. */
  next: boolean;
  onChange: (action: StepAction) => void;
}) {
  const { step } = props;
  const busy = props.busy || props.saving;
  const [asking, setAsking] = useState<StepState | null>(null);
  const { criticalConfirm } = usePreferences().preferences;
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
        {/* A heading per Step, so screen-reader users can jump from Step to Step. */}
        <h4 className="step-title">
          {step.icon !== null && (
            <>
              <AppIcon name={step.icon} />{' '}
            </>
          )}
          {step.title}
          <StepMarks required={step.required} critical={step.critical} />
        </h4>
        <StateBadge state={step.state} />
      </div>
      {props.saving && <small className="step-meta">{t('step.saving')}</small>}
      {props.queued && <small className="step-meta">{t('offline.queuedStep')}</small>}
      {/* Who and when for resolved Steps; the badge already says what. Undo details live in the history. */}
      {!props.saving && !props.queued && step.stateChange !== null && step.state !== 'PENDING' && (
        <small className="step-meta">
          {t('step.by', { name: step.stateChange.by, time: formatWhen(step.stateChange.at) })}
          {/* Offline change: the device clock is shown as such, next to the server time (8.5). */}
          {step.stateChange.deviceAt != null && t('step.deviceTime', { time: formatWhen(step.stateChange.deviceAt) })}
          {step.stateChange.reason !== null && t('step.reason', { reason: step.stateChange.reason })}
        </small>
      )}
      {step.description !== '' && <p style={{ whiteSpace: 'pre-wrap', margin: '0.5rem 0 0' }}>{step.description}</p>}
      {step.image != null && <StepImage workspaceId={props.workspaceId} image={step.image} offlineUserId={props.offlineUserId} />}
      {props.canExecute && asking === null && (
        <div className="row step-actions">
          {step.state === 'PENDING' ? (
            <>
              {step.critical ? (
                criticalConfirm === 'tap-confirm' ? (
                  <TapToConfirm label={step.title} disabled={busy} onConfirm={() => props.onChange({ to: 'DONE' })} />
                ) : (
                  <HoldToConfirm label={step.title} disabled={busy} onConfirm={() => props.onChange({ to: 'DONE' })} />
                )
              ) : (
                <button
                  type="button"
                  className="done-action"
                  disabled={busy}
                  aria-label={t('step.doneName', { title: step.title })}
                  onClick={() => props.onChange({ to: 'DONE' })}
                >
                  {t('step.doneShort')}
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
            <button
              type="button"
              disabled={busy}
              aria-label={t('step.undo', { title: step.title })}
              onClick={() => props.onChange({ to: 'PENDING' })}
            >
              {t('step.undoShort')}
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
  /** Completing/aborting needs the server: not offline, not while offline changes wait (8.5). */
  needsConnection: boolean;
  onComplete: () => void;
  onAbort: (reason: string) => void;
}) {
  const [aborting, setAborting] = useState(false);
  const [reason, setReason] = useState('');
  const open = openRequired(props.run);
  return (
    <section aria-label={t('finish.heading')} className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('finish.heading')}</h3>
      {props.needsConnection && <p className="muted">{t('offline.finishNeedsConnection')}</p>}
      {props.canExecute && (
        <div className="stack">
          <button type="button" className="primary" disabled={props.busy || props.needsConnection || open.length > 0} onClick={props.onComplete}>
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
              <button type="submit" disabled={props.busy || props.needsConnection}>
                {t('finish.abort')}
              </button>
              <button type="button" onClick={() => setAborting(false)}>
                {t('finish.keepRunning')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="quiet" disabled={props.busy || props.needsConnection} onClick={() => setAborting(true)}>
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
  /** Steps changed offline and not sent yet. */
  queued: ReadonlySet<string>;
  /** Set while the Run shown is the copy saved on this device (offline): when it was saved. */
  offlineCopy: string | null;
  needsConnection: boolean;
  live: LiveStatus;
  remoteChange: AnnouncedChange | null;
  onStep: (step: RunStep, action: StepAction) => void;
  onComplete: () => void;
  onAbort: (reason: string) => void;
  loadHistory: (after?: string) => Promise<HistoryPage>;
}) {
  const { run } = props;
  const { userId } = useOffline();
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
            <AppIcon name={run.icon} /> {run.title}
          </h2>
          <span className="row">
            {run.state === 'ACTIVE' && (
              <span className={`live-chip live-${props.live}`} title={t(`live.${props.live}`)} role="status">
                {t(`live.short.${props.live}`)}
              </span>
            )}
            <RunStateBadge state={run.state} />
          </span>
        </div>
        <Progress resolved={steps.filter((step) => step.state !== 'PENDING').length} total={steps.length} />
        <StateSummary counts={countStates(steps)} />
        <p className="muted" style={{ margin: 0 }}>
          {t('run.started', { name: run.startedBy, time: formatWhen(run.startedAt) })}
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
        {props.offlineCopy !== null && <p className="muted" style={{ margin: 0 }}>{t('offline.savedCopy', { time: formatWhen(props.offlineCopy) })}</p>}
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
                workspaceId={props.workspaceId}
                offlineUserId={run.state === 'ACTIVE' ? userId : undefined}
                canExecute={canExecute}
                busy={props.busy}
                saving={props.saving.has(step.id)}
                queued={props.queued.has(step.id)}
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
            needsConnection={props.needsConnection}
            onComplete={props.onComplete}
            onAbort={props.onAbort}
          />
        </div>
      )}
      {/* Execution first (13.17): history and sharing stay one tap away instead of competing with the Steps. */}
      <details className="more-actions run-more" open={run.state !== 'ACTIVE'}>
        <summary>{t(props.canManageKnots ? 'run.moreWithShare' : 'run.more')}</summary>
        <History key={`${run.id}-${run.state}`} label={t('run.historyLabel')} load={props.loadHistory} />
        {props.canManageKnots && <KnotShare key={run.id} workspaceId={props.workspaceId} target={{ type: 'RUN', id: run.id }} defaultLabel={run.title} />}
      </details>
      {run.state === 'ACTIVE' && <RunDock steps={steps} next={next} />}
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
                  <AppIcon name={run.icon} /> {run.title}
                </button>
                <RunStateBadge state={run.state} />
              </div>
              <Progress resolved={total - run.stepCounts.PENDING} total={total} />
              <StateSummary counts={run.stepCounts} />
              <small className="muted">
                {t('run.started', { name: run.startedBy, time: formatWhen(run.startedAt) })}
              </small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** List entry for a Run saved on this device (offline list, 8.5). */
export function summaryOf(run: RunDetail): RunSummary {
  const { sections, ...info } = run;
  return { ...info, stepCounts: countStates(sections.flatMap((section) => section.steps)) };
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
  /** Back to the Workspace Home (from an execution). */
  onHome: () => void;
}) {
  const { workspaceId, openRunId, onOpen } = props;
  const offline = useOffline();
  const { userId, queued, sentVersion, reportReachable, reportUnreachable } = offline;
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  /** The list shows the Runs saved on this device (offline). */
  const [listFromDevice, setListFromDevice] = useState(false);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  /** When the shown Run is the copy saved on this device: when it was saved. */
  const [offlineCopy, setOfflineCopy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.runs(workspaceId).then(
      (page) => {
        setRuns(page.runs);
        setNextCursor(page.nextCursor);
        setListFromDevice(false);
        reportReachable();
      },
      async (caught: unknown) => {
        if (!isNetworkError(caught)) {
          setMessage(messageFor(caught));
          return;
        }
        reportUnreachable();
        const saved = await offlineStore.listRuns(userId, workspaceId);
        setRuns(saved.map((entry) => summaryOf(entry.run)));
        setNextCursor(null);
        setListFromDevice(true);
      },
    );
  }, [workspaceId, userId, reportReachable, reportUnreachable]);
  const [loadingMore, setLoadingMore] = useState(false);
  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await api.runs(workspaceId, { before: nextCursor });
      setRuns((current) => [...(current ?? []), ...page.runs]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setLoadingMore(false);
    }
  }
  // The list is only shown on the history page; an open execution loads just itself.
  useEffect(() => {
    if (openRunId === null) refresh();
  }, [refresh, openRunId]);

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
  // The notice (and the outline of the changed Step) fades after a while: less to read later on.
  useEffect(() => {
    if (remote === null) return;
    const timer = setTimeout(() => setRemote(null), REMOTE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [remote]);

  /**
   * Takes over a fetched canonical Run; an older answer never replaces a newer state. Active Runs are
   * saved on this device for offline use (8.5); finished ones are removed from it.
   */
  const accept = useCallback(
    (loaded: RunDetail) => {
      const current = detailRef.current;
      if (current === null || current.id !== loaded.id || loaded.revision >= current.revision) keepDetail(loaded);
      setOfflineCopy(null);
      reportReachable();
      if (loaded.state === 'ACTIVE') void offlineStore.saveRun(userId, workspaceId, loaded);
      else void offlineStore.deleteRun(userId, loaded.id);
    },
    [keepDetail, userId, workspaceId, reportReachable],
  );
  /** Loads the Run; when the server cannot be reached, shows the copy saved on this device instead. */
  const load = useCallback(
    (runId: string, isActive: () => boolean = () => true) =>
      api.run(workspaceId, runId).then(
        (loaded) => {
          if (isActive()) accept(loaded);
        },
        async (caught: unknown) => {
          if (!isActive()) return;
          if (!isNetworkError(caught)) {
            setMessage(messageFor(caught));
            return;
          }
          reportUnreachable();
          const saved = await offlineStore.loadRun(userId, workspaceId, runId);
          if (!isActive()) return;
          if (saved === undefined) {
            setMessage(t('offline.runNotSaved'));
            return;
          }
          if (detailRef.current === null || detailRef.current.id !== runId) keepDetail(saved.run);
          setOfflineCopy(saved.savedAt);
        },
      ),
    [workspaceId, userId, accept, keepDetail, reportUnreachable],
  );
  const reload = useCallback((runId: string) => load(runId), [load]);

  useEffect(() => {
    if (openRunId === null) return;
    let active = true;
    void load(openRunId, () => active);
    return () => {
      active = false;
    };
  }, [openRunId, load]);

  // Queued offline changes were sent: show the canonical state (incl. others' changes meanwhile).
  useEffect(() => {
    if (sentVersion > 0 && detailRef.current !== null) void load(detailRef.current.id);
  }, [sentVersion, load]);

  const canonical = detail !== null && detail.id === openRunId ? detail : null;
  const queuedHere = canonical === null ? [] : queued.filter((change) => change.runId === canonical.id);
  const shown = canonical === null ? null : withQueuedChanges(withPendingChanges(canonical, pending), queuedHere);
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
    const waiting = queued.filter((change) => change.runId === runId);
    const from = expectedStateFor(step, waiting);
    setMessage(null);
    setRemote(null);

    /** Offline (8.5): kept on this device and sent later, strictly after earlier queued changes. */
    const queue = async () => {
      const stored = await offline.enqueue({
        workspaceId,
        runId,
        stepId,
        stepTitle: step.title,
        expectedState: from,
        to: action.to,
        reason: action.reason,
      });
      if (!stored) setMessage(t('offline.cannotSave', { title: step.title }));
    };
    if (!offline.online || waiting.length > 0) {
      await queue();
      return;
    }

    const change: PendingStepChange = { from, to: action.to };
    setPending((current) => new Map(current).set(stepId, change));
    try {
      const result = await api.changeStepState(workspaceId, runId, stepId, {
        expectedState: change.from,
        state: change.to,
        ...(action.reason === undefined ? {} : { reason: action.reason }),
      });
      const current = detailRef.current;
      if (current !== null && current.id === runId) {
        const merged = applyStepResult(current, result.step, result.runRevision);
        accept(merged.run);
        if (merged.stale) void reload(runId);
      }
    } catch (caught) {
      if (isNetworkError(caught)) {
        // The connection dropped on the way (e.g. the router was just switched off): keep the change.
        reportUnreachable();
        await queue();
      } else {
        setMessage(t('run.notChanged', { title: step.title, reason: messageFor(caught) }));
        // Show the canonical server state again (e.g. after someone else's change).
        await reload(runId);
      }
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
            <button type="button" className="link-like" onClick={props.onHome}>
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
              queued={new Set(queuedHere.map((change) => change.stepId))}
              offlineCopy={offlineCopy}
              needsConnection={!offline.online || queuedHere.length > 0}
              live={live}
              remoteChange={remoteChange}
              onStep={(step, action) => void changeStep(shown.id, step.id, action)}
              onComplete={() => void finish(shown, () => api.completeRun(workspaceId, shown.id))}
              onAbort={(reason) => void finish(shown, () => api.abortRun(workspaceId, shown.id, reason))}
              loadHistory={(after) => api.runHistory(workspaceId, shown.id, after)}
            />
          )}
        </>
      ) : (
        <>
          <div className="page-header">
            <h2>{t('runs.heading')}</h2>
          </div>
          {message !== null && <p role="alert">{message}</p>}
          {listFromDevice && <p className="muted">{t('offline.historyNeedsConnection')}</p>}
          {runs === null ? (
            <p>{t('common.loading')}</p>
          ) : finished.length === 0 && !listFromDevice ? (
            <p className="card">{t('runs.none')}</p>
          ) : (
            <>
              {active.length > 0 && (
                <p className="muted">
                  {t('runs.activeOnHome', { count: active.length })}{' '}
                  <button type="button" className="link-like" onClick={props.onHome}>
                    {t('runs.toHome')}
                  </button>
                </p>
              )}
              {finished.length > 0 && <RunList title={t('runs.finished')} runs={finished} onOpen={onOpen} />}
              {nextCursor !== null && (
                <button type="button" className="quiet" disabled={loadingMore} onClick={() => void loadMore()}>
                  {t('runs.showOlder')}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

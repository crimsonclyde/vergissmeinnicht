import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RunDetail, RunSection, RunStep, StepState } from './api.ts';
import { HoldToConfirm } from './HoldToConfirm.tsx';
import { formatWhen, t } from './i18n/index.ts';
import { usePreferences } from './preferences.tsx';
import { AppIcon, sectionIcon } from './procedure-icons.tsx';
import { ReasonForm, StateBadge, policyFor, type StepAction } from './Runs.tsx';
import { StepImage } from './StepImage.tsx';
import { StepMarks } from './StepMarks.tsx';
import { TapToConfirm } from './TapToConfirm.tsx';
import { UiIcon } from './ui-icons.tsx';

/**
 * The guided Run (22.2): the Sections as tiles, then the Steps of one Section one at a time, with a little
 * celebration when a Step is resolved. Presentation only — every change goes through the same `onStep` as the
 * list, and the server decides as before.
 */

/** Short encouragements after a resolved Step, in turn. */
const CHEERS = ['guide.cheer.1', 'guide.cheer.2', 'guide.cheer.3', 'guide.cheer.4'] as const;

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** A short buzz on phones that allow it (Android; iPhones do not). Never required, never an error. */
function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export const resolvedCount = (steps: readonly RunStep[]): number => steps.filter((step) => step.state !== 'PENDING').length;

/** The next pending Step after `from` (wrapping round), or -1 when nothing is pending. */
export function nextPendingIndex(steps: readonly RunStep[], from: number): number {
  for (let offset = 1; offset <= steps.length; offset += 1) {
    const index = (from + offset) % steps.length;
    if (steps[index]?.state === 'PENDING') return index;
  }
  return -1;
}

/** The first Section with a pending Step, starting after `afterId` (wrapping round). */
export function nextOpenSection(sections: readonly RunSection[], afterId: string | null): RunSection | undefined {
  const start = afterId === null ? -1 : sections.findIndex((section) => section.id === afterId);
  for (let offset = 1; offset <= sections.length; offset += 1) {
    const section = sections[(start + offset + sections.length) % sections.length];
    if (section !== undefined && section.id !== afterId && section.steps.some((step) => step.state === 'PENDING')) return section;
  }
  return undefined;
}

/**
 * The lit part of a moon for a share between 0 and 1, waxing from the right: a thin crescent, half, then
 * gibbous, then full. The outer edge is the right half of the disc; the terminator is half an ellipse.
 */
export function moonPath(cx: number, cy: number, r: number, share: number): string {
  const lit = Math.min(1, Math.max(0, share));
  if (lit <= 0) return '';
  if (lit >= 1) return `M${cx} ${cy - r}A${r} ${r} 0 1 1 ${cx} ${cy + r}A${r} ${r} 0 1 1 ${cx} ${cy - r}Z`;
  const rx = Math.abs(1 - 2 * lit) * r;
  return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx} ${r} 0 0 ${lit < 0.5 ? 0 : 1} ${cx} ${cy - r}Z`;
}

/** A progress ring; the numbers in the middle say the same as the ring (colour is never the only sign). */
export function Ring(props: { done: number; total: number; size?: number; label?: string; children?: ReactNode }) {
  const size = props.size ?? 56;
  const stroke = Math.max(4, Math.round(size / 10));
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const share = props.total === 0 ? 0 : props.done / props.total;
  const complete = props.total > 0 && props.done >= props.total;
  return (
    <span className="ring" data-complete={complete} style={{ width: size, height: size }} role="img" aria-label={props.label ?? t('guide.ringLabel', { done: props.done, total: props.total })}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        {/* The moon (drawn only by themes that want it, Witch Forest): the dark disc, and the lit part growing with progress. */}
        <circle className="ring-moon-disc" cx={size / 2} cy={size / 2} r={size / 2 - 1.5} />
        <path className="ring-moon-lit" d={moonPath(size / 2, size / 2, size / 2 - 1.5, share)} />
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - share)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-center" aria-hidden="true">
        {props.children ?? (complete ? <UiIcon name="check" size="1.4em" /> : `${props.done}/${props.total}`)}
      </span>
    </span>
  );
}

/**
 * Shared paint for the rings, referenced from the stylesheet only by themes that want it (Tokyo Nights:
 * `stroke: url(#vmn-neon-ring)`). The colours are theme tokens; other themes never reference it.
 */
export function RingPaint() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <linearGradient id="vmn-neon-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--neon-a, var(--state-done))' }} />
          <stop offset="0.5" style={{ stopColor: 'var(--neon-c, var(--state-done))' }} />
          <stop offset="1" style={{ stopColor: 'var(--neon-b, var(--state-done))' }} />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** A few falling pieces for a finished Section or Run; nothing at all when less motion is asked for. */
export function Confetti() {
  if (reducedMotion()) return null;
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => (
        <span key={index} style={{ left: `${(index * 37) % 100}%`, animationDelay: `${(index % 5) * 70}ms` }} />
      ))}
    </span>
  );
}

/** The Sections of a Run as tiles (22.2): icon, title, how far it is, a check when finished. */
export function SectionTiles(props: { run: RunDetail; onOpen: (sectionId: string) => void }) {
  const next = props.run.state === 'ACTIVE' ? nextOpenSection(props.run.sections, null) : undefined;
  return (
    <ul className="plain-list guide-tiles" aria-label={t('guide.sections')}>
      {props.run.sections.map((section) => {
        const done = resolvedCount(section.steps);
        const total = section.steps.length;
        const finished = total > 0 && done === total;
        return (
          <li key={section.id}>
            <button type="button" className="guide-tile" data-finished={finished} data-next={next?.id === section.id} onClick={() => props.onOpen(section.id)}>
              <span className="guide-tile-icon">
                <AppIcon name={sectionIcon(section)} decorative size="1.7em" />
              </span>
              <span className="guide-tile-text">
                <strong>{section.title}</strong>
              </span>
              <Ring done={done} total={total} size={40} label={t('guide.sectionRing', { title: section.title, done, total })} />
              {next?.id === section.id && <span className="next-chip guide-next">{t('step.next')}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Done, or the confirmation for a critical Step, as one large button. */
function MainAction(props: { step: RunStep; disabled: boolean; onDone: () => void }) {
  const { criticalConfirm } = usePreferences().preferences;
  if (props.step.critical) {
    return criticalConfirm === 'tap-confirm' ? (
      <TapToConfirm label={props.step.title} disabled={props.disabled} onConfirm={props.onDone} />
    ) : (
      <HoldToConfirm label={props.step.title} disabled={props.disabled} onConfirm={props.onDone} />
    );
  }
  return (
    <button type="button" className="done-action guide-done" disabled={props.disabled} aria-label={t('step.doneName', { title: props.step.title })} onClick={props.onDone}>
      <UiIcon name="check" size="1.3em" /> {t('guide.done')}
    </button>
  );
}

const STATE_ICON: Record<Exclude<StepState, 'PENDING'>, 'check' | 'skip' | 'notApplicable'> = { DONE: 'check', SKIPPED: 'skip', NOT_APPLICABLE: 'notApplicable' };

/**
 * One Section, one Step at a time (22.2). After a Step is resolved here, a short cheer shows and the next
 * pending Step of the Section follows by itself; when none is left, the Section's finish screen appears.
 */
export function SectionGuide(props: {
  run: RunDetail;
  section: RunSection;
  workspaceId: string;
  offlineUserId: string | undefined;
  canExecute: boolean;
  busy: boolean;
  saving: ReadonlySet<string>;
  queued: ReadonlySet<string>;
  /** The Run has more than one Section (there is a Sections view to go back to). */
  hasOverview: boolean;
  /** Shown on the finish screen when nothing required is open any more (Complete / Abort). */
  finish: ReactNode;
  /** Nothing required is open: the Run can be completed. */
  canFinish: boolean;
  liveNotice: ReactNode;
  onStep: (step: RunStep, action: StepAction) => void;
  onBack: () => void;
  onOpenSection: (sectionId: string) => void;
  onList: () => void;
}) {
  const { section } = props;
  const steps = section.steps;
  const [index, setIndex] = useState(() => {
    const first = steps.findIndex((step) => step.state === 'PENDING');
    return first === -1 ? 0 : first;
  });
  const [cheer, setCheer] = useState<{ stepId: string; text: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [asking, setAsking] = useState<StepState | null>(null);
  const cheers = useRef(0);
  const latest = useRef(steps);
  useEffect(() => {
    latest.current = steps;
  }, [steps]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const cardRef = useRef<HTMLElement | null>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const position = Math.min(index, steps.length - 1);
  const done = resolvedCount(steps);
  const nextSection = nextOpenSection(props.run.sections, section.id);

  const go = (to: number) => {
    setAsking(null);
    setCheer(null);
    setIndex(to);
    // Keep the keyboard and screen-reader position on the new Step.
    window.requestAnimationFrame(() => cardRef.current?.focus({ preventScroll: true }));
  };

  /** Resolve the shown Step, cheer, then move on (to the next pending Step, or the Section's finish screen). */
  const act = (target: RunStep, action: StepAction) => {
    setAsking(null);
    props.onStep(target, action);
    if (action.to === 'PENDING') return;
    const text = t(CHEERS[cheers.current % CHEERS.length] ?? 'guide.cheer.1');
    cheers.current += 1;
    setCheer({ stepId: target.id, text });
    buzz(action.to === 'DONE' ? 30 : 15);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        timer.current = null;
        setCheer(null);
        const current = latest.current;
        const from = current.findIndex((each) => each.id === target.id);
        const next = nextPendingIndex(current, from === -1 ? 0 : from);
        if (next === -1) {
          setFinished(true);
          buzz([40, 60, 40]);
        } else go(next);
      },
      reducedMotion() ? 450 : 1000,
    );
  };

  const choose = (target: RunStep, to: StepState) => {
    if (policyFor(target, to) === 'DISABLED') act(target, { to });
    else setAsking(to);
  };

  const backLabel = props.hasOverview ? t('guide.backToSections') : t('runs.back');
  const header = (
    <div className="guide-head">
      <button type="button" className="icon-button" aria-label={backLabel} title={backLabel} onClick={props.onBack}>
        <UiIcon name="back" />
      </button>
      <h2 className="guide-head-title">
        <AppIcon name={sectionIcon(section)} decorative />
        <strong>{section.title}</strong>
      </h2>
      <span className="guide-head-count" aria-hidden="true">
        {done}/{steps.length}
      </span>
      <button type="button" className="icon-button" aria-label={t('guide.showList')} title={t('guide.showList')} onClick={props.onList}>
        <UiIcon name="lists" />
      </button>
    </div>
  );
  const bar = (
    <div
      className="progress guide-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={steps.length}
      aria-valuenow={done}
      aria-label={t('run.progressLabel')}
      aria-valuetext={t('run.progress', { resolved: done, count: steps.length })}
    >
      <span style={{ width: `${steps.length === 0 ? 0 : Math.round((done / steps.length) * 100)}%` }} />
    </div>
  );

  if (step === undefined) {
    return (
      <section className="guide" aria-label={t('run.sectionLabel', { title: section.title })}>
        {header}
        <p className="card muted">{t('guide.emptySection')}</p>
      </section>
    );
  }

  if (finished && done === steps.length) {
    return (
      <section className="guide" aria-label={t('run.sectionLabel', { title: section.title })}>
        {header}
        {bar}
        <div className="card guide-finish" role="status">
          <Confetti />
          <Ring done={done} total={steps.length} size={96} />
          <h3>{nextSection === undefined && props.canFinish ? t('guide.allDone') : t('guide.sectionDone', { title: section.title })}</h3>
          {nextSection !== undefined ? (
            <button type="button" className="primary guide-big" onClick={() => props.onOpenSection(nextSection.id)}>
              <AppIcon name={sectionIcon(nextSection)} decorative /> {t('guide.nextSection', { title: nextSection.title })}
            </button>
          ) : (
            props.finish
          )}
          <div className="row guide-finish-more">
            {props.hasOverview && (
              <button type="button" className="quiet" onClick={props.onBack}>
                <UiIcon name="grid" /> {t('guide.sections')}
              </button>
            )}
            <button type="button" className="quiet" onClick={() => { setFinished(false); go(0); }}>
              <UiIcon name="undo" /> {t('guide.review')}
            </button>
          </div>
        </div>
        {props.liveNotice}
      </section>
    );
  }

  const saving = props.saving.has(step.id);
  const busy = props.busy || saving;
  const cheering = cheer?.stepId === step.id;
  return (
    <section className="guide" aria-label={t('run.sectionLabel', { title: section.title })}>
      {header}
      {bar}
      <article ref={cardRef} tabIndex={-1} className="card guide-card" data-state={step.state} data-cheer={cheering} aria-labelledby={`guide-step-${step.id}`}>
        <p className="guide-count">{t('guide.stepOf', { number: position + 1, total: steps.length })}</p>
        <span className="guide-step-icon">
          <AppIcon name={step.icon ?? sectionIcon(section)} decorative size="2em" />
        </span>
        <h3 id={`guide-step-${step.id}`} className="guide-step-title">
          {step.title}
          <StepMarks required={step.required} critical={step.critical} />
        </h3>
        {step.state !== 'PENDING' && !cheering && (
          <p className="guide-resolved">
            <StateBadge state={step.state} />
            {step.stateChange !== null && (
              <small className="muted">
                {t('step.by', { name: step.stateChange.by, time: formatWhen(step.stateChange.at) })}
                {step.stateChange.reason !== null && t('step.reason', { reason: step.stateChange.reason })}
              </small>
            )}
          </p>
        )}
        {props.queued.has(step.id) && <small className="muted">{t('offline.queuedStep')}</small>}
        {step.description !== '' && <p className="guide-description">{step.description}</p>}
        {step.image != null && <StepImage workspaceId={props.workspaceId} image={step.image} offlineUserId={props.offlineUserId} />}
        {cheering && (
          <div className="guide-cheer" role="status">
            <span className="guide-cheer-mark" data-state={step.state}>
              <UiIcon name={step.state === 'PENDING' ? 'check' : STATE_ICON[step.state]} size="2.2em" />
            </span>
            <strong>{cheer.text}</strong>
          </div>
        )}
        {props.canExecute && !cheering && asking === null && (
          <div className="guide-actions">
            {step.state === 'PENDING' ? (
              <>
                <MainAction step={step} disabled={busy} onDone={() => act(step, { to: 'DONE' })} />
                <div className="guide-secondary">
                  <button type="button" className="step-secondary" disabled={busy} onClick={() => choose(step, 'SKIPPED')}>
                    <UiIcon name="skip" /> {t('step.skip')}
                  </button>
                  <button type="button" className="step-secondary" disabled={busy} onClick={() => choose(step, 'NOT_APPLICABLE')}>
                    <UiIcon name="notApplicable" /> {t('step.notApplicable')}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="quiet" disabled={busy} aria-label={t('step.undo', { title: step.title })} onClick={() => act(step, { to: 'PENDING' })}>
                <UiIcon name="undo" /> {t('step.undoShort')}
              </button>
            )}
          </div>
        )}
        {asking !== null && <ReasonForm step={step} to={asking} onCancel={() => setAsking(null)} onSubmit={(reason) => act(step, { to: asking, reason })} />}
      </article>
      {props.liveNotice}
      <nav className="guide-nav" aria-label={t('guide.stepsNav')}>
        <button type="button" className="icon-button" disabled={position === 0} aria-label={t('guide.previous')} title={t('guide.previous')} onClick={() => go(position - 1)}>
          <UiIcon name="back" />
        </button>
        <ol className="plain-list guide-dots">
          {steps.map((each, dot) => (
            <li key={each.id}>
              <button
                type="button"
                className="guide-dot"
                data-state={each.state}
                aria-current={dot === position ? 'step' : undefined}
                aria-label={t('guide.dot', { number: dot + 1, title: each.title, state: t(`state.${each.state}`) })}
                onClick={() => go(dot)}
              />
            </li>
          ))}
        </ol>
        {position < steps.length - 1 ? (
          <button type="button" className="icon-button" aria-label={t('guide.next')} title={t('guide.next')} onClick={() => go(position + 1)}>
            <UiIcon name="forward" />
          </button>
        ) : (
          <button type="button" className="icon-button" disabled={done < steps.length} aria-label={t('guide.finishSection')} title={t('guide.finishSection')} onClick={() => setFinished(true)}>
            <UiIcon name="check" />
          </button>
        )}
      </nav>
    </section>
  );
}

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** How long a critical Step's confirmation must be held. */
export const HOLD_DURATION_MS = 1000;
const TICK_MS = 30;

/**
 * Press-and-hold confirmation for critical Steps (Step 5.3). Works with pointer and touch (hold the
 * button) and keyboard (hold Space or Enter). The whole button fills while held; releasing early
 * cancels and says so, a plain click explains what to do. UX protection against accidental taps
 * only — the server validates every transition.
 */
export function HoldToConfirm(props: { label: string; disabled?: boolean; onConfirm: () => void }) {
  const hintId = useId();
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The click that follows a completed hold must not show the "press and hold" hint.
  const confirmed = useRef(false);
  const { onConfirm } = props;

  const clear = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    startedAt.current = null;
    setProgress(0);
  };

  /** Released before the time was up. */
  const cancel = () => {
    if (startedAt.current !== null) setHint('Keep holding until the button is completely filled.');
    clear();
  };

  const start = () => {
    if (props.disabled || startedAt.current !== null) return;
    setHint(null);
    confirmed.current = false;
    startedAt.current = Date.now();
    timer.current = setInterval(() => {
      if (startedAt.current === null) return;
      const value = Math.min(1, (Date.now() - startedAt.current) / HOLD_DURATION_MS);
      if (value >= 1) {
        clear();
        confirmed.current = true;
        onConfirm();
      } else {
        setProgress(value);
      }
    }, TICK_MS);
  };

  // Never leave a running timer behind (e.g. the Step re-renders as resolved).
  useEffect(
    () => () => {
      if (timer.current !== null) clearInterval(timer.current);
    },
    [],
  );

  const isHoldKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';

  return (
    <span className="stack">
      <button
        type="button"
        className="hold"
        disabled={props.disabled}
        // Stable accessible name; the visible text changes while holding.
        aria-label={`Hold to mark done: ${props.label}`}
        aria-describedby={hintId}
        // A normal click (also fired by Enter/Space) never confirms on its own.
        onClick={(event) => {
          event.preventDefault();
          if (!confirmed.current && startedAt.current === null && progress === 0 && hint === null) {
            setHint('Press and hold this button for one second.');
          }
        }}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!isHoldKey(event)) return;
          event.preventDefault();
          if (!event.repeat) start();
        }}
        onKeyUp={(event) => {
          if (isHoldKey(event)) cancel();
        }}
        onBlur={clear}
      >
        <span className="hold-fill" aria-hidden="true" style={{ width: `${Math.round(progress * 100)}%` }} />
        <span className="hold-label">
          {progress > 0 ? `Keep holding… ${Math.round(progress * 100)} %` : `✔ Hold to mark done: ${props.label}`}
        </span>
      </button>
      <small id={hintId} className="muted" style={{ display: 'block' }}>
        {hint ?? 'Critical step — press and hold for one second.'}
      </small>
    </span>
  );
}

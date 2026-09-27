import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** How long a critical Step's confirmation must be held. */
export const HOLD_DURATION_MS = 1200;
const TICK_MS = 50;

/**
 * Press-and-hold confirmation for critical Steps (Step 5.3). Works with pointer and touch (hold the
 * button) and keyboard (hold Space or Enter). Releasing early cancels; a plain click does nothing.
 * This is UX protection against accidental taps only — the server validates every transition.
 */
export function HoldToConfirm(props: { label: string; disabled?: boolean; onConfirm: () => void }) {
  const hintId = useId();
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const { onConfirm } = props;

  const stop = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    startedAt.current = null;
    setProgress(0);
  };

  const start = () => {
    if (props.disabled || startedAt.current !== null) return;
    startedAt.current = Date.now();
    timer.current = setInterval(() => {
      if (startedAt.current === null) return;
      const value = Math.min(1, (Date.now() - startedAt.current) / HOLD_DURATION_MS);
      if (value >= 1) {
        stop();
        onConfirm();
      } else {
        setProgress(value);
      }
    }, TICK_MS);
  };

  // Never leave a running timer behind (e.g. the Step re-renders as resolved).
  useEffect(() => () => {
    if (timer.current !== null) clearInterval(timer.current);
  }, []);

  const isHoldKey = (event: KeyboardEvent) => event.key === ' ' || event.key === 'Enter';

  return (
    <span>
      <button
        type="button"
        disabled={props.disabled}
        aria-describedby={hintId}
        style={{ position: 'relative', userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
        // The normal click (also fired by Enter/Space) must not confirm on its own.
        onClick={(event) => event.preventDefault()}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start();
        }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!isHoldKey(event)) return;
          event.preventDefault();
          if (!event.repeat) start();
        }}
        onKeyUp={(event) => {
          if (isHoldKey(event)) stop();
        }}
        onBlur={stop}
      >
        {props.label}
        {progress > 0 && ` — hold… ${Math.round(progress * 100)} %`}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: '3px',
            width: `${Math.round(progress * 100)}%`,
            background: 'currentColor',
          }}
        />
      </button>{' '}
      <small id={hintId}>Critical step: press and hold for {HOLD_DURATION_MS / 1000} seconds to confirm.</small>
    </span>
  );
}

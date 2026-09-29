import { useEffect, useId, useRef, useState } from 'react';

export interface MoreMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  /** Destructive (e.g. Delete): shown last and marked. */
  readonly danger?: boolean;
}

/**
 * "⋯" for secondary actions (13.15): a disclosure with ordinary buttons (reachable with Tab), not an
 * ARIA menu. Escape or a click outside closes it; focus returns to the button. Callers pass only the
 * actions the person may use — unavailable ones are left out, not shown disabled. UI only: the
 * server authorizes every request.
 */
export function MoreMenu(props: { label: string; items: readonly MoreMenuItem[]; buttonText?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

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

  if (props.items.length === 0) return null;
  return (
    <div className="more-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="more-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={props.label}
        onClick={() => setOpen((value) => !value)}
      >
        {props.buttonText ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <div id={panelId} className="more-menu-panel">
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.danger === true ? 'danger-text' : undefined}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

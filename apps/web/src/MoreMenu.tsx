import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface MoreMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  /** Destructive (e.g. Delete): shown last and marked. */
  readonly danger?: boolean;
}

const VIEWPORT_MARGIN = 8;

/** How far (px) a panel must move sideways to lie inside the viewport; the left edge wins when it is too wide. */
export function panelShift(left: number, right: number, viewportWidth: number): number {
  if (left < VIEWPORT_MARGIN) return VIEWPORT_MARGIN - left;
  if (right > viewportWidth - VIEWPORT_MARGIN) return Math.max(VIEWPORT_MARGIN - left, viewportWidth - VIEWPORT_MARGIN - right);
  return 0;
}

/**
 * Keeps an open menu panel inside the viewport: a panel aligned to a button near the screen edge
 * (e.g. "⋯" on the left of a phone) would otherwise open half off-screen, out of reach.
 */
export function useKeepInViewport(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!open || panel === null) return;
    const place = () => {
      panel.style.translate = '';
      const rect = panel.getBoundingClientRect();
      const shift = panelShift(rect.left, rect.right, document.documentElement.clientWidth);
      panel.style.translate = shift === 0 ? '' : `${shift}px 0`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);
  return ref;
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
  const panelRef = useKeepInViewport(open);

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
        <div id={panelId} ref={panelRef} className="more-menu-panel">
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

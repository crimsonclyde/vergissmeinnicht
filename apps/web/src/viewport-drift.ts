/**
 * Keeps the phone bottom bar at the bottom of the screen on iOS Safari.
 *
 * Some iOS versions (WebKit bug 297779) let the visual viewport drift below the layout viewport while
 * scrolling, so a `position: fixed; bottom: 0` bar floats up into the page. We measure the drift and
 * move the bar down by it (CSS variable `--viewport-drift`). Browsers without the bug measure 0 and
 * nothing changes; an open keyboard makes the visual viewport smaller, never lower, so it is ignored.
 */

/** How far (CSS px) the bottom of what is visible lies below the bottom of the layout viewport. */
export function bottomDrift(layoutHeight: number, viewport: { offsetTop: number; height: number; scale: number }): number {
  // Zoomed in: the visible part moves on purpose; leave the bar where the browser puts it.
  if (Math.abs(viewport.scale - 1) > 0.01) return 0;
  const drift = viewport.offsetTop + viewport.height - layoutHeight;
  // Sub-pixel differences are rounding, not drift.
  return Number.isFinite(drift) && drift >= 1 ? Math.round(drift) : 0;
}

/** Starts measuring; returns a function that stops. Does nothing without `visualViewport`. */
export function watchViewportDrift(win: Window = window): () => void {
  const viewport = win.visualViewport;
  if (viewport == null) return () => undefined;
  const root = win.document.documentElement;
  let frame = 0;
  let applied = 0;
  const update = () => {
    frame = 0;
    const drift = bottomDrift(win.innerHeight, viewport);
    if (drift === applied) return;
    applied = drift;
    if (drift === 0) root.style.removeProperty('--viewport-drift');
    else root.style.setProperty('--viewport-drift', `${drift}px`);
  };
  const schedule = () => {
    if (frame === 0) frame = win.requestAnimationFrame(update);
  };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  win.addEventListener('scroll', schedule, { passive: true });
  schedule();
  return () => {
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    win.removeEventListener('scroll', schedule);
    if (frame !== 0) win.cancelAnimationFrame(frame);
    root.style.removeProperty('--viewport-drift');
  };
}

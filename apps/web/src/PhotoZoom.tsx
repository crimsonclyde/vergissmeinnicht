import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from './i18n/index.ts';
import { clampZoom, fitted, MAX_ZOOM, NO_ZOOM, panBy, STEP_ZOOM, toggleZoom, zoomAround, type Size, type Zoom } from './photo-zoom.ts';
import { UiIcon } from './ui-icons.tsx';

/** Two taps within this time and distance are a double tap. */
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 12;
/** Arrow keys move a zoomed photo by this much. */
const KEY_PAN_PX = 60;

/**
 * The photo of the full-screen viewer, zoomable (23.6): pinch and double-tap on phones, the wheel and
 * + / − on desktop (buttons and keys), drag to move a zoomed photo, arrow keys too; 0 fits it again.
 * Mounted only while the viewer is open, so every opening starts fitted.
 */
export function ZoomablePhoto(props: { src: string; alt: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; mid: { x: number; y: number } } | null>(null);
  const tap = useRef<{ at: number; x: number; y: number; moved: boolean } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const fit = fitted(natural, stage);
  // The latest values for listeners registered once.
  const latest = useRef({ fit, stage });
  useEffect(() => {
    latest.current = { fit, stage };
  });

  useEffect(() => {
    const element = stageRef.current;
    if (element === null) return;
    const measure = () => setStage({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // The wheel zooms around the pointer; it must not scroll the page behind (non-passive listener).
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = relative(element, event.clientX, event.clientY);
      setZoom((current) => zoomAround(current, Math.exp(-event.deltaY * 0.002), point, latest.current.fit, latest.current.stage));
    };
    // iOS Safari: keep a pinch on the photo from zooming the page.
    const stopGesture = (event: Event) => event.preventDefault();
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', stopGesture);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', stopGesture);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const { fit: f, stage: s } = latest.current;
      const centre = { x: 0, y: 0 };
      const step: Record<string, (current: Zoom) => Zoom> = {
        '+': (current) => zoomAround(current, STEP_ZOOM, centre, f, s),
        '=': (current) => zoomAround(current, STEP_ZOOM, centre, f, s),
        '-': (current) => zoomAround(current, 1 / STEP_ZOOM, centre, f, s),
        '0': () => NO_ZOOM,
        ArrowLeft: (current) => panBy(current, KEY_PAN_PX, 0, f, s),
        ArrowRight: (current) => panBy(current, -KEY_PAN_PX, 0, f, s),
        ArrowUp: (current) => panBy(current, 0, KEY_PAN_PX, f, s),
        ArrowDown: (current) => panBy(current, 0, -KEY_PAN_PX, f, s),
      };
      const change = step[event.key];
      if (change === undefined) return;
      event.preventDefault();
      setZoom(change);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = null;
    tap.current = pointers.current.size === 1 ? { at: event.timeStamp, x: event.clientX, y: event.clientY, moved: false } : null;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const known = pointers.current.get(event.pointerId);
    const element = stageRef.current;
    if (known === undefined || element === null) return;
    const previous = { ...known };
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (tap.current !== null && Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y) > TAP_SLOP_PX) tap.current.moved = true;
    const all = [...pointers.current.values()];
    if (all.length >= 2) {
      const [a, b] = all as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = relative(element, (a.x + b.x) / 2, (a.y + b.y) / 2);
      const before = gesture.current;
      gesture.current = { distance, mid };
      if (before === null || before.distance === 0) return;
      setZoom((current) => panBy(zoomAround(current, distance / before.distance, mid, fit, stage), mid.x - before.mid.x, mid.y - before.mid.y, fit, stage));
    } else {
      setZoom((current) => (current.scale > 1 ? panBy(current, event.clientX - previous.x, event.clientY - previous.y, fit, stage) : current));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    const ended = tap.current;
    tap.current = null;
    const element = stageRef.current;
    if (ended === null || ended.moved || pointers.current.size > 0 || element === null) return;
    const before = lastTap.current;
    if (before !== null && event.timeStamp - before.at < DOUBLE_TAP_MS && Math.hypot(event.clientX - before.x, event.clientY - before.y) < TAP_SLOP_PX * 2) {
      lastTap.current = null;
      const point = relative(element, event.clientX, event.clientY);
      setZoom((current) => toggleZoom(current, point, fit, stage));
    } else {
      lastTap.current = { at: event.timeStamp, x: event.clientX, y: event.clientY };
    }
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    tap.current = null;
  }

  // Shown within the limits of the current stage (it changes when the phone turns).
  const shown = clampZoom(zoom, fit, stage);
  const zoomed = shown.scale > 1.01;
  return (
    <div className="photo-zoom">
      <div
        ref={stageRef}
        className={zoomed ? 'photo-zoom-stage zoomed' : 'photo-zoom-stage'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <img
          src={props.src}
          alt={props.alt}
          draggable={false}
          onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          style={
            fit.width > 0
              ? { width: `${fit.width}px`, height: `${fit.height}px`, transform: `translate(-50%, -50%) translate(${shown.x}px, ${shown.y}px) scale(${shown.scale})` }
              : undefined
          }
        />
      </div>
      <div className="photo-zoom-controls" role="group" aria-label={t('image.zoom')}>
        <button type="button" className="icon-button" aria-label={t('image.zoomOut')} title={t('image.zoomOut')} disabled={!zoomed} onClick={() => setZoom((current) => zoomAround(current, 1 / STEP_ZOOM, { x: 0, y: 0 }, fit, stage))}>
          <UiIcon name="zoomOut" />
        </button>
        <button type="button" className="icon-button" aria-label={t('image.zoomIn')} title={t('image.zoomIn')} disabled={shown.scale >= MAX_ZOOM} onClick={() => setZoom((current) => zoomAround(current, STEP_ZOOM, { x: 0, y: 0 }, fit, stage))}>
          <UiIcon name="zoomIn" />
        </button>
      </div>
    </div>
  );
}

/** A client point relative to the centre of the stage. */
function relative(element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
}

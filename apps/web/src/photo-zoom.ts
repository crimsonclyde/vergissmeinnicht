/**
 * Zoom and pan of the full-screen photo viewer (23.6), as pure functions. The photo is first fitted
 * into the stage (never enlarged beyond its own pixels × MAX_ZOOM); `scale` multiplies that fit, and
 * `x`/`y` move the photo's centre away from the stage's centre (CSS px). Panning is limited so the
 * photo never leaves an empty border on a side where it is larger than the stage.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Zoom {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;
/** What a double tap or the + button zooms to from the fitted photo. */
export const STEP_ZOOM = 2;

const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);

/** The photo fitted into the stage (contain), in CSS px. */
export function fitted(photo: Size, stage: Size): Size {
  if (photo.width <= 0 || photo.height <= 0 || stage.width <= 0 || stage.height <= 0) return { width: 0, height: 0 };
  const ratio = Math.min(stage.width / photo.width, stage.height / photo.height);
  return { width: photo.width * ratio, height: photo.height * ratio };
}

/** Keeps the scale within 1…MAX_ZOOM and the photo covering the stage where it is larger than it. */
export function clampZoom(zoom: Zoom, fit: Size, stage: Size): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, finite(zoom.scale, 1)));
  const maxX = Math.max(0, (fit.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (fit.height * scale - stage.height) / 2);
  // `|| 0` turns -0 into 0 (no empty border either way).
  const clamp = (value: number, max: number) => Math.min(max, Math.max(-max, finite(value, 0))) || 0;
  return { scale, x: clamp(zoom.x, maxX), y: clamp(zoom.y, maxY) };
}

/**
 * Zooms by `factor` around `point` (relative to the stage centre), so what is under the finger or the
 * pointer stays there.
 */
export function zoomAround(zoom: Zoom, factor: number, point: { readonly x: number; readonly y: number }, fit: Size, stage: Size): Zoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, finite(zoom.scale * factor, zoom.scale)));
  const ratio = scale / zoom.scale;
  return clampZoom({ scale, x: point.x - (point.x - zoom.x) * ratio, y: point.y - (point.y - zoom.y) * ratio }, fit, stage);
}

/** Moves a zoomed photo by a drag of `dx`/`dy`. */
export function panBy(zoom: Zoom, dx: number, dy: number, fit: Size, stage: Size): Zoom {
  return clampZoom({ ...zoom, x: zoom.x + dx, y: zoom.y + dy }, fit, stage);
}

/** A double tap: zoom in at the point, or back to the fitted photo when already zoomed. */
export function toggleZoom(zoom: Zoom, point: { readonly x: number; readonly y: number }, fit: Size, stage: Size): Zoom {
  return zoom.scale > 1.01 ? NO_ZOOM : zoomAround(zoom, STEP_ZOOM / zoom.scale, point, fit, stage);
}

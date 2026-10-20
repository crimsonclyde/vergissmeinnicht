/**
 * Crop and rotate a photo in the browser before upload (steps.md 23.3). Pure geometry, no DOM: the
 * editor (`PhotoEditor.tsx`) keeps a `PhotoEdit` and draws with `drawEdited`. The server still checks
 * and re-encodes every upload; nothing here is a security boundary.
 *
 * Model: the photo is first turned by quarter turns (the *frame* is the turned photo, `frameSize`);
 * then straightened by a small angle and enlarged just enough that it still covers the whole frame
 * (no empty corners); the crop is a rectangle inside the frame in fractions (0–1) of its size.
 */

export const MAX_STRAIGHTEN_DEGREES = 15;
/** Brightness and contrast change by at most this many percent either way (23.7). */
export const MAX_LIGHT_PERCENT = 50;
/** Smallest crop in photo pixels, so labels and switches stay legible (smaller photos: the whole photo). */
export const MIN_CROP_PIXELS = 200;

export type Crop = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type PhotoEdit = {
  /** Quarter turns clockwise, 0–3. */
  readonly quarterTurns: number;
  /** Straightening in degrees, clockwise positive, within ±MAX_STRAIGHTEN_DEGREES. */
  readonly straighten: number;
  readonly crop: Crop;
  /** Brightness and contrast in percent, within ±MAX_LIGHT_PERCENT (0: unchanged; 23.7). */
  readonly brightness: number;
  readonly contrast: number;
};

export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const NO_EDIT: PhotoEdit = { quarterTurns: 0, straighten: 0, crop: FULL_CROP, brightness: 0, contrast: 0 };

export function isUnedited(edit: PhotoEdit): boolean {
  const { crop } = edit;
  return edit.quarterTurns === 0 && edit.straighten === 0 && edit.brightness === 0 && edit.contrast === 0 && crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
}

/** A brightness or contrast value from a slider: a finite whole percent within ±MAX_LIGHT_PERCENT. */
export function clampLight(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round(Math.min(MAX_LIGHT_PERCENT, Math.max(-MAX_LIGHT_PERCENT, percent))) || 0;
}

/** The CSS filter that previews brightness and contrast exactly like `adjustLight` (brightness first). */
export function lightFilter(edit: Pick<PhotoEdit, 'brightness' | 'contrast'>): string | undefined {
  if (edit.brightness === 0 && edit.contrast === 0) return undefined;
  return `brightness(${1 + edit.brightness / 100}) contrast(${1 + edit.contrast / 100})`;
}

/**
 * Applies brightness, then contrast, to RGBA pixels in place (alpha unchanged), as the CSS filters
 * `brightness()` and `contrast()` do: v·b, then (v − 128)·c + 128, clamped to 0–255.
 */
export function adjustLight(pixels: Uint8ClampedArray, edit: Pick<PhotoEdit, 'brightness' | 'contrast'>): void {
  if (edit.brightness === 0 && edit.contrast === 0) return;
  const b = 1 + clampLight(edit.brightness) / 100;
  const c = 1 + clampLight(edit.contrast) / 100;
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) table[v] = (v * b - 128) * c + 128;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = table[pixels[i] ?? 0] ?? 0;
    pixels[i + 1] = table[pixels[i + 1] ?? 0] ?? 0;
    pixels[i + 2] = table[pixels[i + 2] ?? 0] ?? 0;
  }
}

/** The photo's size after the quarter turns: width and height swap on an odd number of turns. */
export function frameSize(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  return quarterTurns % 2 === 0 ? { width, height } : { width: height, height: width };
}

/** How much a frame-sized photo turned by `degrees` must grow to still cover the whole frame. */
export function coverScale(width: number, height: number, degrees: number): number {
  const angle = (Math.abs(degrees) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Math.max(cos + (height / width) * sin, cos + (width / height) * sin);
}

export function clampStraighten(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.min(MAX_STRAIGHTEN_DEGREES, Math.max(-MAX_STRAIGHTEN_DEGREES, degrees));
}

/** The smallest crop as fractions of the frame (the whole side when the frame is smaller). */
export function minimumCrop(frame: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.min(1, MIN_CROP_PIXELS / frame.width), height: Math.min(1, MIN_CROP_PIXELS / frame.height) };
}

/** Keeps a crop inside the frame and at least the minimum size; moving never changes its size. */
export function clampCrop(crop: Crop, frame: { width: number; height: number }): Crop {
  const min = minimumCrop(frame);
  const width = Math.min(1, Math.max(min.width, finite(crop.width, 1)));
  const height = Math.min(1, Math.max(min.height, finite(crop.height, 1)));
  const x = Math.min(1 - width, Math.max(0, finite(crop.x, 0)));
  const y = Math.min(1 - height, Math.max(0, finite(crop.y, 0)));
  return { x, y, width, height };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Drags one corner by (dx, dy) fractions of the frame; the opposite corner stays where it is and the
 * crop never gets smaller than the minimum or leaves the frame.
 */
export function resizeCrop(crop: Crop, corner: Corner, dx: number, dy: number, frame: { width: number; height: number }): Crop {
  const min = minimumCrop(frame);
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  if (corner === 'nw' || corner === 'sw') left = Math.min(right - min.width, Math.max(0, left + dx));
  else right = Math.max(left + min.width, Math.min(1, right + dx));
  if (corner === 'nw' || corner === 'ne') top = Math.min(bottom - min.height, Math.max(0, top + dy));
  else bottom = Math.max(top + min.height, Math.min(1, bottom + dy));
  return clampCrop({ x: left, y: top, width: right - left, height: bottom - top }, frame);
}

/** Moves the crop by (dx, dy) fractions of the frame, stopping at the edges. */
export function moveCrop(crop: Crop, dx: number, dy: number, frame: { width: number; height: number }): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, frame);
}

/** A quarter turn (clockwise or counter-clockwise) that keeps the same part of the photo cropped. */
export function turn(edit: PhotoEdit, direction: 1 | -1): PhotoEdit {
  const { x, y, width, height } = edit.crop;
  const crop = direction === 1 ? { x: 1 - y - height, y: x, width: height, height: width } : { x: y, y: 1 - x - width, width: height, height: width };
  return { ...edit, quarterTurns: (edit.quarterTurns + (direction === 1 ? 1 : 3)) % 4, crop };
}

/** Pixel size of the edited photo, the long edge at most `maxEdge` (never enlarged). */
export function outputSize(source: { width: number; height: number }, edit: PhotoEdit, maxEdge: number): { width: number; height: number; scale: number } {
  const frame = frameSize(source.width, source.height, edit.quarterTurns);
  const cropWidth = edit.crop.width * frame.width;
  const cropHeight = edit.crop.height * frame.height;
  const scale = Math.min(1, maxEdge / Math.max(cropWidth, cropHeight));
  return { width: Math.max(1, Math.round(cropWidth * scale)), height: Math.max(1, Math.round(cropHeight * scale)), scale };
}

/** The drawing surface `drawEdited` needs (a 2D canvas context satisfies it; tests use a recorder). */
export type DrawTarget = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
};

/**
 * Draws the edited photo onto a target of `outputSize(...)` pixels: white background (as on the
 * server), then the crop of the turned, straightened photo. `whole: true` draws the whole frame
 * instead (the editor's preview, with the crop shown on top).
 */
export function drawEdited(
  target: DrawTarget,
  image: CanvasImageSource,
  source: { width: number; height: number },
  edit: PhotoEdit,
  output: { width: number; height: number },
  whole = false,
): void {
  const frame = frameSize(source.width, source.height, edit.quarterTurns);
  const crop = whole ? FULL_CROP : edit.crop;
  target.fillStyle = '#ffffff';
  target.fillRect(0, 0, output.width, output.height);
  // Output pixels per frame pixel, then from the crop's corner to the frame's centre.
  target.scale(output.width / (crop.width * frame.width), output.height / (crop.height * frame.height));
  target.translate(-crop.x * frame.width + frame.width / 2, -crop.y * frame.height + frame.height / 2);
  target.rotate(((edit.quarterTurns * 90 + edit.straighten) * Math.PI) / 180);
  const grow = coverScale(frame.width, frame.height, edit.straighten);
  target.scale(grow, grow);
  target.drawImage(image, -source.width / 2, -source.height / 2, source.width, source.height);
}

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
/** Smallest hidden area in photo pixels (23.8), and how many a photo can have. */
export const MIN_HIDDEN_PIXELS = 24;
export const MAX_HIDDEN_AREAS = 10;

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
  /** Areas hidden with coarse blocks (23.8), as fractions of the frame like the crop. */
  readonly hidden: readonly Crop[];
};

export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const NO_EDIT: PhotoEdit = { quarterTurns: 0, straighten: 0, crop: FULL_CROP, brightness: 0, contrast: 0, hidden: [] };

export function isUnedited(edit: PhotoEdit): boolean {
  const { crop } = edit;
  return edit.quarterTurns === 0 && edit.straighten === 0 && edit.brightness === 0 && edit.contrast === 0 && edit.hidden.length === 0 && crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1;
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
export function minimumCrop(frame: { width: number; height: number }, pixels = MIN_CROP_PIXELS): { width: number; height: number } {
  return { width: Math.min(1, pixels / frame.width), height: Math.min(1, pixels / frame.height) };
}

/** Keeps a crop inside the frame and at least the minimum size; moving never changes its size. */
export function clampCrop(crop: Crop, frame: { width: number; height: number }, minPixels = MIN_CROP_PIXELS): Crop {
  const min = minimumCrop(frame, minPixels);
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
export function resizeCrop(crop: Crop, corner: Corner, dx: number, dy: number, frame: { width: number; height: number }, minPixels = MIN_CROP_PIXELS): Crop {
  const min = minimumCrop(frame, minPixels);
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  if (corner === 'nw' || corner === 'sw') left = Math.min(right - min.width, Math.max(0, left + dx));
  else right = Math.max(left + min.width, Math.min(1, right + dx));
  if (corner === 'nw' || corner === 'ne') top = Math.min(bottom - min.height, Math.max(0, top + dy));
  else bottom = Math.max(top + min.height, Math.min(1, bottom + dy));
  return clampCrop({ x: left, y: top, width: right - left, height: bottom - top }, frame, minPixels);
}

/** Moves the crop by (dx, dy) fractions of the frame, stopping at the edges. */
export function moveCrop(crop: Crop, dx: number, dy: number, frame: { width: number; height: number }, minPixels = MIN_CROP_PIXELS): Crop {
  return clampCrop({ ...crop, x: crop.x + dx, y: crop.y + dy }, frame, minPixels);
}

/** A quarter turn (clockwise or counter-clockwise) that keeps the same part of the photo cropped. */
export function turn(edit: PhotoEdit, direction: 1 | -1): PhotoEdit {
  const turned = ({ x, y, width, height }: Crop): Crop =>
    direction === 1 ? { x: 1 - y - height, y: x, width: height, height: width } : { x: y, y: 1 - x - width, width: height, height: width };
  return { ...edit, quarterTurns: (edit.quarterTurns + (direction === 1 ? 1 : 3)) % 4, crop: turned(edit.crop), hidden: edit.hidden.map(turned) };
}

/** A new area to hide (23.8): in the middle of the crop, a third of its width and a sixth of its height. */
export function newHiddenArea(edit: PhotoEdit, frame: { width: number; height: number }): Crop {
  const { crop } = edit;
  const width = crop.width / 3;
  const height = crop.height / 6;
  return clampCrop({ x: crop.x + (crop.width - width) / 2, y: crop.y + (crop.height - height) / 2, width, height }, frame, MIN_HIDDEN_PIXELS);
}

/**
 * The hidden areas in output pixels (whole pixels, grown outwards so nothing at an edge stays visible),
 * clipped to the output; areas outside the crop are left out. `whole`: the output shows the whole frame.
 */
export function hiddenInOutput(edit: PhotoEdit, output: { width: number; height: number }, whole = false): { x: number; y: number; width: number; height: number }[] {
  const crop = whole ? FULL_CROP : edit.crop;
  const areas = [];
  for (const area of edit.hidden) {
    const left = Math.max(0, Math.floor(((area.x - crop.x) / crop.width) * output.width));
    const top = Math.max(0, Math.floor(((area.y - crop.y) / crop.height) * output.height));
    const right = Math.min(output.width, Math.ceil(((area.x + area.width - crop.x) / crop.width) * output.width));
    const bottom = Math.min(output.height, Math.ceil(((area.y + area.height - crop.y) / crop.height) * output.height));
    if (right > left && bottom > top) areas.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return areas;
}

/**
 * Hides a rectangle of RGBA pixels in place (23.8): every block becomes the average colour of that block,
 * with blocks of a quarter of the area's shorter side (at least 8 px), so the area shows at most a few
 * coarse colour patches — writing, numbers and faces cannot be read or recovered from it. Alpha untouched.
 */
export function pixelate(pixels: Uint8ClampedArray, width: number, area: { x: number; y: number; width: number; height: number }): void {
  const block = Math.max(8, Math.ceil(Math.min(area.width, area.height) / 4));
  for (let by = area.y; by < area.y + area.height; by += block) {
    for (let bx = area.x; bx < area.x + area.width; bx += block) {
      const right = Math.min(bx + block, area.x + area.width);
      const bottom = Math.min(by + block, area.y + area.height);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = by; y < bottom; y += 1) {
        for (let x = bx; x < right; x += 1) {
          const i = (y * width + x) * 4;
          r += pixels[i] ?? 0;
          g += pixels[i + 1] ?? 0;
          b += pixels[i + 2] ?? 0;
          n += 1;
        }
      }
      if (n === 0) continue;
      for (let y = by; y < bottom; y += 1) {
        for (let x = bx; x < right; x += 1) {
          const i = (y * width + x) * 4;
          pixels[i] = r / n;
          pixels[i + 1] = g / n;
          pixels[i + 2] = b / n;
        }
      }
    }
  }
}

/** Applies light and hidden areas to a canvas already drawn by `drawEdited` (output or preview). */
export function finishPixels(context: { getImageData(x: number, y: number, w: number, h: number): ImageData; putImageData(data: ImageData, x: number, y: number): void }, edit: PhotoEdit, output: { width: number; height: number }, whole = false): void {
  const areas = hiddenInOutput(edit, output, whole);
  const light = edit.brightness !== 0 || edit.contrast !== 0;
  if (!light && areas.length === 0) return;
  const image = context.getImageData(0, 0, output.width, output.height);
  if (light) adjustLight(image.data, edit);
  for (const area of areas) pixelate(image.data, output.width, area);
  context.putImageData(image, 0, 0);
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

import { describe, expect, it } from 'vitest';
import {
  adjustLight,
  hiddenInOutput,
  MIN_HIDDEN_PIXELS,
  newHiddenArea,
  pixelate,
  clampLight,
  lightFilter,
  MAX_LIGHT_PERCENT,
  clampCrop,
  clampStraighten,
  coverScale,
  drawEdited,
  frameSize,
  isUnedited,
  minimumCrop,
  moveCrop,
  NO_EDIT,
  outputSize,
  resizeCrop,
  turn,
  type DrawTarget,
  type PhotoEdit,
} from './photo-edit.ts';

/** Records the transform like a canvas does, so we can see where the photo's corners land. */
function recorder() {
  // Affine matrix [a c e; b d f].
  type Matrix = [number, number, number, number, number, number];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const drawn: { x: number; y: number }[] = [];
  const apply = (x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const multiply = (n: Matrix) => {
    const [a, b, c, d, e, f] = m;
    const [a2, b2, c2, d2, e2, f2] = n;
    m = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
  };
  const target: DrawTarget = {
    fillStyle: '',
    fillRect: () => {},
    translate: (x, y) => multiply([1, 0, 0, 1, x, y]),
    rotate: (angle) => multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
    scale: (x, y) => multiply([x, 0, 0, y, 0, 0]),
    drawImage: (_image, dx, dy, dw, dh) => {
      drawn.push(apply(dx, dy), apply(dx + dw, dy), apply(dx + dw, dy + dh), apply(dx, dy + dh));
    },
  };
  return { target, drawn, apply };
}

const image = {} as CanvasImageSource;
const close = (actual: { x: number; y: number } | undefined, x: number, y: number) => {
  expect(actual?.x).toBeCloseTo(x, 6);
  expect(actual?.y).toBeCloseTo(y, 6);
};

describe('photo edit geometry (23.3)', () => {
  it('swaps width and height on a quarter turn', () => {
    expect(frameSize(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    expect(frameSize(4000, 3000, 1)).toEqual({ width: 3000, height: 4000 });
    expect(frameSize(4000, 3000, 2)).toEqual({ width: 4000, height: 3000 });
    expect(outputSize({ width: 4000, height: 3000 }, { ...NO_EDIT, quarterTurns: 1 }, 1600)).toMatchObject({ width: 1200, height: 1600 });
  });

  it('never enlarges and keeps the long edge at the limit', () => {
    expect(outputSize({ width: 800, height: 600 }, NO_EDIT, 1600)).toMatchObject({ width: 800, height: 600 });
    expect(outputSize({ width: 4000, height: 3000 }, { ...NO_EDIT, crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } }, 1600)).toMatchObject({ width: 1600, height: 1200 });
  });

  it('grows a straightened photo just enough to cover the frame', () => {
    expect(coverScale(400, 300, 0)).toBe(1);
    const scale = coverScale(400, 300, 10);
    expect(scale).toBeGreaterThan(1);
    expect(coverScale(400, 300, -10)).toBe(scale);
    // Every frame corner lies inside the rotated, enlarged photo.
    const angle = (10 * Math.PI) / 180;
    for (const [x, y] of [
      [200, 150],
      [-200, 150],
      [200, -150],
      [-200, -150],
    ] as const) {
      const u = x * Math.cos(angle) + y * Math.sin(angle);
      const v = -x * Math.sin(angle) + y * Math.cos(angle);
      expect(Math.abs(u)).toBeLessThanOrEqual((400 * scale) / 2 + 1e-9);
      expect(Math.abs(v)).toBeLessThanOrEqual((300 * scale) / 2 + 1e-9);
    }
    expect(clampStraighten(40)).toBe(15);
    expect(clampStraighten(-40)).toBe(-15);
    expect(clampStraighten(Number.NaN)).toBe(0);
  });

  it('keeps the crop inside the photo and at least the minimum size', () => {
    const frame = { width: 2000, height: 1000 };
    expect(minimumCrop(frame)).toEqual({ width: 0.1, height: 0.2 });
    expect(minimumCrop({ width: 150, height: 120 })).toEqual({ width: 1, height: 1 });
    expect(clampCrop({ x: 0.95, y: -1, width: 0.5, height: 0.01 }, frame)).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.2 });
    expect(clampCrop({ x: Number.NaN, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }, frame)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    // Moving stops at the edge without shrinking.
    expect(moveCrop({ x: 0.5, y: 0.5, width: 0.4, height: 0.4 }, 0.5, -1, frame)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
  });

  it('resizes from one corner, keeping the opposite corner fixed', () => {
    const frame = { width: 1000, height: 1000 };
    const crop = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    const se = resizeCrop(crop, 'se', -0.1, 0.5, frame);
    expect(se.x).toBeCloseTo(0.2);
    expect(se.y).toBeCloseTo(0.2);
    expect(se.width).toBeCloseTo(0.5);
    expect(se.height).toBeCloseTo(0.8);
    const nw = resizeCrop(crop, 'nw', 0.9, 0.9, frame);
    expect(nw.x + nw.width).toBeCloseTo(0.8);
    expect(nw.width).toBeCloseTo(0.2); // 200 px minimum
    const ne = resizeCrop(crop, 'ne', 0.5, -0.5, frame);
    expect(ne.x).toBeCloseTo(0.2);
    expect(ne.y).toBe(0);
    expect(ne.width).toBeCloseTo(0.8);
    expect(ne.height).toBeCloseTo(0.8);
  });

  it('turns the crop with the photo, and four turns change nothing', () => {
    const edit: PhotoEdit = { ...NO_EDIT, straighten: 5, crop: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } };
    const right = turn(edit, 1);
    expect(right.quarterTurns).toBe(1);
    expect(right.crop.x).toBeCloseTo(0.4);
    expect(right.crop.y).toBeCloseTo(0.1);
    expect(right.crop.width).toBeCloseTo(0.4);
    expect(right.crop.height).toBeCloseTo(0.3);
    const back = turn(right, -1);
    expect(back.quarterTurns).toBe(0);
    expect(back.crop.x).toBeCloseTo(0.1);
    expect(back.crop.y).toBeCloseTo(0.2);
    let around = edit;
    for (let i = 0; i < 4; i += 1) around = turn(around, 1);
    expect(around.quarterTurns).toBe(0);
    expect(around.crop.x).toBeCloseTo(0.1);
    expect(around.crop.height).toBeCloseTo(0.4);
    expect(isUnedited(NO_EDIT)).toBe(true);
    expect(isUnedited(turn(NO_EDIT, 1))).toBe(false);
  });

  it('draws an unedited photo exactly onto the output', () => {
    const { target, drawn } = recorder();
    drawEdited(target, image, { width: 400, height: 300 }, NO_EDIT, { width: 400, height: 300 });
    close(drawn[0], 0, 0);
    close(drawn[2], 400, 300);
  });

  it('draws a clockwise turn with the top-left corner at the top right', () => {
    const { target, drawn } = recorder();
    const edit = { ...NO_EDIT, quarterTurns: 1 };
    drawEdited(target, image, { width: 400, height: 300 }, edit, { width: 300, height: 400 });
    close(drawn[0], 300, 0); // the photo's top-left
    close(drawn[2], 0, 400); // its bottom-right
  });

  it('draws only the cropped part, scaled to the output', () => {
    const { target, apply } = recorder();
    const edit = { ...NO_EDIT, crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } };
    drawEdited(target, image, { width: 400, height: 300 }, edit, { width: 200, height: 150 });
    // Image space is centred: the photo's centre (0, 0) is the crop's top-left corner.
    close(apply(0, 0), 0, 0);
    close(apply(200, 150), 200, 150);
  });

  it('changes brightness and contrast like the CSS filters of the preview (23.7)', () => {
    expect(clampLight(80)).toBe(MAX_LIGHT_PERCENT);
    expect(clampLight(-80)).toBe(-MAX_LIGHT_PERCENT);
    expect(clampLight(Number.NaN)).toBe(0);
    expect(clampLight(12.6)).toBe(13);
    expect(lightFilter(NO_EDIT)).toBeUndefined();
    expect(lightFilter({ brightness: 20, contrast: -10 })).toBe('brightness(1.2) contrast(0.9)');
    expect(isUnedited({ ...NO_EDIT, brightness: 5 })).toBe(false);
    // R, G, B, A of two pixels: alpha is never touched.
    const pixels = new Uint8ClampedArray([100, 128, 250, 7, 0, 64, 200, 255]);
    adjustLight(pixels, { brightness: 0, contrast: 0 });
    expect([...pixels]).toEqual([100, 128, 250, 7, 0, 64, 200, 255]);
    adjustLight(pixels, { brightness: 20, contrast: 0 });
    expect([...pixels]).toEqual([120, 154, 255, 7, 0, 77, 240, 255]);
    adjustLight(pixels, { brightness: 0, contrast: 50 });
    // (v − 128) · 1.5 + 128, clamped
    expect([...pixels]).toEqual([116, 167, 255, 7, 0, 52, 255, 255]);
  });

  it('hides areas with coarse blocks that keep nothing of the original detail (23.8)', () => {
    // A 32 × 32 checkerboard of 1-px black and white pixels: hidden as 8-px blocks, each a flat grey.
    const width = 32;
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let i = 0; i < width * width; i += 1) {
      const value = ((i % width) + Math.floor(i / width)) % 2 === 0 ? 0 : 255;
      pixels.set([value, value, value, 200], i * 4);
    }
    const before = pixels.slice();
    pixelate(pixels, width, { x: 0, y: 0, width: 16, height: 16 });
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const i = (y * width + x) * 4;
        expect([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]).toEqual([128, 128, 128, 200]);
      }
    }
    // Outside the area nothing changed.
    expect(pixels.slice(16 * 4, 32 * 4)).toEqual(before.slice(16 * 4, 32 * 4));
    expect(pixels.slice(16 * width * 4)).toEqual(before.slice(16 * width * 4));
  });

  it('places hidden areas in the output, turns them with the photo and keeps them a minimum size', () => {
    const frame = { width: 1000, height: 500 };
    const area = newHiddenArea(NO_EDIT, frame);
    expect(area.width).toBeCloseTo(1 / 3);
    expect(area.height).toBeCloseTo(1 / 6);
    expect(area.x).toBeCloseTo(1 / 3);
    const edit: PhotoEdit = { ...NO_EDIT, crop: { x: 0.5, y: 0, width: 0.5, height: 1 }, hidden: [{ x: 0.6, y: 0.5, width: 0.2, height: 0.25 }, { x: 0, y: 0, width: 0.1, height: 0.1 }] };
    // In a 500 × 500 output of the right half: the first area only; the second lies outside the crop.
    // Whole pixels, grown outwards by at most one pixel (rounding never leaves an edge visible).
    const covers = (got: { x: number; y: number; width: number; height: number } | undefined, want: { x: number; y: number; width: number; height: number }) => {
      expect(got).toBeDefined();
      if (got === undefined) return;
      expect(got.x).toBeLessThanOrEqual(want.x);
      expect(got.y).toBeLessThanOrEqual(want.y);
      expect(got.x).toBeGreaterThanOrEqual(want.x - 1);
      expect(got.y).toBeGreaterThanOrEqual(want.y - 1);
      expect(got.x + got.width).toBeGreaterThanOrEqual(want.x + want.width);
      expect(got.y + got.height).toBeGreaterThanOrEqual(want.y + want.height);
      expect(got.x + got.width).toBeLessThanOrEqual(want.x + want.width + 1);
      expect(got.y + got.height).toBeLessThanOrEqual(want.y + want.height + 1);
    };
    const inCrop = hiddenInOutput(edit, { width: 500, height: 500 });
    expect(inCrop).toHaveLength(1);
    covers(inCrop[0], { x: 100, y: 250, width: 200, height: 125 });
    const whole = hiddenInOutput(edit, { width: 1000, height: 500 }, true);
    expect(whole).toHaveLength(2);
    covers(whole[0], { x: 600, y: 250, width: 200, height: 125 });
    expect(whole[1]).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    // A quarter turn moves the hidden areas with the photo (four turns: back where they were).
    const turned = turn(edit, 1);
    const near = (got: { x: number; y: number; width: number; height: number } | undefined, want: { x: number; y: number; width: number; height: number }) => {
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(got?.[key]).toBeCloseTo(want[key]);
    };
    near(turned.hidden[0], { x: 0.25, y: 0.6, width: 0.25, height: 0.2 });
    const back = turn(turn(turn(turned, 1), 1), 1).hidden;
    edit.hidden.forEach((area, index) => near(back[index], area));
    // Smaller than the minimum is not possible.
    const tiny = resizeCrop({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, 'se', -1, -1, frame, MIN_HIDDEN_PIXELS);
    expect(tiny.width * frame.width).toBeCloseTo(MIN_HIDDEN_PIXELS);
    expect(isUnedited({ ...NO_EDIT, hidden: [area] })).toBe(false);
  });
});

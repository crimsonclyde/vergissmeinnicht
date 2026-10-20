import { describe, expect, it } from 'vitest';
import { clampZoom, fitted, MAX_ZOOM, NO_ZOOM, panBy, toggleZoom, zoomAround } from './photo-zoom.ts';

const stage = { width: 400, height: 800 };
const photo = { width: 1600, height: 1200 };
const fit = fitted(photo, stage); // 400 × 300

describe('photo viewer zoom (23.6)', () => {
  it('fits the photo into the stage', () => {
    expect(fit).toEqual({ width: 400, height: 300 });
    expect(fitted({ width: 0, height: 10 }, stage)).toEqual({ width: 0, height: 0 });
  });

  it('keeps the scale between the fitted photo and MAX_ZOOM', () => {
    expect(clampZoom({ scale: 0.2, x: 50, y: 50 }, fit, stage)).toEqual(NO_ZOOM);
    expect(clampZoom({ scale: 99, x: 0, y: 0 }, fit, stage).scale).toBe(MAX_ZOOM);
    expect(clampZoom({ scale: Number.NaN, x: Number.NaN, y: 0 }, fit, stage)).toEqual(NO_ZOOM);
  });

  it('never pans the photo away from an edge where it is larger than the stage', () => {
    const zoomed = { scale: 2, x: 0, y: 0 }; // 800 × 600 on a 400 × 800 stage
    expect(panBy(zoomed, 1000, 1000, fit, stage)).toEqual({ scale: 2, x: 200, y: 0 });
    expect(panBy(zoomed, -1000, -50, fit, stage)).toEqual({ scale: 2, x: -200, y: 0 });
    const tall = { scale: 4, x: 0, y: 0 }; // 1600 × 1200: now taller than the stage too
    expect(panBy(tall, 0, 1000, fit, stage)).toEqual({ scale: 4, x: 0, y: 200 });
  });

  it('keeps the point under the fingers while zooming', () => {
    const point = { x: 100, y: 0 };
    const zoomed = zoomAround(NO_ZOOM, 2, point, fit, stage);
    expect(zoomed).toEqual({ scale: 2, x: -100, y: 0 });
    // The photo point that was under the finger (100 px right of its centre at scale 1) is still there.
    expect(zoomed.x + 100 * zoomed.scale).toBe(point.x);
    expect(zoomAround(zoomed, 0.1, point, fit, stage)).toEqual(NO_ZOOM);
  });

  it('toggles between fitted and zoomed on a double tap', () => {
    const zoomed = toggleZoom(NO_ZOOM, { x: 0, y: 0 }, fit, stage);
    expect(zoomed.scale).toBe(2);
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, fit, stage)).toEqual(NO_ZOOM);
  });
});

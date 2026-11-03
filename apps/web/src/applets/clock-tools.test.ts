import { describe, expect, it } from 'vitest';
import { durationText, elapsedAt, idleTiming, pauseTiming, remainingAt, startTiming, validMinutes } from './clock-tools.ts';

describe('ephemeral Clock timing', () => {
  it('accumulates only running periods across pause/resume and does not restart an active clock', () => {
    const active = startTiming(idleTiming(), 1000);
    expect(startTiming(active, 2000)).toBe(active);
    const paused = pauseTiming(active, 3500);
    expect(elapsedAt(paused, 20_000)).toBe(2500);
    const resumed = startTiming(paused, 20_000);
    expect(elapsedAt(resumed, 21_500)).toBe(4000);
  });
  it('recovers a countdown after suspension, clamps at zero and never accumulates negative elapsed time', () => {
    const active = startTiming(idleTiming(), 1000);
    expect(remainingAt(active, 60_000, 31_000)).toBe(30_000);
    expect(remainingAt(active, 60_000, 121_000)).toBe(0);
    expect(elapsedAt(active, 500)).toBe(0);
    expect(durationText(7_201_000)).toBe('02:00:01');
    expect(durationText(-10)).toBe('00:00');
  });
  it('bounds custom duration without accepting fractional or nonfinite input', () => {
    for (const value of [0, -1, 1441, 2.5, NaN, Infinity]) expect(validMinutes(value)).toBe(false);
    expect(validMinutes(1)).toBe(true);
    expect(validMinutes(1440)).toBe(true);
  });
});

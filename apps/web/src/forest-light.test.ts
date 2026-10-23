import { describe, expect, it } from 'vitest';
import { forestLight } from './forest-light.ts';

// Eclipse instants give strong independent phase cases (new and full), not a copy of SunCalc's formula.
const NEW = new Date('2024-04-08T18:21:00Z');
const FULL = new Date('2024-03-25T07:00:00Z');

describe('forest lighting (25.3)', () => {
  it('stays attractive without a location and separates new from full moon', () => {
    expect(forestLight(NEW).moonlight).toBeLessThan(0.01);
    expect(forestLight(FULL).moonlight).toBeGreaterThan(0.99);
    expect(forestLight(NEW).starlight).toBeGreaterThan(forestLight(FULL).starlight);
  });

  it('removes local moonlight below the horizon, including at the full moon', () => {
    expect(forestLight(FULL, { latitude: 50, longitude: 8 }).moonlight).toBe(0);
    expect(forestLight(FULL, { latitude: -50, longitude: -172 }).moonlight).toBeGreaterThan(0.99);
  });

  it('treats equivalent instants identically across time zones and DST', () => {
    expect(forestLight(new Date('2024-03-31T03:30:00+02:00'))).toEqual(forestLight(new Date('2024-03-31T01:30:00Z')));
    expect(forestLight(new Date('2024-10-27T02:30:00+01:00'))).toEqual(forestLight(new Date('2024-10-27T01:30:00Z')));
  });

  it('falls back safely for absent, invalid and non-finite coordinates or dates', () => {
    for (const location of [{ latitude: NaN, longitude: 8 }, { latitude: 91, longitude: 8 }, { latitude: 0, longitude: Infinity }, { latitude: 0, longitude: 181 }]) {
      expect(forestLight(FULL, location)).toEqual(forestLight(FULL));
    }
    expect(forestLight(new Date(NaN))).toEqual({ moonlight: 0.4, starlight: 0.5 });
  });

  it('bounds decorative illumination at the poles through the year', () => {
    for (const latitude of [-90, 0, 90]) for (let month = 0; month < 12; month++) {
      const result = forestLight(new Date(Date.UTC(2026, month, 15)), { latitude, longitude: 0 });
      expect(result.moonlight).toBeGreaterThanOrEqual(0);
      expect(result.moonlight).toBeLessThanOrEqual(1);
      expect(result.starlight + result.moonlight).toBeCloseTo(1);
    }
  });
});

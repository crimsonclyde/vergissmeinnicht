import { describe, expect, it } from 'vitest';
import { localHour, phaseFromHour, phaseFromSun, placeLight } from './atmosphere.ts';

describe('Places time of day (section 30)', () => {
  it('uses the sun at the Workspace location when there is one', () => {
    const edinburgh = { location: { latitude: 55.95, longitude: -3.19 }, timeZone: 'Europe/London' };
    expect(placeLight(new Date('2026-06-21T12:00:00Z'), edinburgh).phase).toBe('day');
    expect(placeLight(new Date('2026-12-21T23:00:00Z'), edinburgh).phase).toBe('night');
    // Midsummer evening in Edinburgh: still light at 20:30 local.
    expect(placeLight(new Date('2026-06-21T19:30:00Z'), edinburgh).phase).not.toBe('night');
  });

  it('uses the Workspace time zone, not the country, without a location', () => {
    const now = new Date('2026-03-10T07:30:00Z');
    expect(placeLight(now, { location: null, timeZone: 'Europe/Rome' }).phase).toBe('day'); // 08:30
    expect(placeLight(now, { location: null, timeZone: 'America/New_York' }).phase).toBe('night'); // 03:30
    expect(localHour(now, 'Asia/Tokyo')).toBeCloseTo(16.5);
    // An unknown zone falls back to the device's clock instead of failing.
    expect(localHour(now, 'Not/AZone')).toBe(now.getHours() + now.getMinutes() / 60);
  });

  it('maps the sun and hours to phases, and invalid input to a quiet day', () => {
    expect(phaseFromSun(-10, true)).toBe('night');
    expect(phaseFromSun(-3, true)).toBe('morning');
    expect(phaseFromSun(-3, false)).toBe('evening');
    expect(phaseFromSun(5, false)).toBe('dusk');
    expect(phaseFromSun(30, false)).toBe('day');
    expect([4, 6, 12, 18, 21, 23].map(phaseFromHour)).toEqual(['night', 'morning', 'day', 'dusk', 'evening', 'night']);
    expect(placeLight(new Date(Number.NaN), { location: null, timeZone: null }).phase).toBe('day');
    expect(placeLight(new Date('2026-03-10T12:00:00Z'), { location: { latitude: 999, longitude: 0 }, timeZone: 'UTC' }).phase).toBe('day');
  });

  it('turns weather into mist only when given (no weather is ever fetched for decoration)', () => {
    const clock = { location: null, timeZone: 'UTC' };
    const now = new Date('2026-03-10T12:00:00Z');
    expect(placeLight(now, clock).mist).toBe(0);
    expect(placeLight(now, clock, 'fog').mist).toBeGreaterThan(0);
  });
});
